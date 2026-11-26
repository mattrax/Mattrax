import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { EnterpriseNotFound, EnterpriseUnauthorized } from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const authSecret = "enterprise-test-secret";

const makeContext = async (options: { readonly windowsFailureRetentionDays?: number } = {}) => {
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
    windowsFailureRetentionDays: options.windowsFailureRetentionDays,
  });

  const headers = { cookie: "mattrax_session=test" };

  return { db, service, headers };
};

const seedWindowsDevice = (db: ReturnType<typeof makeDb>, organizationId: string, id: string) => {
  const now = new Date("2026-01-01T00:00:00Z");

  db.store.device.push({
    id,
    organizationId,
    proto: "win",
    status: "enrolled",
    name: `DESKTOP-${id}`,
    serial: `SERIAL-${id}`,
    enrolledAt: now,
    lastSeenAt: now,
  });
};

const seedFailure = (
  db: ReturnType<typeof makeDb>,
  input: {
    id: string;
    organizationId: string;
    deviceId?: string | null;
    phase?: "discovery" | "wstep" | "enrollment" | "policy" | "command";
    code?: string;
    message?: string;
    createdAt: Date;
  },
) =>
  db.store.windows_failure.push({
    id: input.id,
    organizationId: input.organizationId,
    deviceId: input.deviceId ?? null,
    deviceIdentifier: `device-${input.id}`,
    serial: null,
    hostname: null,
    phase: input.phase ?? "enrollment",
    code: input.code ?? "windows_disabled",
    message: input.message ?? `Failure ${input.id}`,
    detail: null,
    createdAt: input.createdAt,
  });

describe("Windows failure history API", () => {
  it("returns the newest failures for one device, scoped to the tenant", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const other = await runEffect(
      service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    seedWindowsDevice(db, tenant.id, "win-1");
    seedWindowsDevice(db, tenant.id, "win-2");

    const newerAt = new Date(Date.now() - 1_000);

    seedFailure(db, {
      id: "older",
      organizationId: tenant.id,
      deviceId: "win-1",
      createdAt: new Date(newerAt.getTime() - 1_000),
    });
    seedFailure(db, {
      id: "newer",
      organizationId: tenant.id,
      deviceId: "win-1",
      phase: "wstep",
      code: "certificate_signing_failed",
      createdAt: newerAt,
    });
    seedFailure(db, {
      id: "sibling",
      organizationId: tenant.id,
      deviceId: "win-2",
      createdAt: new Date(),
    });
    seedFailure(db, {
      id: "other-tenant",
      organizationId: other.id,
      deviceId: null,
      createdAt: new Date(),
    });

    const row = await runEffect(
      service.listWindowsFailures(request(headers), tenant.id, { deviceId: "win-1" }),
    );

    expect(row.failures.map((failure) => failure.id)).toEqual(["newer", "older"]);
    expect(row.count).toBe(2);
    expect(row.failures[0]).toMatchObject({
      phase: "wstep",
      code: "certificate_signing_failed",
      deviceId: "win-1",
      at: newerAt.toISOString(),
    });
  });

  it("summarises tenant failures for delivery diagnostics", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const other = await runEffect(
      service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    const now = new Date();

    seedFailure(db, {
      id: "recent",
      organizationId: tenant.id,
      code: "device_limit_reached",
      message: "The tenant's device limit has been reached.",
      createdAt: now,
    });
    seedFailure(db, {
      id: "stale",
      organizationId: tenant.id,
      createdAt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
    });
    seedFailure(db, {
      id: "other-tenant",
      organizationId: other.id,
      createdAt: now,
    });

    const health = await runEffect(
      service.listWindowsFailures(request(headers), tenant.id, { limit: 5 }),
    );

    // The count only covers the retention window, matching the "in 30 days"
    // label; the list itself is append-only history until maintenance prunes it.
    expect(health.retentionDays).toBe(30);
    expect(health.count).toBe(1);
    expect(health.failures.map((failure) => failure.id)).toEqual(["recent", "stale"]);
    expect(health.failures[0]).toEqual(
      expect.objectContaining({
        id: "recent",
        deviceId: null,
        code: "device_limit_reached",
        phase: "enrollment",
      }),
    );
  });

  it("rejects a device filter that belongs to another tenant", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const other = await runEffect(
      service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    seedWindowsDevice(db, other.id, "other-device");

    await expect(
      runEffect(
        service.listWindowsFailures(request(headers), tenant.id, { deviceId: "other-device" }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("counts everything when the retention window is disabled", async () => {
    const { db, service, headers } = await makeContext({ windowsFailureRetentionDays: 0 });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seedFailure(db, {
      id: "recent",
      organizationId: tenant.id,
      createdAt: new Date(),
    });
    seedFailure(db, {
      id: "ancient",
      organizationId: tenant.id,
      createdAt: new Date("2020-01-01T00:00:00Z"),
    });

    const history = await runEffect(
      service.listWindowsFailures(request(headers), tenant.id, { limit: 5 }),
    );

    expect(history.retentionDays).toBe(0);
    expect(history.count).toBe(2);
  });
});
