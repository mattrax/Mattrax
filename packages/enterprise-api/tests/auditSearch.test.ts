import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { EnterpriseUnauthorized } from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const authSecret = "enterprise-test-secret";

const makeContext = async () => {
  const db = makeDb();
  const now = new Date();

  db.store.account.push({
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  });

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
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    // SAFETY: these tests never reach R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret,
  });

  const headers = { cookie: "mattrax_session=test" };

  return { db, service, headers };
};

const seedAudit = (
  db: ReturnType<typeof makeDb>,
  input: {
    id: string;
    organizationId: string;
    action: string;
    category?: "account" | "mdm" | "system";
    actorType?: "account" | "system" | "api-token";
    actorAccountId?: string | null;
    actorEmail?: string | null;
    targetType?: string;
    targetId?: string | null;
    deviceId?: string | null;
    protocol?: "apple" | "win" | "android" | null;
    ip?: string | null;
    certificateSerial?: string | null;
    createdAt?: Date;
  },
) =>
  db.store.audit_log.push({
    id: input.id,
    organizationId: input.organizationId,
    actorAccountId: input.actorAccountId ?? null,
    actorEmail: input.actorEmail ?? null,
    actorType: input.actorType ?? (input.actorAccountId ? "account" : "system"),
    category: input.category ?? "account",
    action: input.action,
    targetType: input.targetType ?? "device",
    targetId: input.targetId ?? null,
    metadata: null,
    ip: input.ip ?? null,
    userAgent: null,
    deviceId: input.deviceId ?? null,
    deviceCertificateFingerprint: null,
    deviceCertificateSerial: input.certificateSerial ?? null,
    protocol: input.protocol ?? null,
    createdAt: input.createdAt ?? new Date(),
  });

describe("organisation audit search", () => {
  const setup = async () => {
    const context = await makeContext();

    const tenant = await runEffect(
      context.service.createTenant(request(context.headers), { name: "Acme", slug: "acme" }),
    );

    const other = await runEffect(
      context.service.createTenant(request(context.headers), { name: "Other", slug: "other" }),
    );

    seedAudit(context.db, {
      id: "account-1",
      organizationId: tenant.id,
      action: "policy.updated",
      actorAccountId: "user-1",
      actorEmail: "owner@example.com",
    });
    seedAudit(context.db, {
      id: "mdm-1",
      organizationId: tenant.id,
      action: "mdm.checkin",
      category: "mdm",
      actorType: "system",
      actorEmail: "system",
      deviceId: "device-1",
      targetId: "device-1",
      protocol: "apple",
      ip: "203.0.113.9",
      certificateSerial: "0a1b",
    });
    seedAudit(context.db, {
      id: "mdm-other",
      organizationId: other.id,
      action: "mdm.checkin",
      category: "mdm",
      actorType: "system",
      actorEmail: "system",
      deviceId: "device-2",
      targetId: "device-2",
      protocol: "apple",
      ip: "198.51.100.4",
    });

    return { ...context, tenant, other };
  };

  it("filters by category, protocol, actor type and device", async () => {
    const { service, headers, tenant } = await setup();

    const mdm = await runEffect(
      service.searchAuditLog(request(headers), tenant.id, { category: "mdm" }),
    );

    expect(mdm.entries.map((entry) => entry.id)).toEqual(["mdm-1"]);
    expect(mdm.entries[0]).toMatchObject({
      action: "mdm.checkin",
      category: "mdm",
      actorType: "system",
      actorEmail: "system",
      protocol: "apple",
      deviceId: "device-1",
      ip: "203.0.113.9",
      deviceCertificateSerial: "0a1b",
    });

    const account = await runEffect(
      service.searchAuditLog(request(headers), tenant.id, {
        actorType: "account",
        action: "policy.updated",
      }),
    );

    expect(account.entries.map((entry) => entry.id)).toEqual(["account-1"]);

    const byDevice = await runEffect(
      service.searchAuditLog(request(headers), tenant.id, { deviceId: "device-1" }),
    );

    expect(byDevice.entries.map((entry) => entry.id)).toEqual(["mdm-1"]);

    const byProtocol = await runEffect(
      service.searchAuditLog(request(headers), tenant.id, { protocol: "win" }),
    );

    expect(byProtocol.entries).toEqual([]);
  });

  it("searches free text across the addressing and certificate columns", async () => {
    const { service, headers, tenant } = await setup();

    const byIp = await runEffect(
      service.searchAuditLog(request(headers), tenant.id, { q: "203.0.113.9" }),
    );

    expect(byIp.entries.map((entry) => entry.id)).toEqual(["mdm-1"]);

    const bySerial = await runEffect(
      service.searchAuditLog(request(headers), tenant.id, { q: "0a1b" }),
    );

    expect(bySerial.entries.map((entry) => entry.id)).toEqual(["mdm-1"]);
  });

  it("never returns another tenant's events", async () => {
    const { service, headers, tenant } = await setup();

    const result = await runEffect(
      service.searchAuditLog(request(headers), tenant.id, { category: "mdm" }),
    );

    expect(result.entries.map((entry) => entry.id)).not.toContain("mdm-other");
  });

  it("exports the new fields in both formats", async () => {
    const { service, headers, tenant } = await setup();

    const csv = await runEffect(
      service.exportAuditLog(request(headers), tenant.id, { format: "csv", category: "mdm" }),
    );

    expect(csv.rowCount).toBe(1);
    expect(csv.body).toContain("Time,Actor,Actor type,Category,Action");
    expect(csv.body).toContain("mdm.checkin");
    expect(csv.body).toContain("203.0.113.9");
    expect(csv.body).not.toContain("198.51.100.4");

    const json = await runEffect(
      service.exportAuditLog(request(headers), tenant.id, { format: "json", category: "mdm" }),
    );

    const entries = JSON.parse(json.body);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "mdm-1",
      category: "mdm",
      actorType: "system",
      protocol: "apple",
      deviceId: "device-1",
      ip: "203.0.113.9",
      deviceCertificateSerial: "0a1b",
    });
  });
});
