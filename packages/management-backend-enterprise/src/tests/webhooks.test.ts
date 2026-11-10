import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { schema } from "@mattrax/enterprise-core";
import { sealSecret } from "@mattrax/crypto";
import {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  webhookUrlProblem,
} from "@mattrax/enterprise-domain";
import {
  dispatchWebhookEvent,
  retryFailedWebhookDeliveries,
  sendTestWebhook,
  signWebhookDelivery,
  verifyWebhookSignature,
  type WebhookEndpointRow,
} from "../index.js";
import { dbRows, makeDb, tableName } from "./fake-db.js";

const authSecret = "webhook-test-secret";
const now = new Date("2026-11-11T10:00:00.000Z");

const run = <A>(effect: Effect.Effect<A, never, never>) => Effect.runPromise(effect);

const endpoint = (overrides: Partial<WebhookEndpointRow> = {}): WebhookEndpointRow => ({
  id: "wh_1",
  organizationId: "org-1",
  url: "https://hooks.example.com/mattrax",
  secret: "",
  secretPrefix: "abcd",
  description: null,
  eventFilters: [],
  enabled: true,
  lastDeliveryAt: null,
  lastDeliveryStatus: null,
  consecutiveFailures: 0,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const setup = async (overrides: Partial<WebhookEndpointRow> = {}) => {
  const secret = "whsec_test_secret";
  const db = makeDb({
    [tableName(schema.webhookEndpoint)]: [
      endpoint({ ...overrides, secret: await sealSecret(authSecret, secret) }),
    ],
  });
  return { db, secret };
};

const deliveries = (db: ReturnType<typeof makeDb>) => dbRows(db, tableName(schema.webhookDelivery));

const endpoints = (db: ReturnType<typeof makeDb>) => dbRows(db, tableName(schema.webhookEndpoint));

describe("webhook signatures", () => {
  it("signs timestamp + body and verifies constant-time", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "device.enrolled" });
    const timestamp = Math.floor(now.getTime() / 1000);
    const signature = await signWebhookDelivery("whsec_test_secret", timestamp, body);

    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await verifyWebhookSignature({
        secret: "whsec_test_secret",
        body,
        signatureHeader: `t=${timestamp},v1=${signature}`,
        nowSeconds: timestamp,
      }),
    ).toBe(true);
    expect(
      await verifyWebhookSignature({
        secret: "whsec_test_secret",
        body: `${body} `,
        signatureHeader: `t=${timestamp},v1=${signature}`,
        nowSeconds: timestamp,
      }),
    ).toBe(false);
    expect(
      await verifyWebhookSignature({
        secret: "wrong",
        body,
        signatureHeader: `t=${timestamp},v1=${signature}`,
        nowSeconds: timestamp,
      }),
    ).toBe(false);
  });

  it("rejects stale timestamps and malformed headers", async () => {
    const body = "{}";
    const timestamp = Math.floor(now.getTime() / 1000);
    const signature = await signWebhookDelivery("whsec_test_secret", timestamp, body);
    expect(
      await verifyWebhookSignature({
        secret: "whsec_test_secret",
        body,
        signatureHeader: `t=${timestamp},v1=${signature}`,
        nowSeconds: timestamp + 301,
      }),
    ).toBe(false);
    expect(
      await verifyWebhookSignature({
        secret: "whsec_test_secret",
        body,
        signatureHeader: "v1=abc",
        nowSeconds: timestamp,
      }),
    ).toBe(false);
  });
});

describe("webhook URL guard", () => {
  it("accepts a public HTTPS URL", () => {
    expect(webhookUrlProblem("https://hooks.example.com/mattrax")).toBeNull();
  });

  it.each([
    "http://hooks.example.com/mattrax",
    "https://localhost/hooks",
    "https://api.local/hooks",
    "https://127.0.0.1/hooks",
    "https://10.0.0.5/hooks",
    "https://192.168.1.10/hooks",
    "https://172.20.1.1/hooks",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/hooks",
    "https://[::ffff:7f00:1]/hooks",
    "https://[fd00::1]/hooks",
    "https://intranet/hooks",
    "https://user:pass@hooks.example.com/",
  ])("rejects %s", (url) => {
    expect(webhookUrlProblem(url)).not.toBeNull();
  });
});

