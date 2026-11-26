import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { sealSecret } from "@mattrax/crypto";
import {
  EnterpriseBadRequest,
  EnterpriseNotFound,
  EnterprisePermissionDenied,
  EnterpriseUnauthorized,
} from "@mattrax/enterprise-domain";
import type {
  WebhookDeliveryDetail,
  WebhookDeliveryReplayResponse,
  WebhookDeliveriesResponse,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { RequiredPermission } from "@mattrax/enterprise-identity";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const authSecret = "enterprise-test-secret";

const now = new Date("2026-11-16T12:00:00.000Z");

const makeContext = (options: { role?: string; fetch?: typeof globalThis.fetch } = {}) => {
  const db = makeDb();
  db.store.account.push({
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  });
  db.store.organization.push(
    {
      id: "org-1",
      name: "Acme",
      slug: "acme",
      stripeCustomerId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "org-2",
      name: "Other",
      slug: "other",
      stripeCustomerId: null,
      createdAt: now,
      updatedAt: now,
    },
  );
  db.store.member.push(
    {
      id: "member-1",
      organizationId: "org-1",
      accountId: "user-1",
      role: options.role ?? "owner",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "member-2",
      organizationId: "org-2",
      accountId: "user-1",
      role: "owner",
      createdAt: now,
      updatedAt: now,
    },
  );

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie
        ? Effect.succeed({ user: db.store.account[0], apiToken: undefined })
        : Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    // SAFETY: these tests never reach R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret,
    webhookFetch: options.fetch,
  });

  return { db, service, headers: { cookie: "mattrax_session=test" } };
};

const endpoint = (id: string, organizationId = "org-1", secret = "sealed") => ({
  id,
  organizationId,
  url: "https://hooks.example.com/mattrax",
  secret,
  secretPrefix: "abcd",
  description: null,
  eventFilters: [],
  enabled: true,
  lastDeliveryAt: null,
  lastDeliveryStatus: null,
  consecutiveFailures: 0,
  createdAt: now,
  updatedAt: now,
});

const delivery = (input: {
  id: string;
  endpointId?: string;
  organizationId?: string;
  event?: string;
  createdAt: Date;
  status?: "succeeded" | "failed";
  attempt?: number;
  responseStatus?: number | null;
  error?: string | null;
  eventId?: string;
}) => {
  const eventId = input.eventId ?? "evt_payload_1";

  return {
    id: input.id,
    endpointId: input.endpointId ?? "wh-1",
    organizationId: input.organizationId ?? "org-1",
    event: input.event ?? "device.enrolled",
    eventId,
    payload: {
      id: eventId,
      type: input.event ?? "device.enrolled",
      occurredAt: input.createdAt.toISOString(),
      organizationId: input.organizationId ?? "org-1",
      data: { targetType: "device", targetId: "device-1" },
    },
    status: input.status ?? "succeeded",
    attempt: input.attempt ?? 1,
    responseStatus: input.responseStatus === undefined ? 200 : input.responseStatus,
    error: input.error ?? null,
    createdAt: input.createdAt,
  };
};

// SAFETY: `service` is the concrete enterprise service; `method` is one of the
// delivery methods this file exercises.
const call = <Result>(service: any, method: string, ...args: Array<unknown>) =>
  runEffect<Result, unknown>(service[method](request({ cookie: "1" }), ...args));

