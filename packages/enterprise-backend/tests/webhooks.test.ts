import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createEnterpriseService } from "../src/enterpriseHandlers.js";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";
const authSecret = "enterprise-test-secret";
const now = new Date("2026-11-11T10:00:00.000Z");

const makeContext = (options: { role?: string; fetch?: typeof globalThis.fetch } = {}) => {
  const db = makeDb();
  db.store.user.push({
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
      logo: null,
      displayName: null,
      supportEmail: null,
      brandColor: null,
      metadata: null,
      stripeCustomerId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "org-2",
      name: "Other",
      slug: "other",
      logo: null,
      displayName: null,
      supportEmail: null,
      brandColor: null,
      metadata: null,
      stripeCustomerId: null,
      createdAt: now,
      updatedAt: now,
    },
  );
  db.store.member.push(
    {
      id: "member-1",
      organizationId: "org-1",
      userId: "user-1",
      role: options.role ?? "owner",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "member-2",
      organizationId: "org-2",
      userId: "user-1",
      role: "owner",
      createdAt: now,
      updatedAt: now,
    },
  );

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie
        ? Effect.succeed({ user: db.store.user[0], apiToken: undefined })
        : Effect.fail({ _tag: "EnterpriseUnauthorized", message: "Unauthenticated" });
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
  };

  const service = createEnterpriseService({
    db: db as any,
    schema,
    origin,
    storage: {} as any,
    auth: auth as any,
    authSecret,
    webhookFetch: options.fetch,
  });

  return { db, service, headers: { cookie: "mattrax_session=test" } };
};

const create = (service: any, payload: Record<string, unknown>, tenantId = "org-1") =>
  runEffect(service.createWebhookEndpoint(request({ cookie: "1" }) as any, tenantId, payload));

const list = (service: any, tenantId = "org-1") =>
  runEffect(service.listWebhookEndpoints(request({ cookie: "1" }) as any, tenantId));

