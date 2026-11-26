import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { EnterpriseForbidden, EnterpriseUnauthorized } from "@mattrax/enterprise-domain";
import { parsePlanLimits, planLimitsFor } from "@mattrax/enterprise-core";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

/** Assert a service call rejected with the forbidden tag and message fragment. */
const expectForbidden = async (run: Promise<unknown>, message?: string) => {
  const failure = await run.catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(EnterpriseForbidden);

  if (message !== undefined)
    expect(failure).toMatchObject({ message: expect.stringContaining(message) });
};

const origin = "https://enterprise.test";

const authSecret = "enterprise-test-secret";

const planConfig = () =>
  parsePlanLimits(
    JSON.stringify({
      free: { devices: 1, tenants: 1 },
      device: { devices: null, tenants: null },
    }),
  );

const makeContext = (planLimits = planConfig()) => {
  const db = makeDb();
  const now = new Date();

  const user = {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  };

  db.store.account.push(user);

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie
        ? Effect.succeed({ user })
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
    // SAFETY: this test never reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret,
    planLimits,
  });

  return { db, service, headers: { cookie: "mattrax_session=test" } };
};

const addDevice = (db: ReturnType<typeof makeDb>, organizationId: string, id: string) => {
  const now = new Date();
  db.store.device.push({
    id,
    organizationId,
    proto: "apple",
    status: "enrolled",
    name: id,
    enrolledAt: now,
    lastSeenAt: now,
  });
};

const setBilling = (
  db: ReturnType<typeof makeContext>["db"],
  tenantId: string,
  plan: string,
  status: string,
) => {
  const organization = db.store.organization.find((row: any) => row.id === tenantId);

  if (!organization) throw new Error(`missing organization ${tenantId}`);

  organization.billingPlan = plan;
  organization.billingStatus = status;
};

describe("MATTRAX_PLAN_LIMITS parsing", () => {
  it("parses a flat plan catalogue", () => {
    const config = parsePlanLimits(
      JSON.stringify({
        free: { devices: 50, tenants: 1 },
        device: { devices: null, tenants: null },
      }),
    );

    expect(config.configured).toBe(true);
    expect(config.defaultPlan).toBe("free");
    expect(config.warnings).toEqual([]);
    expect(config.plans.free).toEqual({ devices: 50, tenants: 1 });
    expect(config.plans.device).toEqual({ devices: null, tenants: null });
    expect(planLimitsFor(config, "free")).toEqual({ devices: 50, tenants: 1 });
    expect(planLimitsFor(config, "device")).toEqual({ devices: null, tenants: null });
  });

  it("accepts a nested catalogue with a configured default plan", () => {
    const config = parsePlanLimits(
      JSON.stringify({
        defaultPlan: "team",
        plans: { team: { devices: 10 }, legacy: { tenants: 2 } },
      }),
    );

    expect(config.configured).toBe(true);
    expect(config.defaultPlan).toBe("team");
    // Missing limits are unlimited.
    expect(config.plans.team).toEqual({ devices: 10, tenants: null });
    expect(config.plans.legacy).toEqual({ devices: null, tenants: 2 });
    expect(planLimitsFor(config, undefined)).toEqual({ devices: 10, tenants: null });
  });

  it("treats absent and empty configuration as unlimited", () => {
    for (const raw of [undefined, null, "", "   "]) {
      const config = parsePlanLimits(raw);
      expect(config.configured).toBe(false);
      expect(config.warnings).toEqual([]);
      expect(planLimitsFor(config, "free")).toEqual({ devices: null, tenants: null });
    }
  });

  it("fails safe on invalid JSON", () => {
    const config = parsePlanLimits("{not json");
    expect(config.configured).toBe(false);
    expect(config.warnings).toHaveLength(1);
    expect(planLimitsFor(config, "free")).toEqual({ devices: null, tenants: null });
  });

  it("fails safe on negative and non-integer limits", () => {
    const config = parsePlanLimits(
      JSON.stringify({
        free: { devices: -1, tenants: 1.5 },
        broken: "nope",
      }),
    );

    expect(config.configured).toBe(true);
    expect(config.plans.free).toEqual({ devices: null, tenants: null });
    expect(config.plans.broken).toBeUndefined();
    expect(config.warnings).toHaveLength(3);
    expect(planLimitsFor(config, "free")).toEqual({ devices: null, tenants: null });
  });

  it("treats unknown plans as unlimited", () => {
    const config = parsePlanLimits(JSON.stringify({ free: { devices: 1 } }));
    expect(planLimitsFor(config, "enterprise")).toEqual({ devices: null, tenants: null });
    expect(planLimitsFor(undefined, "free")).toEqual({ devices: null, tenants: null });
  });
});

