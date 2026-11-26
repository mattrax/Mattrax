import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterprisePermissionDenied,
  EnterpriseUnauthorized,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { SOFA_MACOS_FEED_URL } from "@mattrax/enterprise-backend";
import { makeDb, request, runEffect, schema } from "./helpers.js";

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
    // SAFETY: these tests never reach R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret,
    // Tests run offline; the seeded cache row is enough for macOS evaluation.
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
    osUpdateInstallState?: string | null;
    osUpdatePendingVersion?: string | null;
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
    osUpdateInstallState: input.osUpdateInstallState ?? null,
    osUpdatePendingVersion: input.osUpdatePendingVersion ?? null,
    enrolledAt: now,
    lastSeenAt: now,
  });

const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("Expected fixture entry");

  return value;
};

const findPlatform = (policy: { readonly platforms: readonly any[] }, name: string) =>
  required(policy.platforms.find((entry) => entry.platform === name));

describe("tenant OS policy API", () => {
  it("returns every platform with inert defaults", async () => {
    const { service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const policy = await runEffect(service.getTenantOsPolicy(request(headers), tenant.id));

    expect(policy.platforms.map((entry: any) => entry.platform)).toEqual([
      "macos",
      "ios",
      "ipados",
      "windows",
      "android",
    ]);
    expect(policy.platforms.every((entry: any) => entry.enforcement === "off")).toBe(true);
    expect(policy.platforms[0].capability.minimumVersionEnforced).toBe(true);
    expect(policy.platforms[1].capability).toMatchObject({
      mechanism: "ddm-software-update",
      minimumVersionEnforced: true,
      automatic: true,
    });
    expect(policy.platforms[3].capability.minimumVersionEnforced).toBe(false);
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

    const macos = findPlatform(saved, "macos");

    expect(macos.minimumVersion).toBe("15.0");
    expect(macos.enforcement).toBe("enforce");
    expect(macos.deferralDays).toBe(7);
    expect(macos.deferralEndsAt).toBeTruthy();
    expect(new Date(macos.deferralEndsAt).getTime() - new Date(macos.updatedAt).getTime()).toBe(
      7 * 24 * 60 * 60 * 1_000,
    );
  });

  it("saves separate iOS and iPadOS rules", async () => {
    const { service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    const saved = await runEffect(
      service.patchTenantOsPolicy(request(headers), tenant.id, {
        platforms: [
          { platform: "ios", minimumVersion: "iOS 18.1", enforcement: "enforce", deferralDays: 3 },
          { platform: "ipados", minimumVersion: "18.0", enforcement: "warn" },
        ],
      }),
    );

    const ios = findPlatform(saved, "ios");
    const ipados = findPlatform(saved, "ipados");

    expect(ios).toMatchObject({ minimumVersion: "18.1", enforcement: "enforce", deferralDays: 3 });
    expect(ios.capability.mechanism).toBe("ddm-software-update");
    expect(ios.deferralEndsAt).toBeTruthy();
    expect(ipados).toMatchObject({ minimumVersion: "18.0", enforcement: "warn" });

    // macOS is untouched by an iOS rule.
    expect(findPlatform(saved, "macos").minimumVersion).toBeNull();
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

    expect(findPlatform(other, "windows").minimumVersion).toBeNull();
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
          { platform: "ipados", minimumVersion: "18.0", enforcement: "warn" },
          { platform: "windows", minimumVersion: "10.0.22631", enforcement: "warn" },
          { platform: "android", minimumVersion: "15", enforcement: "warn" },
        ],
      }),
    );

    const fleet = await runEffect(service.getOsFleet(request(headers), tenant.id));

    expect(fleet.totals).toMatchObject({
      total: 8,
      compliant: 4,
      belowMinimum: 3,
      unknown: 1,
    });

    const macos = findPlatform(fleet, "macos");

    expect(macos.counts).toMatchObject({ total: 2, compliant: 1, belowMinimum: 1 });
    expect(macos.versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version: "15.1", count: 1, status: "compliant" }),
        expect.objectContaining({ version: "14.6", count: 1, status: "below-minimum" }),
      ]),
    );
    expect(macos.behind.map((row: any) => row.id)).toEqual(["mac-behind"]);

    const ipados = findPlatform(fleet, "ipados");

    expect(ipados.counts).toMatchObject({ total: 1, compliant: 1 });

    const windows = findPlatform(fleet, "windows");

    expect(windows.counts).toMatchObject({ total: 3, compliant: 1, belowMinimum: 1, unknown: 1 });
    expect(windows.behind.map((row: any) => row.id)).toEqual(["win-behind"]);

    // The other tenant's device is never counted.
    expect(fleet.totals.total).toBe(8);
  });

  it("reports iOS/iPadOS DDM pending updates and the fallback mechanism", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seedDevice(db, tenant.id, {
      id: "iphone-behind",
      proto: "apple",
      osEdition: "iOS",
      osVersion: "17.6",
      model: "iPhone15,2",
    });
    seedDevice(db, tenant.id, {
      id: "iphone-pending",
      proto: "apple",
      osEdition: "iOS",
      osVersion: "18.1",
      model: "iPhone15,2",
      osUpdatePendingVersion: "18.3",
      osUpdateInstallState: "downloading",
    });
    seedDevice(db, tenant.id, {
      id: "ipad-legacy",
      proto: "apple",
      osEdition: "iPadOS",
      osVersion: "16.7",
      model: "iPad14,1",
    });
    seedDevice(db, tenant.id, {
      id: "ipad-ok",
      proto: "apple",
      osEdition: "iPadOS",
      osVersion: "18.2",
      model: "iPad14,1",
    });

    db.store.device_apple.push({
      deviceId: "ipad-legacy",
      declarationMode: "legacy",
      enrollmentMode: "device",
    });

    seedDevice(db, tenant.id, {
      id: "appletv",
      proto: "apple",
      osEdition: "tvOS",
      osVersion: "18.4",
      model: "AppleTV14,1",
    });
    seedDevice(db, tenant.id, {
      id: "watch",
      proto: "apple",
      osEdition: "watchOS",
      osVersion: "11.0",
      model: "Watch7,1",
    });

    await runEffect(
      service.patchTenantOsPolicy(request(headers), tenant.id, {
        platforms: [
          { platform: "ios", minimumVersion: "18.0", enforcement: "enforce" },
          { platform: "ipados", minimumVersion: "18.0", enforcement: "enforce" },
        ],
      }),
    );

    const fleet = await runEffect(service.getOsFleet(request(headers), tenant.id));

    const ios = findPlatform(fleet, "ios");

    expect(ios.counts).toMatchObject({ total: 2, belowMinimum: 1, updateAvailable: 1 });

    const pending = required(ios.behind.find((row: any) => row.id === "iphone-pending"));

    expect(pending).toMatchObject({
      status: "update-available",
      reason: "ddm_update_pending",
      targetVersion: "18.3",
      pendingVersion: "18.3",
      installState: "downloading",
      updateMechanism: "ddm-software-update",
    });
    expect(
      required(ios.behind.find((row: any) => row.id === "iphone-behind")).updateMechanism,
    ).toBe("ddm-software-update");

    const ipados = findPlatform(fleet, "ipados");

    expect(ipados.counts).toMatchObject({ total: 2, compliant: 1, belowMinimum: 1 });
    expect(ipados.behind).toHaveLength(1);
    expect(ipados.behind[0]).toMatchObject({
      id: "ipad-legacy",
      updateMechanism: "schedule-os-update",
    });
    expect(ipados.versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version: "18.2", status: "compliant" }),
        expect.objectContaining({ version: "16.7", status: "below-minimum" }),
      ]),
    );

    // Unsupported Apple families are named, not silently dropped.
    expect(fleet.unsupported).toEqual({
      total: 2,
      byFamily: expect.arrayContaining([
        { family: "tvos", count: 1 },
        { family: "watchos", count: 1 },
      ]),
    });
  });

  it("does not offer Apply when neither DDM nor the command is legal", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seedDevice(db, tenant.id, {
      id: "iphone-warn",
      proto: "apple",
      osEdition: "iOS",
      osVersion: "18.1",
      model: "iPhone15,2",
      osUpdatePendingVersion: "18.3",
    });
    seedDevice(db, tenant.id, {
      id: "ipad-norule",
      proto: "apple",
      osEdition: "iPadOS",
      osVersion: "18.1",
      model: "iPad14,1",
      osUpdatePendingVersion: "18.3",
    });

    await runEffect(
      service.patchTenantOsPolicy(request(headers), tenant.id, {
        platforms: [{ platform: "ios", minimumVersion: "18.0", enforcement: "warn" }],
      }),
    );

    const fleet = await runEffect(service.getOsFleet(request(headers), tenant.id));
    const ios = findPlatform(fleet, "ios");
    const ipados = findPlatform(fleet, "ipados");

    // A warn-only 17+ phone has no command path, so it is listed without one.
    expect(ios.behind).toHaveLength(1);
    expect(ios.behind[0]).toMatchObject({ id: "iphone-warn", updateMechanism: null });

    // No iPadOS rule means the pending update is policy state, not a behind row.
    expect(ipados.behind).toHaveLength(0);
    expect(ipados.counts).toMatchObject({ total: 1, unknown: 1 });
  });

  it("keeps a small Apple family visible behind a large sibling fleet", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    for (let index = 0; index < 101; index += 1)
      seedDevice(db, tenant.id, {
        id: `iphone-${index}`,
        proto: "apple",
        osEdition: "iOS",
        osVersion: "17.6",
        model: "iPhone15,2",
      });

    seedDevice(db, tenant.id, {
      id: "the-ipad",
      proto: "apple",
      osEdition: "iPadOS",
      osVersion: "16.7",
      model: "iPad14,1",
    });

    await runEffect(
      service.patchTenantOsPolicy(request(headers), tenant.id, {
        platforms: [
          { platform: "ios", minimumVersion: "18.0", enforcement: "enforce" },
          { platform: "ipados", minimumVersion: "18.0", enforcement: "enforce" },
        ],
      }),
    );

    const fleet = await runEffect(service.getOsFleet(request(headers), tenant.id));
    const ios = findPlatform(fleet, "ios");
    const ipados = findPlatform(fleet, "ipados");

    // The iPhone list is capped, but the iPad query is constrained to iPadOS so
    // it cannot be starved by the shared apple transport limit.
    expect(ios.behind).toHaveLength(100);
    expect(ios.behindTruncated).toBe(true);
    expect(ipados.behind.map((row: any) => row.id)).toEqual(["the-ipad"]);
    expect(ipados.behindTruncated).toBe(false);
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

describe("OS update actions in device lists", () => {
  it("exposes the same Apple fallback decision in list and search payloads", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seedDevice(db, tenant.id, {
      id: "ipad-ddm",
      proto: "apple",
      osEdition: "iPadOS",
      osVersion: "18.1",
      model: "iPad14,1",
    });
    seedDevice(db, tenant.id, {
      id: "ipad-legacy",
      proto: "apple",
      osEdition: "iPadOS",
      osVersion: "18.1",
      model: "iPad14,1",
    });

    db.store.device_apple.push(
      { deviceId: "ipad-ddm", declarationMode: "ddm", enrollmentMode: "device" },
      { deviceId: "ipad-legacy", declarationMode: "legacy", enrollmentMode: "device" },
    );

    const list = await runEffect(service.listDevices(request(headers), tenant.id));
    const search = await runEffect(service.searchDevices(request(headers), tenant.id, {}));

    for (const rows of [list.rows, search.devices]) {
      const byId = new Map(rows.map((row: any) => [row.id, row]));

      expect(byId.get("ipad-ddm")!.actions).not.toContain("schedule-os-update");
      expect(byId.get("ipad-legacy")!.actions).toContain("schedule-os-update");
    }
  });
});

