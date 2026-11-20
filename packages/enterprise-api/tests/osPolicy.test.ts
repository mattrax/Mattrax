import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterprisePermissionDenied,
  EnterpriseUnauthorized,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { SOFA_MACOS_FEED_URL } from "@mattrax/enterprise-backend";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const authSecret = "enterprise-test-secret";

const now = new Date("2026-11-20T12:00:00.000Z");

const release = (version: string) => ({
  version,
  releaseDate: null,
  securityInfoUrl: null,
  activelyExploited: false,
});

/** A tiny SOFA catalog so macOS devices above their minimum can be evaluated. */
const seedCatalog = (db: ReturnType<typeof makeDb>) => {
  db.store.software_update_feed.push({
    id: "sofa-macos",
    sourceUrl: SOFA_MACOS_FEED_URL,
    payload: {
      updateHash: null,
      majors: [
        {
          major: 15,
          label: "macOS 15",
          latest: release("15.1"),
          releases: [release("15.1"), release("15.0")],
        },
        {
          major: 14,
          label: "macOS 14",
          latest: release("14.7"),
          releases: [release("14.7"), release("14.6")],
        },
      ],
    },
    fetchedAt: new Date(),
    checkedAt: new Date(),
    lastError: null,
  });
};

const makeContext = async () => {
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
    stripeClient: makeStripeClient(),
    // SAFETY: these tests never reach R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret,
    // Tests run offline; the seeded cache row is enough for macOS evaluation.
    softwareUpdateFetch: undefined,
    softwareUpdateCacheTtlMs: 6 * 60 * 60 * 1_000,
  });

  seedCatalog(db);

  return { db, service, headers: { cookie: "mattrax_session=test" } };
};

const seedDevice = (
  db: ReturnType<typeof makeDb>,
  organizationId: string,
  input: {
    id: string;
    proto: "apple" | "win" | "android";
    osVersion?: string | null;
    osEdition?: string | null;
    model?: string | null;
    status?: string;
  },
) =>
  db.store.device.push({
    id: input.id,
    organizationId,
    proto: input.proto,
    status: input.status ?? "enrolled",
    name: `Device ${input.id}`,
    osVersion: input.osVersion ?? null,
    osEdition: input.osEdition ?? null,
    model: input.model ?? null,
    enrolledAt: now,
    lastSeenAt: now,
  });

