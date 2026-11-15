import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "../index.js";
import {
  COMMAND_EXPIRED_DETAIL,
  deviceCommandBudget,
  DEVICE_COMMAND_DEFERRED_RETRY_MS,
  DEVICE_COMMAND_INSTALL_SETTLE_MS,
  DEVICE_COMMAND_SENT_RETRY_MS,
  canonicalCommandPayload,
  commandDedupeKey,
  commandIsExpired,
  deviceCommandExpiresAt,
  extendedCommandDeadline,
  installApplicationTarget,
  planCommandDelivery,
  planCommandDeliveryBatch,
  planCommandQueueing,
  reconcileDeviceCommands,
  shouldRetryInstall,
  supersededRequestTypes,
  type CommandRow,
} from "../commands.js";
import { makeDb, tableName, stringValue } from "./fake-db.js";

const origin = "https://policies.test";
const mdmOrigin = new MdmOrigin({ url: origin });
const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const at = (isoDate: string) => new Date(isoDate);

type Row = CommandRow & { readonly targetBundleIds?: ReadonlyArray<string> };

const row = (overrides: Partial<Row> & Pick<Row, "id">): Row => ({
  requestType: "DeviceLock",
  status: "queued",
  createdAt: at("2026-01-01T00:00:00.000Z"),
  updatedAt: at("2026-01-01T00:00:00.000Z"),
  expiresAt: null,
  ...overrides,
});

describe("command expiry budgets", () => {
  it("budgets interactive actions in minutes, installs in hours and inventory in days", () => {
    const queuedAt = at("2026-01-01T00:00:00.000Z");
    const minutes = (value: number) => value * 60 * 1000;

    expect(deviceCommandExpiresAt("DeviceLock", queuedAt)!.getTime() - queuedAt.getTime()).toBe(
      minutes(15),
    );
    expect(deviceCommandExpiresAt("RestartDevice", queuedAt)!.getTime() - queuedAt.getTime()).toBe(
      minutes(30),
    );
    expect(
      deviceCommandExpiresAt("InstallApplication", queuedAt)!.getTime() - queuedAt.getTime(),
    ).toBe(minutes(60 * 24));
    expect(
      deviceCommandExpiresAt("InstalledApplicationList", queuedAt)!.getTime() - queuedAt.getTime(),
    ).toBe(minutes(60 * 24 * 7));
    expect(deviceCommandExpiresAt("EraseDevice", queuedAt)!.getTime() - queuedAt.getTime()).toBe(
      minutes(60 * 24 * 7),
    );
  });

  it("leaves request types without a budget unbounded", () => {
    expect(deviceCommandBudget("SomethingNew")).toBeUndefined();
    expect(deviceCommandExpiresAt("SomethingNew", at("2026-01-01T00:00:00.000Z"))).toBeNull();
  });

  it("treats a legacy row without expiresAt as expired once its budget elapses", () => {
    const legacy = row({
      id: "legacy",
      requestType: "DeviceLock",
      createdAt: at("2026-01-01T00:00:00.000Z"),
    });

    expect(commandIsExpired(legacy, at("2026-01-01T00:14:59.000Z"))).toBe(false);
    expect(commandIsExpired(legacy, at("2026-01-01T00:15:00.000Z"))).toBe(true);
  });

  it("extends a duplicate command's deadline from the new click", () => {
    const now = at("2026-01-01T00:14:00.000Z");

    const duplicate = row({
      id: "lock",
      requestType: "DeviceLock",
      createdAt: at("2026-01-01T00:00:00.000Z"),
      expiresAt: at("2026-01-01T00:15:00.000Z"),
    });

    expect(extendedCommandDeadline(duplicate, "DeviceLock", now)).toEqual(
      at("2026-01-01T00:29:00.000Z"),
    );
    // A later deadline already covers the new window; leave the row alone.
    expect(
      extendedCommandDeadline(
        { ...duplicate, expiresAt: at("2026-01-02T00:00:00.000Z") },
        "DeviceLock",
        now,
      ),
    ).toBeNull();
    // A type without a budget never expires, so there is nothing to extend.
    expect(
      extendedCommandDeadline(
        { ...duplicate, requestType: "SomethingNew", expiresAt: null },
        "SomethingNew",
        now,
      ),
    ).toBeNull();
    // A legacy row without a stored deadline is derived from its creation time.
    expect(extendedCommandDeadline({ ...duplicate, expiresAt: null }, "DeviceLock", now)).toEqual(
      at("2026-01-01T00:29:00.000Z"),
    );
  });
});