describe("enterprise service plan limits", () => {
  it("enforces the tenant creation limit for the default plan", async () => {
    const { service, headers } = makeContext();
    await runEffect(service.createTenant(request(headers), { name: "Acme", slug: "acme" }));
    await expectForbidden(
      runEffect(service.createTenant(request(headers), { name: "Second", slug: "second" })),
      "allows 1 tenant",
    );
  });

  it("uses the most permissive owned plan for tenant creation", async () => {
    const { db, service, headers } = makeContext();

    const first = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    setBilling(db, first.id, "device", "active");

    await expect(
      runEffect(service.createTenant(request(headers), { name: "Second", slug: "second" })),
    ).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("downgrades a canceled subscription to the default plan", async () => {
    const { db, service, headers } = makeContext();

    const first = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    setBilling(db, first.id, "device", "canceled");

    await expectForbidden(
      runEffect(service.createTenant(request(headers), { name: "Second", slug: "second" })),
    );
  });

  it("blocks new enrollments once the device limit is reached", async () => {
    const { db, service } = makeContext();

    const tenant = await runEffect(
      service.createTenant(request({ cookie: "mattrax_session=test" }), {
        name: "Acme",
        slug: "acme",
      }),
    );

    Object.assign(db.store.enterprise_enrollment[0], { enabledWindows: true, maxDevices: 100 });

    const allowed = await runEffect(service.getEnrollment(tenant.id, undefined));

    if (!allowed.authenticated) throw new Error("expected authenticated enrollment");
    expect(allowed.deviceLimit).toEqual({ reached: false, plan: "free", limit: 1, used: 0 });
    expect(allowed.windows).toMatchObject({ tenantScoped: true });

    // One device fills the plan's single slot; adding another is blocked.
    addDevice(db, tenant.id, "device-1");
    const blocked = await runEffect(service.getEnrollment(tenant.id, undefined));

    if (!blocked.authenticated) throw new Error("expected authenticated enrollment");
    expect(blocked.deviceLimit).toEqual({ reached: true, plan: "free", limit: 1, used: 1 });
    expect(blocked.windows).toEqual({
      error:
        "The device limit for this plan has been reached. Contact your administrator to upgrade.",
    });
    expect(db.store.enrollment_attempt.at(-1)).toMatchObject({ outcome: "limit" });
  });

  it("keeps existing devices manageable after the limit is lowered", async () => {
    const { db, service, headers } = makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    addDevice(db, tenant.id, "device-1");
    addDevice(db, tenant.id, "device-2");

    const summary = await runEffect(service.billing(request(headers), tenant.id));
    expect(summary).toMatchObject({
      deviceLimit: 1,
      devicesUsed: 2,
      overDeviceLimit: true,
      limitsConfigured: true,
    });

    await expect(
      runEffect(service.patchDevice(request(headers), tenant.id, "device-2", { name: "Renamed" })),
    ).resolves.toBeDefined();
    expect(db.store.device.find((device: any) => device.id === "device-2")?.name).toBe("Renamed");
  });

  it("resolves the device limit from the tenant subscription plan", async () => {
    const { db, service, headers } = makeContext(
      parsePlanLimits(JSON.stringify({ free: { devices: 1 }, team: { devices: 3 } })),
    );

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    setBilling(db, tenant.id, "team", "active");
    addDevice(db, tenant.id, "device-1");
    addDevice(db, tenant.id, "device-2");

    await expect(runEffect(service.billing(request(headers), tenant.id))).resolves.toMatchObject({
      plan: "team",
      deviceLimit: 3,
      devicesUsed: 2,
      overDeviceLimit: false,
    });

    setBilling(db, tenant.id, "team", "canceled");
    await expect(runEffect(service.billing(request(headers), tenant.id))).resolves.toMatchObject({
      plan: "free",
      deviceLimit: 1,
      devicesUsed: 2,
      overDeviceLimit: true,
    });
  });

  it("reports usage and limits in the billing summary", async () => {
    const { db, service, headers } = makeContext(
      parsePlanLimits(JSON.stringify({ free: { devices: 5, tenants: 3 } })),
    );

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    addDevice(db, tenant.id, "device-1");

    await expect(runEffect(service.billing(request(headers), tenant.id))).resolves.toMatchObject({
      plan: "free",
      deviceLimit: 5,
      tenantLimit: 3,
      devicesUsed: 1,
      tenantsUsed: 1,
      overDeviceLimit: false,
      overTenantLimit: false,
      limitsConfigured: true,
      billableDevices: 1,
    });
  });

  it("limits pre-registration imports to the remaining device capacity", async () => {
    const { db, service, headers } = makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const result = await runEffect(
      service.importDevicePreRegistrations(request(headers), tenant.id, {
        rows: [{ serial: "AAA" }, { serial: "BBB" }],
      }),
    );

    expect(result).toMatchObject({ created: 1, failed: 1, updated: 0 });
    expect(result.results[1]).toMatchObject({
      serial: "BBB",
      status: "error",
      error: expect.stringContaining("device limit"),
    });
    expect(db.store.device_pre_registration).toHaveLength(1);

    // Updating the accepted row is still allowed at the limit.
    await expect(
      runEffect(
        service.importDevicePreRegistrations(request(headers), tenant.id, {
          rows: [{ serial: "AAA", name: "Lab Mac" }],
        }),
      ),
    ).resolves.toMatchObject({ created: 0, updated: 1, failed: 0 });
  });

  it("does not double-count consumed pre-registrations against capacity", async () => {
    const { db, service, headers } = makeContext(
      parsePlanLimits(JSON.stringify({ free: { devices: 2, tenants: 1 } })),
    );

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme-consumed" }),
    );

    await runEffect(
      service.importDevicePreRegistrations(request(headers), tenant.id, {
        rows: [{ serial: "AAA" }],
      }),
    );
    // Simulate AAA enrolling: the pre-registration is consumed and its device
    // row occupies one of the two plan seats.
    db.store.device_pre_registration[0].consumedDeviceId = "device-1";
    addDevice(db, tenant.id, "device-1");

    const result = await runEffect(
      service.importDevicePreRegistrations(request(headers), tenant.id, {
        rows: [{ serial: "BBB" }],
      }),
    );

    // One seat remains (2 - 1 used - 0 unconsumed). The consumed AAA row must
    // not reserve a second seat.
    expect(result).toMatchObject({ created: 1, updated: 0, failed: 0 });
    expect(db.store.device_pre_registration).toHaveLength(2);
  });
});