describe("webhook delivery", () => {
  it("filters by event and records a successful delivery", async () => {
    const { db, secret } = await setup({ eventFilters: ["device.enrolled"] });
    const fetch = vi.fn(async () => new Response("ok", { status: 200 }));

    await run(
      dispatchWebhookEvent(
        db as never,
        {
          organizationId: "org-1",
          type: "device.enrolled",
          data: { targetType: "device", targetId: "device-1" },
          id: "evt_1",
          occurredAt: now,
        },
        { authSecret, fetch, now },
      ),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, request] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const timestamp = Number((request.headers as Record<string, string>)[WEBHOOK_TIMESTAMP_HEADER]);
    const header = (request.headers as Record<string, string>)[WEBHOOK_SIGNATURE_HEADER]!;
    expect(
      await verifyWebhookSignature({
        secret,
        body: request.body as string,
        signatureHeader: header,
        nowSeconds: timestamp,
      }),
    ).toBe(true);

    const rows = deliveries(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      endpointId: "wh_1",
      organizationId: "org-1",
      event: "device.enrolled",
      eventId: "evt_1",
      status: "succeeded",
      attempt: 1,
      responseStatus: 200,
      error: null,
    });
    expect(endpoints(db)[0]).toMatchObject({
      lastDeliveryStatus: "succeeded",
      consecutiveFailures: 0,
    });

    // A different event is filtered out and produces no extra delivery.
    await run(
      dispatchWebhookEvent(
        db as never,
        { organizationId: "org-1", type: "device.unenrolled" },
        { authSecret, fetch, now },
      ),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(deliveries(db)).toHaveLength(1);
  });

  it("treats an empty filter as all events", async () => {
    const { db } = await setup({ eventFilters: [] });
    const fetch = vi.fn(async () => new Response("ok", { status: 204 }));
    await run(
      dispatchWebhookEvent(
        db as never,
        { organizationId: "org-1", type: "device.unenrolled" },
        { authSecret, fetch, now },
      ),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never delivers to a different tenant's endpoint", async () => {
    const { db } = await setup();
    const fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    await run(
      dispatchWebhookEvent(
        db as never,
        { organizationId: "org-2", type: "device.enrolled" },
        { authSecret, fetch, now },
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(deliveries(db)).toHaveLength(0);
  });

  it("records a failed delivery and increments the failure counter", async () => {
    const { db } = await setup({ consecutiveFailures: 2 });
    const fetch = vi.fn(async () => new Response("nope", { status: 503 }));
    await run(
      dispatchWebhookEvent(
        db as never,
        { organizationId: "org-1", type: "device.enrolled", id: "evt_fail" },
        { authSecret, fetch, now },
      ),
    );

    const rows = deliveries(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "failed",
      responseStatus: 503,
      attempt: 1,
      error: "Endpoint responded with HTTP 503",
    });
    expect(endpoints(db)[0]).toMatchObject({
      lastDeliveryStatus: "failed",
      consecutiveFailures: 3,
    });
  });

  it("swallows network errors instead of failing the caller", async () => {
    const { db } = await setup();
    const fetch = vi.fn(async () => {
      throw new Error("connection refused");
    });
    await expect(
      run(
        dispatchWebhookEvent(
          db as never,
          { organizationId: "org-1", type: "device.enrolled" },
          { authSecret, fetch, now },
        ),
      ),
    ).resolves.toBeUndefined();
    expect(deliveries(db)[0]).toMatchObject({
      status: "failed",
      responseStatus: null,
      error: "Error: connection refused",
    });
  });

  it("does not deliver when no signing secret is configured", async () => {
    const { db } = await setup();
    const fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    await run(
      dispatchWebhookEvent(
        db as never,
        { organizationId: "org-1", type: "device.enrolled" },
        { fetch, now },
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends a test event regardless of filters", async () => {
    const { db } = await setup({ eventFilters: ["device.enrolled"] });
    const fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const [row] = endpoints(db) as unknown as WebhookEndpointRow[];
    const outcome = await run(
      sendTestWebhook(
        db as never,
        { ...row, secret: (row as any).secret },
        { authSecret, fetch, now },
      ),
    );
    expect(outcome.status).toBe("succeeded");
    expect(deliveries(db)[0]).toMatchObject({ event: "webhook.test", status: "succeeded" });
  });
});

describe("webhook retries", () => {
  it("retries a failed delivery once and records the new attempt", async () => {
    const { db } = await setup();
    const [row] = endpoints(db);
    db.store[tableName(schema.webhookDelivery)] = [
      {
        __table: tableName(schema.webhookDelivery),
        id: "whd_1",
        endpointId: "wh_1",
        organizationId: "org-1",
        event: "device.enrolled",
        eventId: "evt_1",
        payload: {
          id: "evt_1",
          type: "device.enrolled",
          occurredAt: now.toISOString(),
          organizationId: "org-1",
          data: {},
        },
        status: "failed",
        attempt: 1,
        responseStatus: 500,
        error: "Endpoint responded with HTTP 500",
        createdAt: now,
      },
    ];
    const fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const result = await run(
      retryFailedWebhookDeliveries(db as never, {
        authSecret,
        fetch,
        now: new Date(now.getTime() + 60_000),
        maxAttempts: 3,
      }),
    );
    expect(result).toEqual({ retried: 1, succeeded: 1, failed: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(deliveries(db)[0]).toMatchObject({
      status: "succeeded",
      attempt: 2,
      responseStatus: 200,
      error: null,
    });
    expect(row).toBeDefined();
  });

  it("leaves exhausted rows alone", async () => {
    const { db } = await setup();
    db.store[tableName(schema.webhookDelivery)] = [
      {
        __table: tableName(schema.webhookDelivery),
        id: "whd_1",
        endpointId: "wh_1",
        organizationId: "org-1",
        event: "device.enrolled",
        eventId: "evt_1",
        payload: { id: "evt_1", type: "device.enrolled", organizationId: "org-1", data: {} },
        status: "failed",
        attempt: 3,
        responseStatus: 500,
        error: "nope",
        createdAt: now,
      },
    ];
    const fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const result = await run(
      retryFailedWebhookDeliveries(db as never, {
        authSecret,
        fetch,
        now,
        maxAttempts: 3,
      }),
    );
    expect(result.retried).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