describe("webhook endpoint CRUD", () => {
  it("creates an endpoint and returns the signing secret exactly once", async () => {
    const { db, service } = makeContext();

    const created = await create(service, {
      url: "https://hooks.example.com/mattrax",
      description: "SIEM",
      events: ["device.enrolled", "device.enrolled", "not.real"],
      enabled: true,
    });

    expect(created.secret).toMatch(/^whsec_/);
    expect(created.endpoint).toMatchObject({
      url: "https://hooks.example.com/mattrax",
      description: "SIEM",
      events: ["device.enrolled"],
      enabled: true,
      consecutiveFailures: 0,
      secretPrefix: created.secret.slice(-4),
    });
    expect(created.endpoint.secret).toBeUndefined();

    const stored = db.store.webhook_endpoint[0]!;
    expect(stored.secret).not.toBe(created.secret);
    expect(String(stored.secret)).not.toContain(created.secret);

    const listed = await list(service);
    expect(listed.endpoints).toHaveLength(1);
    expect(listed.endpoints[0].secret).toBeUndefined();
    expect(db.store.audit_log.map((row) => row.action)).toContain("webhook.created");
  });

  it("rejects non-HTTPS, private and credential-bearing URLs", async () => {
    const { service } = makeContext();

    for (const url of [
      "http://hooks.example.com/mattrax",
      "https://127.0.0.1/mattrax",
      "https://localhost/mattrax",
      "https://user:pass@hooks.example.com/mattrax",
    ]) {
      await expect(create(service, { url, events: [] })).rejects.toMatchObject({
        _tag: "EnterpriseBadRequest",
      });
    }
  });

  it("updates, rotates and deletes an endpoint", async () => {
    const { db, service, headers } = makeContext();

    const created = await create(service, {
      url: "https://hooks.example.com/a",
      events: ["device.enrolled"],
    });

    const patched = await runEffect(
      service.patchWebhookEndpoint(request(headers) as any, "org-1", created.endpoint.id, {
        url: "https://hooks.example.com/b",
        events: ["device.unenrolled"],
        enabled: false,
      }),
    );

    expect(patched).toMatchObject({
      url: "https://hooks.example.com/b",
      events: ["device.unenrolled"],
      enabled: false,
    });

    const rotated = await runEffect(
      service.rotateWebhookSecret(request(headers) as any, "org-1", created.endpoint.id),
    );

    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(created.secret);
    expect(db.store.webhook_endpoint[0]!.secretPrefix).toBe(rotated.secret.slice(-4));

    await runEffect(
      service.deleteWebhookEndpoint(request(headers) as any, "org-1", created.endpoint.id),
    );
    expect(db.store.webhook_endpoint).toHaveLength(0);
    expect(db.store.audit_log.map((row) => row.action)).toEqual(
      expect.arrayContaining(["webhook.updated", "webhook.secret_rotated", "webhook.deleted"]),
    );
  });

  it("is tenant-scoped for every operation", async () => {
    const { service, headers } = makeContext();

    const created = await create(service, {
      url: "https://hooks.example.com/a",
      events: [],
    });

    // The same user owns org-2, but must not see or mutate org-1's endpoint.
    expect((await list(service, "org-2")).endpoints).toHaveLength(0);
    await expect(
      runEffect(
        service.patchWebhookEndpoint(request(headers) as any, "org-2", created.endpoint.id, {
          enabled: false,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });
    await expect(
      runEffect(
        service.deleteWebhookEndpoint(request(headers) as any, "org-2", created.endpoint.id),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });
    await expect(
      runEffect(service.rotateWebhookSecret(request(headers) as any, "org-2", created.endpoint.id)),
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });
    expect((await list(service, "org-2")).endpoints).toHaveLength(0);
  });

  it("limits the whole surface to owners and admins", async () => {
    const { service, headers } = makeContext({ role: "member" });
    await expect(list(service)).rejects.toMatchObject({
      _tag: "EnterprisePermissionDenied",
    });
    await expect(
      create(service, { url: "https://hooks.example.com/a", events: [] }),
    ).rejects.toMatchObject({ _tag: "EnterprisePermissionDenied" });

    const auditor = makeContext({ role: "auditor" });
    await expect(list(auditor.service)).rejects.toMatchObject({
      _tag: "EnterprisePermissionDenied",
    });

    const admin = makeContext({ role: "admin" });
    await expect(list(admin.service)).resolves.toMatchObject({ endpoints: [] });
    expect(headers.cookie).toBeDefined();
  });
});

describe("webhook test delivery", () => {
  it("sends a test event and records the outcome", async () => {
    const fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const { db, service, headers } = makeContext({ fetch });

    const created = await create(service, {
      url: "https://hooks.example.com/a",
      events: ["device.enrolled"],
    });

    const result = await runEffect(
      service.testWebhookEndpoint(request(headers) as any, "org-1", created.endpoint.id),
    );

    expect(result.status).toBe("succeeded");
    expect(result.responseStatus).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.store.webhook_delivery[0]).toMatchObject({
      event: "webhook.test",
      status: "succeeded",
      attempt: 1,
      responseStatus: 200,
    });
    expect(db.store.webhook_endpoint[0]).toMatchObject({
      lastDeliveryStatus: "succeeded",
      consecutiveFailures: 0,
    });
  });

  it("reports a failing endpoint without throwing", async () => {
    const fetch = vi.fn(async () => new Response("nope", { status: 500 }));
    const { db, service, headers } = makeContext({ fetch });

    const created = await create(service, {
      url: "https://hooks.example.com/a",
      events: [],
    });

    const result = await runEffect(
      service.testWebhookEndpoint(request(headers) as any, "org-1", created.endpoint.id),
    );

    expect(result).toMatchObject({
      status: "failed",
      responseStatus: 500,
      error: "Endpoint responded with HTTP 500",
    });
    expect(db.store.webhook_endpoint[0]).toMatchObject({
      lastDeliveryStatus: "failed",
      consecutiveFailures: 1,
    });
  });
});

describe("webhook event emission", () => {
  it("emits device.unenrolled when an administrator deletes a device", async () => {
    const fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const { db, service, headers } = makeContext({ fetch });
    db.store.device.push({
      id: "device-1",
      organizationId: "org-1",
      proto: "apple",
      status: "enrolled",
      name: "Mac",
      serial: "SERIAL-1",
      enrolledAt: now,
      lastSeenAt: now,
    });
    await create(service, {
      url: "https://hooks.example.com/a",
      events: ["device.unenrolled"],
    });

    await runEffect(service.deleteDevices(request(headers) as any, "org-1", ["device-1"]));
    expect(db.store.device).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.store.webhook_delivery[0]).toMatchObject({
      event: "device.unenrolled",
      status: "succeeded",
    });
  });

  it("emits enrollment.attempt_failed for a bad enrollment password", async () => {
    const fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const { db, service } = makeContext({ fetch });
    db.store.enterprise_enrollment.push({
      id: "enr-1",
      organizationId: "org-1",
      code: "right-code",
      enabledApple: true,
      enabledWindows: true,
      enabledAndroid: false,
      enabledAssetTag: false,
      maxDevices: 100,
      createdAt: now,
      updatedAt: now,
    });
    await create(service, { url: "https://hooks.example.com/a", events: [] });

    const result = await runEffect(
      service.getEnrollment("enr-1", "wrong-code", { platform: "apple", ip: "203.0.113.9" }),
    );

    expect(result.authenticated).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.store.webhook_delivery[0]).toMatchObject({
      event: "enrollment.attempt_failed",
      status: "succeeded",
    });
    expect(JSON.stringify(db.store.webhook_delivery[0]!.payload)).toContain("bad_code");
  });
});