describe("command de-duplication", () => {
  it("produces the same key regardless of payload key order", async () => {
    expect(canonicalCommandPayload({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(
      canonicalCommandPayload({ a: [2, { c: 4, d: 3 }], b: 1 }),
    );
    expect(
      await commandDedupeKey("EraseDevice", { PIN: "1234", ObliterationBehavior: "Default" }),
    ).toBe(
      await commandDedupeKey("EraseDevice", {
        ObliterationBehavior: "Default",
        PIN: "1234",
      }),
    );
  });

  it("returns the queued command instead of inserting an identical one", () => {
    const queued = row({
      id: "erase-1",
      requestType: "EraseDevice",
      payload: { PIN: "1234", ObliterationBehavior: "Default" },
    });

    const plan = planCommandQueueing([queued], {
      requestType: "EraseDevice",
      payload: { ObliterationBehavior: "Default", PIN: "1234" },
      now: at("2026-01-01T00:01:00.000Z"),
    });

    expect(plan.duplicate?.id).toBe("erase-1");
    expect(plan.supersedeIds).toEqual([]);
  });

  it("queues different work and ignores terminal history", () => {
    const now = at("2026-01-01T00:05:00.000Z");

    const terminal = row({
      id: "erase-1",
      requestType: "EraseDevice",
      payload: { PIN: "1234" },
      status: "succeeded",
    });

    const different = planCommandQueueing([terminal], {
      requestType: "EraseDevice",
      payload: { PIN: "9999" },
      now,
    });

    expect(different.duplicate).toBeNull();

    const again = planCommandQueueing([terminal], {
      requestType: "EraseDevice",
      payload: { PIN: "1234" },
      now,
    });

    expect(again.duplicate).toBeNull();
  });

  it("does not treat an expired identical command as a duplicate", () => {
    const expired = row({
      id: "lock-1",
      requestType: "DeviceLock",
      payload: { PIN: "123456" },
      createdAt: at("2026-01-01T00:00:00.000Z"),
    });

    const plan = planCommandQueueing([expired], {
      requestType: "DeviceLock",
      payload: { PIN: "123456" },
      now: at("2026-01-01T01:00:00.000Z"),
    });

    expect(plan.duplicate).toBeNull();
  });
});

describe("command supersede rules", () => {
  it("supersedes every pending action when a wipe is queued", () => {
    const now = at("2026-01-01T00:05:00.000Z");

    const rows = [
      row({ id: "lock", requestType: "DeviceLock", payload: { PIN: "123456" } }),
      row({ id: "restart", requestType: "RestartDevice", payload: {} }),
      row({ id: "install", requestType: "InstallApplication", payload: { iTunesStoreID: 1 } }),
    ];

    const plan = planCommandQueueing(rows, {
      requestType: "EraseDevice",
      payload: { PIN: "654321" },
      now,
    });

    expect([...plan.supersedeIds].sort()).toEqual(["install", "lock", "restart"]);
    expect(supersededRequestTypes("EraseDevice")).toContain("DeviceLock");
  });

  it("lets a newer lock replace an older one with a different PIN", () => {
    const plan = planCommandQueueing(
      [
        row({
          id: "lock-old",
          requestType: "DeviceLock",
          payload: { PIN: "111111" },
        }),
      ],
      {
        requestType: "DeviceLock",
        payload: { PIN: "222222" },
        now: at("2026-01-01T00:01:00.000Z"),
      },
    );

    expect(plan.supersedeIds).toEqual(["lock-old"]);
  });

  it("keeps a single pending erase when the wipe is submitted again", () => {
    const plan = planCommandQueueing(
      [
        row({
          id: "erase-old",
          requestType: "EraseDevice",
          payload: { PIN: "111111", ObliterationBehavior: "Default" },
        }),
      ],
      {
        requestType: "EraseDevice",
        payload: { PIN: "222222", ObliterationBehavior: "Default" },
        now: at("2026-01-01T00:01:00.000Z"),
      },
    );

    expect(plan.supersedeIds).toEqual(["erase-old"]);
  });

  it("leaves independent app installs alone", () => {
    const plan = planCommandQueueing(
      [
        row({
          id: "install-a",
          requestType: "InstallApplication",
          payload: { iTunesStoreID: 1 },
        }),
      ],
      {
        requestType: "InstallApplication",
        payload: { iTunesStoreID: 2 },
        now: at("2026-01-01T00:01:00.000Z"),
      },
    );

    expect(plan.supersedeIds).toEqual([]);
    expect(supersededRequestTypes("InstallApplication")).toEqual([]);
  });
});

describe("command reconciliation", () => {
  const device = {
    status: "enrolled" as const,
    applicationsUpdatedAt: at("2026-01-01T02:00:00.000Z"),
    installedBundleIds: new Set(["com.example.installed"]),
  };

  it("cancels commands for a device that left management", () => {
    const reconciled = reconcileDeviceCommands(
      [row({ id: "lock", status: "sent" })],
      { ...device, status: "unenrolled" },
      at("2026-01-01T00:10:00.000Z"),
    );

    expect(reconciled).toEqual([
      expect.objectContaining({ id: "lock", status: "cancelled", resultStatus: "Reconciled" }),
    ]);
  });

  it("expires commands past their deadline", () => {
    const reconciled = reconcileDeviceCommands(
      [row({ id: "lock", status: "sent", createdAt: at("2026-01-01T00:00:00.000Z") })],
      device,
      at("2026-01-01T00:16:00.000Z"),
    );

    expect(reconciled).toEqual([
      expect.objectContaining({
        id: "lock",
        status: "expired",
        resultDetail: COMMAND_EXPIRED_DETAIL,
      }),
    ]);
  });

  it("marks a delivered install that the inventory proves landed as succeeded", () => {
    const reconciled = reconcileDeviceCommands(
      [
        row({
          id: "install",
          requestType: "InstallApplication",
          status: "sent",
          updatedAt: at("2026-01-01T01:00:00.000Z"),
          targetBundleIds: ["com.example.installed"],
        }),
      ],
      device,
      at("2026-01-01T02:00:00.000Z"),
    );

    expect(reconciled).toEqual([expect.objectContaining({ id: "install", status: "succeeded" })]);
  });

  it("fails a delivered install missing from a settled inventory", () => {
    const reconciled = reconcileDeviceCommands(
      [
        row({
          id: "install",
          requestType: "InstallApplication",
          status: "sent",
          updatedAt: at("2026-01-01T00:00:00.000Z"),
          targetBundleIds: ["com.example.missing"],
        }),
      ],
      device,
      at("2026-01-01T02:00:00.000Z"),
    );

    expect(reconciled).toEqual([expect.objectContaining({ id: "install", status: "failed" })]);
  });

  it("waits for the settling window before calling an install failed", () => {
    const reconciled = reconcileDeviceCommands(
      [
        row({
          id: "install",
          requestType: "InstallApplication",
          status: "sent",
          updatedAt: new Date(device.applicationsUpdatedAt!.getTime() - 60 * 1000),
          targetBundleIds: ["com.example.missing"],
        }),
      ],
      device,
      at("2026-01-01T02:00:00.000Z"),
    );

    expect(reconciled).toEqual([]);
    expect(DEVICE_COMMAND_INSTALL_SETTLE_MS).toBeGreaterThan(60 * 1000);
  });

  it("never judges an install the device has not been given yet", () => {
    const reconciled = reconcileDeviceCommands(
      [
        row({
          id: "install",
          requestType: "InstallApplication",
          status: "queued",
          updatedAt: at("2026-01-01T01:00:00.000Z"),
          targetBundleIds: ["com.example.missing"],
        }),
      ],
      device,
      at("2026-01-01T02:00:00.000Z"),
    );

    expect(reconciled).toEqual([]);
  });

  it("satisfies an inventory query with a newer inventory report", () => {
    const reconciled = reconcileDeviceCommands(
      [
        row({
          id: "inventory",
          requestType: "InstalledApplicationList",
          status: "sent",
          updatedAt: at("2026-01-01T01:00:00.000Z"),
        }),
      ],
      device,
      at("2026-01-01T02:00:00.000Z"),
    );

    expect(reconciled).toEqual([expect.objectContaining({ id: "inventory", status: "succeeded" })]);
  });
});

describe("install retry budget", () => {
  const payload = { iTunesStoreID: 42 };

  it("allows three attempts per day", () => {
    const now = at("2026-01-01T12:00:00.000Z");

    const attempts = Array.from({ length: 3 }, (_, index) => ({
      requestType: "InstallApplication",
      payload,
      createdAt: new Date(now.getTime() - (index + 1) * 60 * 60 * 1000),
    }));

    expect(shouldRetryInstall([], { requestType: "InstallApplication", payload, now })).toBe(true);
    expect(
      shouldRetryInstall(attempts.slice(0, 2), { requestType: "InstallApplication", payload, now }),
    ).toBe(true);
    expect(shouldRetryInstall(attempts, { requestType: "InstallApplication", payload, now })).toBe(
      false,
    );
  });

  it("ignores attempts outside the window and for other payloads", () => {
    const now = at("2026-01-01T12:00:00.000Z");

    const old = Array.from({ length: 3 }, () => ({
      requestType: "InstallApplication",
      payload,
      createdAt: at("2025-12-01T00:00:00.000Z"),
    }));

    expect(shouldRetryInstall(old, { requestType: "InstallApplication", payload, now })).toBe(true);
    expect(
      shouldRetryInstall(old, {
        requestType: "InstallApplication",
        payload: { iTunesStoreID: 7 },
        now,
      }),
    ).toBe(true);
  });

  it("reads the target application out of an install payload", () => {
    expect(installApplicationTarget({ ManifestURL: "https://example.test/app.plist" })).toEqual({
      manifestUrl: "https://example.test/app.plist",
      storeId: undefined,
    });
    expect(installApplicationTarget({ iTunesStoreID: 42 })).toEqual({
      manifestUrl: undefined,
      storeId: "42",
    });
    expect(installApplicationTarget(null)).toEqual({});
  });
});

describe("delivery planning", () => {
  const now = at("2026-01-01T00:20:00.000Z");

  it("expires a stale command instead of delivering it", () => {
    const plan = planCommandDelivery(
      [
        row({
          id: "lock",
          requestType: "DeviceLock",
          createdAt: at("2026-01-01T00:00:00.000Z"),
          expiresAt: at("2026-01-01T00:15:00.000Z"),
        }),
      ],
      now,
    );

    expect(plan.deliver).toBeNull();
    expect(plan.expire).toEqual(["lock"]);
  });

  it("delivers the oldest queued command inside its budget", () => {
    const plan = planCommandDelivery(
      [
        row({
          id: "install",
          requestType: "InstallApplication",
          createdAt: at("2026-01-01T00:00:00.000Z"),
          expiresAt: at("2026-01-02T00:00:00.000Z"),
        }),
        row({
          id: "lock",
          requestType: "DeviceLock",
          createdAt: at("2026-01-01T00:10:00.000Z"),
          expiresAt: at("2026-01-01T00:25:00.000Z"),
        }),
      ],
      now,
    );

    expect(plan.deliver?.id).toBe("install");
  });

  it("re-queues deferred and unacknowledged commands inside their budget", () => {
    const deferred = planCommandDelivery(
      [
        row({
          id: "deferred",
          status: "deferred",
          updatedAt: new Date(now.getTime() - DEVICE_COMMAND_DEFERRED_RETRY_MS - 1),
          expiresAt: at("2026-01-02T00:00:00.000Z"),
        }),
      ],
      now,
    );

    expect(deferred.requeue).toEqual(["deferred"]);
    expect(deferred.deliver?.id).toBe("deferred");

    const tooSoon = planCommandDelivery(
      [
        row({
          id: "waiting",
          status: "sent",
          updatedAt: new Date(now.getTime() - DEVICE_COMMAND_SENT_RETRY_MS + 1000),
          expiresAt: at("2026-01-02T00:00:00.000Z"),
        }),
      ],
      now,
    );

    expect(tooSoon.requeue).toEqual([]);
    expect(tooSoon.deliver).toBeNull();
  });

  it("retries a legacy not-now row after the deferred window", () => {
    const plan = planCommandDelivery(
      [
        row({
          id: "legacy",
          status: "not-now",
          updatedAt: at("2026-01-01T00:00:00.000Z"),
          expiresAt: at("2026-01-02T00:00:00.000Z"),
        }),
      ],
      now,
    );

    expect(plan.requeue).toEqual(["legacy"]);
  });
});

const organization = (id: string) => ({
  id,
  name: id,
  slug: id,
  logo: null,
  metadata: null,
  stripeCustomerId: null,
  createdAt: at("2026-01-01T00:00:00Z"),
  updatedAt: at("2026-01-01T00:00:00Z"),
});

const device = (id: string, organizationId: string) => ({
  id,
  organizationId,
  proto: "apple",
  status: "enrolled",
  name: id,
  dmIdentifier: "udid-1",
  enrolledAt: at("2026-01-01T00:00:00Z"),
  lastSeenAt: at("2026-01-01T00:00:00Z"),
});

const command = (id: string, row: Partial<typeof schema.deviceCommand.$inferSelect>) => ({
  id,
  organizationId: "org-1",
  deviceId: "device-1",
  requestType: "DeviceLock",
  payload: { PIN: "123456" },
  status: "queued",
  createdAt: at("2026-01-01T00:00:00Z"),
  updatedAt: at("2026-01-01T00:00:00Z"),
  resultStatus: null,
  resultDetail: null,
  ...row,
});

describe("Apple check-in delivery loop", () => {
  const scope = {
    _tag: "device" as const,
    udid: "udid-1",
    identityCertificate: "CN=Device,OU=org-1",
    mdmOrigin,
  };

  it("expires a command whose budget elapsed instead of handing it out", async () => {
    const expiredAt = new Date(Date.now() - 60 * 60 * 1000);

    const db = makeDb({
      [tableName(schema.organization)]: [organization("org-1")],
      [tableName(schema.device)]: [device("device-1", "org-1")],
      [tableName(schema.deviceCommand)]: [
        command("stale-lock", {
          expiresAt: expiredAt,
          createdAt: new Date(expiredAt.getTime() - 15 * 60 * 1000),
          updatedAt: new Date(expiredAt.getTime() - 15 * 60 * 1000),
        }),
      ],
    });

    // SAFETY: the fake store implements only the query chains this test exercises.
    const backend = ManagementBackendEnterpriseLive.make({ db: db as any, origin });

    const manifest = await run(backend.appleManagementCheckin(scope));

    expect(manifest._tag).not.toBe("Command");

    const [stale] = db.store[tableName(schema.deviceCommand)]!;

    expect(stringValue(stale!.status)).toBe("expired");
    expect(stringValue(stale!.resultStatus)).toBe("Reconciled");
  });

  it("still delivers a command inside its budget", async () => {
    const db = makeDb({
      [tableName(schema.organization)]: [organization("org-1")],
      [tableName(schema.device)]: [device("device-1", "org-1")],
      [tableName(schema.deviceCommand)]: [
        command("fresh-lock", {
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        }),
      ],
    });

    // SAFETY: the fake store implements only the query chains this test exercises.
    const backend = ManagementBackendEnterpriseLive.make({ db: db as any, origin });

    const manifest = await run(backend.appleManagementCheckin(scope));

    expect(manifest._tag).toBe("Command");
    expect(manifest).toMatchObject({
      commandUUID: "fresh-lock",
      requestType: "DeviceLock",
    });

    const [delivered] = db.store[tableName(schema.deviceCommand)]!;

    expect(stringValue(delivered!.status)).toBe("sent");
  });
});

describe("bulk command delivery (Windows SyncML)", () => {
  const now = at("2026-01-01T01:00:00.000Z");

  it("delivers every queued command, oldest first, and never expires", () => {
    const plan = planCommandDeliveryBatch(
      [
        row({
          id: "b",
          requestType: "WindowsReboot",
          createdAt: at("2026-01-01T00:10:00.000Z"),
          expiresAt: at("2026-01-02T00:00:00.000Z"),
        }),
        row({
          id: "a",
          requestType: "WindowsWipe",
          createdAt: at("2026-01-01T00:00:00.000Z"),
          expiresAt: at("2026-01-08T00:00:00.000Z"),
        }),
      ],
      now,
    );

    expect(plan.expire).toEqual([]);
    expect(plan.requeue).toEqual([]);
    expect(plan.deliver.map((command) => command.id)).toEqual(["a", "b"]);
  });

  it("expires work past its budget and retries acknowledged work inside it", () => {
    const plan = planCommandDeliveryBatch(
      [
        row({
          id: "stale",
          requestType: "RestartDevice",
          createdAt: at("2025-12-31T00:00:00.000Z"),
          expiresAt: at("2025-12-31T00:30:00.000Z"),
        }),
        row({
          id: "retry",
          status: "sent",
          updatedAt: new Date(now.getTime() - DEVICE_COMMAND_SENT_RETRY_MS),
          expiresAt: at("2026-01-02T00:00:00.000Z"),
        }),
      ],
      now,
    );

    expect(plan.expire).toEqual(["stale"]);
    expect(plan.requeue).toEqual(["retry"]);
    expect(plan.deliver.map((command) => command.id)).toEqual(["retry"]);
  });
});