describe("DDM bulk apply audit", () => {
  it("records a validated DDM wake-up as an OS-update action", async () => {
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
    db.store.device_apple.push({
      deviceId: "ipad-1",
      declarationMode: "ddm",
      enrollmentMode: "device",
    });

    await runEffect(
      service.patchTenantOsPolicy(request(headers), tenant.id, {
        platforms: [{ platform: "ipados", minimumVersion: "18.0", enforcement: "enforce" }],
      }),
    );

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "ipad-1", {
        action: "sync",
        osUpdateMechanism: "ddm-software-update",
      }),
    );

    const audit = db.store.audit_log.findLast(
      (row: any) => row.action === "device.action" && row.targetId === "ipad-1",
    );

    expect(audit.metadata).toMatchObject({ mechanism: "ddm-software-update" });

    // A warn rule compiles no declaration, so the marker is rejected. A
    // separate tenant avoids relying on the fake DB's upsert semantics.
    const warned = await runEffect(
      service.createTenant(request(headers), { name: "Warned", slug: "warned" }),
    );

    seedDevice(db, warned.id, {
      id: "ipad-warn",
      proto: "apple",
      osEdition: "iPadOS",
      osVersion: "18.1",
      model: "iPad14,1",
    });
    db.store.device_apple.push({
      deviceId: "ipad-warn",
      declarationMode: "ddm",
      enrollmentMode: "device",
    });

    await runEffect(
      service.patchTenantOsPolicy(request(headers), warned.id, {
        platforms: [{ platform: "ipados", minimumVersion: "18.0", enforcement: "warn" }],
      }),
    );

    await expect(
      runEffect(
        service.deviceAction(request(headers), warned.id, "ipad-warn", {
          action: "sync",
          osUpdateMechanism: "ddm-software-update",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
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

  it("rejects the action on an iOS device that receives DDM", async () => {
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

    db.store.device_apple.push({
      deviceId: "ipad-1",
      declarationMode: "ddm",
      enrollmentMode: "device",
    });

    await expect(
      runEffect(
        service.deviceAction(request(headers), tenant.id, "ipad-1", {
          action: "schedule-os-update",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    expect(db.store.device_command ?? []).toHaveLength(0);
  });

  it("queues the explicit fallback on iOS below 17", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    seedDevice(db, tenant.id, {
      id: "iphone-1",
      proto: "apple",
      osEdition: "iOS",
      osVersion: "16.7",
      model: "iPhone14,2",
    });

    db.store.device_apple.push({
      deviceId: "iphone-1",
      declarationMode: "ddm",
      enrollmentMode: "device",
    });

    await runEffect(
      service.deviceAction(request(headers), tenant.id, "iphone-1", {
        action: "schedule-os-update",
        osUpdateInstallAction: "InstallASAP",
      }),
    );

    const command = db.store.device_command.find((row: any) => row.deviceId === "iphone-1")!;

    expect(command.requestType).toBe("ScheduleOSUpdate");
    expect(command.payload.Updates[0].InstallAction).toBe("InstallASAP");

    // The audit trail names the fallback mechanism.
    expect(
      db.store.audit_log.some(
        (row: any) =>
          row.action === "device.action" && row.metadata?.mechanism === "schedule-os-update",
      ),
    ).toBe(true);
  });

  it("bulk applies the fallback to every eligible iOS device", async () => {
    const { db, service, headers } = await makeContext();

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    for (const id of ["iphone-a", "iphone-b"]) {
      seedDevice(db, tenant.id, {
        id,
        proto: "apple",
        osEdition: "iOS",
        osVersion: "16.7",
        model: "iPhone14,2",
      });
      db.store.device_apple.push({
        deviceId: id,
        declarationMode: "ddm",
        enrollmentMode: "device",
      });
    }

    for (const id of ["iphone-a", "iphone-b"])
      await runEffect(
        service.deviceAction(request(headers), tenant.id, id, {
          action: "schedule-os-update",
          osUpdateInstallAction: "InstallASAP",
        }),
      );

    expect(
      db.store.device_command.filter((row: any) => row.requestType === "ScheduleOSUpdate"),
    ).toHaveLength(2);
  });
});