describe("webhook delivery history", () => {
  it("pages newest first and only within the retention window", async () => {
    const { db, service } = makeContext();
    db.store.webhook_endpoint.push(endpoint("wh-1"));
    db.store.webhook_delivery.push(
      delivery({ id: "d-1", createdAt: new Date("2026-11-16T10:00:00.000Z") }),
      delivery({ id: "d-2", createdAt: new Date("2026-11-16T11:00:00.000Z") }),
      delivery({ id: "d-3", createdAt: new Date("2026-11-16T09:00:00.000Z") }),
      // Older than the 30-day retention window: maintenance has already
      // deleted rows like this, so a query must not return it.
      delivery({ id: "d-old", createdAt: new Date("2026-09-01T00:00:00.000Z") }),
    );

    const first = await call<WebhookDeliveriesResponse>(
      service,
      "listWebhookDeliveries",
      "org-1",
      "wh-1",
      { limit: 2 },
    );

    expect(first.deliveries.map((row) => row.id)).toEqual(["d-2", "d-1"]);
    expect(first.deliveries[0]).toMatchObject({
      endpointId: "wh-1",
      event: "device.enrolled",
      status: "succeeded",
      attempt: 1,
      responseStatus: 200,
    });
    expect(first.deliveries[0]).not.toHaveProperty("payload");
    expect(first.nextCursor).toEqual(expect.stringMatching(/^[A-Za-z0-9_-]+$/));

    const second = await call<WebhookDeliveriesResponse>(
      service,
      "listWebhookDeliveries",
      "org-1",
      "wh-1",
      {
        limit: 2,
        cursor: first.nextCursor,
      },
    );

    expect(second.deliveries.map((row) => row.id)).toEqual(["d-3"]);
    expect(second.nextCursor).toBeNull();
  });

  it("filters by event and status", async () => {
    const { db, service } = makeContext();
    db.store.webhook_endpoint.push(endpoint("wh-1"));
    db.store.webhook_delivery.push(
      delivery({ id: "d-enrolled", createdAt: new Date("2026-11-16T10:00:00.000Z") }),
      delivery({
        id: "d-failed",
        createdAt: new Date("2026-11-16T09:00:00.000Z"),
        event: "policy.deployment_failed",
        status: "failed",
        responseStatus: 500,
        error: "Endpoint responded with HTTP 500",
        attempt: 3,
      }),
    );

    const failed = await call<WebhookDeliveriesResponse>(
      service,
      "listWebhookDeliveries",
      "org-1",
      "wh-1",
      {
        status: "failed",
      },
    );

    expect(failed.deliveries.map((row) => row.id)).toEqual(["d-failed"]);
    expect(failed.deliveries[0]).toMatchObject({
      status: "failed",
      attempt: 3,
      responseStatus: 500,
      error: "Endpoint responded with HTTP 500",
    });

    const byEvent = await call<WebhookDeliveriesResponse>(
      service,
      "listWebhookDeliveries",
      "org-1",
      "wh-1",
      {
        event: "policy.deployment_failed",
      },
    );

    expect(byEvent.deliveries.map((row) => row.id)).toEqual(["d-failed"]);
  });

  it("rejects an unknown event filter and a malformed cursor", async () => {
    const { db, service } = makeContext();
    db.store.webhook_endpoint.push(endpoint("wh-1"));

    await expect(
      call(service, "listWebhookDeliveries", "org-1", "wh-1", { event: "not.an.event" }),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      call(service, "listWebhookDeliveries", "org-1", "wh-1", { cursor: "not-a-cursor" }),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("never returns another tenant's deliveries", async () => {
    const { db, service } = makeContext();
    db.store.webhook_endpoint.push(endpoint("wh-1"), endpoint("wh-2", "org-2"));
    db.store.webhook_delivery.push(
      delivery({ id: "d-1", createdAt: new Date("2026-11-16T10:00:00.000Z") }),
      delivery({
        id: "d-other",
        endpointId: "wh-2",
        organizationId: "org-2",
        createdAt: new Date("2026-11-16T10:30:00.000Z"),
      }),
    );

    // The same user owns org-2, but the endpoint id belongs to org-1's tenant
    // scope, so the request is reported as missing rather than leaking rows.
    await expect(
      call(service, "listWebhookDeliveries", "org-2", "wh-1", {}),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);

    const own = await call<WebhookDeliveriesResponse>(
      service,
      "listWebhookDeliveries",
      "org-2",
      "wh-2",
      {},
    );

    expect(own.deliveries.map((row) => row.id)).toEqual(["d-other"]);

    await expect(
      call(service, "getWebhookDelivery", "org-1", "wh-1", "d-other"),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("returns the stored payload and response for one delivery", async () => {
    const { db, service } = makeContext();
    db.store.webhook_endpoint.push(endpoint("wh-1"));
    db.store.webhook_delivery.push(
      delivery({
        id: "d-1",
        createdAt: new Date("2026-11-16T10:00:00.000Z"),
        responseStatus: 202,
      }),
    );

    const detail = await call<WebhookDeliveryDetail>(
      service,
      "getWebhookDelivery",
      "org-1",
      "wh-1",
      "d-1",
    );

    expect(detail).toMatchObject({
      id: "d-1",
      eventId: "evt_payload_1",
      responseStatus: 202,
      payload: {
        type: "device.enrolled",
        data: { targetType: "device", targetId: "device-1" },
      },
    });
  });

  it("gates reads on webhooks.read", async () => {
    const { db, service } = makeContext({ role: "member" });
    db.store.webhook_endpoint.push(endpoint("wh-1"));

    await expect(
      runEffect(
        service.listWebhookDeliveries(request({ cookie: "1" }), "org-1", "wh-1", {}).pipe(
          Effect.provideService(RequiredPermission, {
            permission: "webhooks.read",
            method: "listWebhookDeliveries",
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
  });
});

describe("webhook delivery replay", () => {
  it("re-sends the stored payload with the same delivery id and records a new row", async () => {
    const sealed = await sealSecret(authSecret, "whsec_replay");
    const requests: Array<RequestInit> = [];

    const fetch = vi.fn(async (_input: any, init?: RequestInit) => {
      requests.push(init ?? {});

      return new Response("ok", { status: 200 });
    });

    const { db, service } = makeContext({ fetch });
    db.store.webhook_endpoint.push(endpoint("wh-1", "org-1", sealed));
    db.store.webhook_delivery.push(
      delivery({
        id: "d-1",
        createdAt: new Date("2026-11-16T10:00:00.000Z"),
        eventId: "evt_original",
      }),
    );

    const result = await call<WebhookDeliveryReplayResponse>(
      service,
      "replayWebhookDelivery",
      "org-1",
      "wh-1",
      "d-1",
    );

    expect(result).toMatchObject({
      replayedFrom: "d-1",
      delivery: {
        eventId: "evt_original",
        event: "device.enrolled",
        status: "succeeded",
        responseStatus: 200,
        attempt: 1,
      },
    });
    expect(result.delivery.id).not.toBe("d-1");
    expect(fetch).toHaveBeenCalledTimes(1);

    const headers = new Headers(requests[0].headers);
    expect(headers.get("X-Mattrax-Delivery")).toBe("evt_original");
    expect(headers.get("X-Mattrax-Event")).toBe("device.enrolled");

    const body = JSON.parse(String(requests[0].body));
    expect(body.id).toBe("evt_original");

    // The original row is untouched and the replay is a separate record.
    expect(db.store.webhook_delivery).toHaveLength(2);
    expect(db.store.webhook_delivery.find((row: any) => row.id === "d-1")).toMatchObject({
      status: "succeeded",
    });
    expect(db.store.audit_log.map((row: any) => row.action)).toContain("webhook.replayed");
  });

  it("records a failed replay instead of throwing when the endpoint fails", async () => {
    const sealed = await sealSecret(authSecret, "whsec_replay");
    const fetch = vi.fn(async () => new Response("nope", { status: 503 }));

    const { db, service } = makeContext({ fetch });
    db.store.webhook_endpoint.push(endpoint("wh-1", "org-1", sealed));
    db.store.webhook_delivery.push(delivery({ id: "d-1", createdAt: now }));

    const result = await call<WebhookDeliveryReplayResponse>(
      service,
      "replayWebhookDelivery",
      "org-1",
      "wh-1",
      "d-1",
    );

    expect(result.delivery).toMatchObject({
      status: "failed",
      responseStatus: 503,
      error: "Endpoint responded with HTTP 503",
    });
    expect(db.store.webhook_delivery).toHaveLength(2);
    expect(db.store.webhook_endpoint[0]).toMatchObject({ lastDeliveryStatus: "failed" });
  });

  it("requires webhooks.write to replay", async () => {
    const { db, service } = makeContext({ role: "member" });
    db.store.webhook_endpoint.push(endpoint("wh-1"));
    db.store.webhook_delivery.push(delivery({ id: "d-1", createdAt: now }));

    await expect(
      runEffect(
        service.replayWebhookDelivery(request({ cookie: "1" }), "org-1", "wh-1", "d-1").pipe(
          Effect.provideService(RequiredPermission, {
            permission: "webhooks.write",
            method: "replayWebhookDelivery",
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
  });
});