describe("tenant OS policy API", () => {
  it("returns every platform with inert defaults", async () => {
    const { service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const policy = await runEffect(service.getTenantOsPolicy(request(headers), tenant.id));

    expect(policy.platforms.map((entry: any) => entry.platform)).toEqual([
      "macos",
      "windows",
      "android",
    ]);
    expect(policy.platforms.every((entry: any) => entry.enforcement === "off")).toBe(true);
    expect(policy.platforms[0].capability.minimumVersionEnforced).toBe(true);
    expect(policy.platforms[1].capability.minimumVersionEnforced).toBe(false);
  });

  it("saves a rule and computes the deferral deadline", async () => {
    const { service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const saved = await runEffect(
      service.patchTenantOsPolicy(request(headers), tenant.id, {
        platforms: [
          {
            platform: "macos",
            minimumVersion: "macOS 15.0",
            enforcement: "enforce",
            deferralDays: 7,
          },
        ],
      }),
    );

    const macos = saved.platforms.find((entry: any) => entry.platform === "macos");

    expect(macos.minimumVersion).toBe("15.0");
    expect(macos.enforcement).toBe("enforce");
    expect(macos.deferralDays).toBe(7);
    expect(macos.deferralEndsAt).toBeTruthy();
    expect(new Date(macos.deferralEndsAt).getTime() - new Date(macos.updatedAt).getTime()).toBe(
      7 * 24 * 60 * 60 * 1_000,
    );
  });

  it("rejects an unparseable version and enforcement without a minimum", async () => {
    const { service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    await expect(
      runEffect(
        service.patchTenantOsPolicy(request(headers), tenant.id, {
          platforms: [{ platform: "macos", minimumVersion: "Sonoma", enforcement: "warn" }],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      runEffect(
        service.patchTenantOsPolicy(request(headers), tenant.id, {
          platforms: [{ platform: "android", enforcement: "enforce" }],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("keeps policies tenant-scoped", async () => {
    const { service, headers } = await makeContext();

    const first = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const second = await runEffect(
      service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    await runEffect(
      service.patchTenantOsPolicy(request(headers), first.id, {
        platforms: [{ platform: "windows", minimumVersion: "10.0.22631", enforcement: "warn" }],
      }),
    );

    const other = await runEffect(service.getTenantOsPolicy(request(headers), second.id));

    expect(
      other.platforms.find((entry: any) => entry.platform === "windows").minimumVersion,
    ).toBeNull();
  });

  it("denies policy writes to a read-only member", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const membership = db.store.member.find(
      (row: any) => row.organizationId === tenant.id && row.accountId === "user-1",
    )!;

    membership.role = "member";

    await expect(
      runEffect(
        service.patchTenantOsPolicy(request(headers), tenant.id, {
          platforms: [{ platform: "macos", minimumVersion: "15.0", enforcement: "warn" }],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);

    // Reads remain available: compliance is fleet inventory, not a secret.
    await expect(
      runEffect(service.getTenantOsPolicy(request(headers), tenant.id)),
    ).resolves.toBeTruthy();
  });
});

describe("OS fleet view", () => {
  it("aggregates distribution and behind devices without leaking tenants", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const other = await runEffect(
      service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    seedDevice(db, tenant.id, {
      id: "mac-current",
      proto: "apple",
      osEdition: "macOS",
      osVersion: "15.1",
      model: "Mac14,2",
    });
    seedDevice(db, tenant.id, {
      id: "mac-behind",
      proto: "apple",
      osEdition: "macOS",
      osVersion: "14.6",
      model: "Mac14,2",
    });
    seedDevice(db, tenant.id, { id: "win-ok", proto: "win", osVersion: "10.0.22631" });
    seedDevice(db, tenant.id, { id: "win-behind", proto: "win", osVersion: "10.0.19045" });
    seedDevice(db, tenant.id, { id: "android-ok", proto: "android", osVersion: "15" });
    seedDevice(db, tenant.id, { id: "android-behind", proto: "android", osVersion: "14" });
    seedDevice(db, tenant.id, { id: "win-unknown", proto: "win", osVersion: null });
    seedDevice(db, tenant.id, {
      id: "ipad",
      proto: "apple",
      osEdition: "iPadOS",
      osVersion: "18.1",
      model: "iPad14,1",
    });
    seedDevice(db, other.id, {
      id: "other-mac",
      proto: "apple",
      osEdition: "macOS",
      osVersion: "14.0",
      model: "Mac14,2",
    });

    await runEffect(
      service.patchTenantOsPolicy(request(headers), tenant.id, {
        platforms: [
          { platform: "macos", minimumVersion: "15.0", enforcement: "enforce" },
          { platform: "windows", minimumVersion: "10.0.22631", enforcement: "warn" },
          { platform: "android", minimumVersion: "15", enforcement: "warn" },
        ],
      }),
    );

    const fleet = await runEffect(service.getOsFleet(request(headers), tenant.id));

    expect(fleet.totals).toMatchObject({
      total: 7,
      compliant: 3,
      belowMinimum: 3,
      unknown: 1,
    });

    const macos = fleet.platforms.find((entry: any) => entry.platform === "macos");

    expect(macos.counts).toMatchObject({ total: 2, compliant: 1, belowMinimum: 1 });
    expect(macos.versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version: "15.1", count: 1, status: "compliant" }),
        expect.objectContaining({ version: "14.6", count: 1, status: "below-minimum" }),
      ]),
    );
    expect(macos.behind.map((row: any) => row.id)).toEqual(["mac-behind"]);

    const windows = fleet.platforms.find((entry: any) => entry.platform === "windows");

    expect(windows.counts).toMatchObject({ total: 3, compliant: 1, belowMinimum: 1, unknown: 1 });
    expect(windows.behind.map((row: any) => row.id)).toEqual(["win-behind"]);

    // The other tenant's device is never counted.
    expect(fleet.totals.total).toBe(7);
  });

  it("requires read permission", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const membership = db.store.member.find(
      (row: any) => row.organizationId === tenant.id && row.accountId === "user-1",
    )!;

    // An auditor is read-only but still allowed.
    membership.role = "auditor";

    await expect(runEffect(service.getOsFleet(request(headers), tenant.id))).resolves.toBeTruthy();
  });
});

describe("ScheduleOSUpdate device action", () => {
  it("queues an Apple ScheduleOSUpdate payload with the requested install action", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seedDevice(db, tenant.id, {
      id: "mac-1",
      proto: "apple",
      osEdition: "macOS",
      osVersion: "14.6",
      model: "Mac14,2",
    });

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "mac-1", {
        action: "schedule-os-update",
        osUpdateInstallAction: "InstallLater",
        osUpdateDeadline: "2026-11-25T12:00:00.000Z",
      }),
    );

    const command = db.store.device_command.find((row: any) => row.deviceId === "mac-1")!;

    expect(command.requestType).toBe("ScheduleOSUpdate");
    expect(command.payload.Updates).toHaveLength(1);
    expect(command.payload.Updates[0].InstallAction).toBe("InstallLater");
    // The exact count depends on the wall clock; the domain test pins it.
    expect(command.payload.Updates[0].MaxUserDeferrals).toBeGreaterThan(0);
    expect(command.payload.Updates[0].MaxUserDeferrals).toBeLessThanOrEqual(100);
  });

  it("rejects an invalid deadline before queueing anything", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seedDevice(db, tenant.id, {
      id: "mac-1",
      proto: "apple",
      osEdition: "macOS",
      osVersion: "14.6",
      model: "Mac14,2",
    });

    await expect(
      runEffect(
        service.deviceAction(request(headers), tenant.id, "mac-1", {
          action: "schedule-os-update",
          osUpdateInstallAction: "InstallLater",
          osUpdateDeadline: "tomorrow",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    expect(db.store.device_command).toHaveLength(0);
  });

  it("does not advertise or accept the action on iOS", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seedDevice(db, tenant.id, {
      id: "ipad-1",
      proto: "apple",
      osEdition: "iPadOS",
      osVersion: "18.1",
      model: "iPad14,1",
    });

    await expect(
      runEffect(
        service.deviceAction(request(headers), tenant.id, "ipad-1", {
          action: "schedule-os-update",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });
});
