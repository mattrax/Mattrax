import type { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  compareVersionStrings,
  dynamicGroupRulesProblem,
  evaluateDynamicGroupRules,
} from "@mattrax/enterprise-domain";
import type { DeviceQueryDevice, DynamicGroupRules } from "@mattrax/enterprise-domain";
import {
  previewDynamicGroup,
  syncDynamicGroup,
  syncDynamicGroupDependents,
  syncDynamicGroupsForDevice,
  syncDynamicGroupsForTenant,
} from "@mattrax/mdm-core";
import { makeDb, runEffect } from "./helpers.js";

const now = new Date("2026-11-10T12:00:00.000Z");

const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

const device = (overrides: Partial<DeviceQueryDevice> = {}): DeviceQueryDevice => ({
  proto: "apple",
  model: "MacBook Pro",
  osVersion: "14.4.1",
  serial: "C02ABC123",
  assetTag: "AT-100",
  lastSeenAt: at(1),
  health: { level: "healthy" as const, stale: false },
  ...overrides,
});

const rules = (input: Partial<DynamicGroupRules>): DynamicGroupRules => ({
  version: 1,
  ...input,
});

describe("dynamic group evaluator", () => {
  it("matches platform and its proto alias", () => {
    expect(
      evaluateDynamicGroupRules(
        rules({ all: [{ field: "platform", op: "eq", value: "apple" }] }),
        device(),
        { now },
      ),
    ).toBe(true);
    expect(
      evaluateDynamicGroupRules(
        rules({ all: [{ field: "platform", op: "eq", value: "win" }] }),
        device(),
        { now },
      ),
    ).toBe(false);
    expect(
      evaluateDynamicGroupRules(
        rules({ all: [{ field: "proto", op: "eq", value: "APPLE" as never }] }),
        device(),
        { now },
      ),
    ).toBe(true);
  });

  it("compares dotted OS versions numerically", () => {
    expect(compareVersionStrings("14.10", "14.9")).toBe(1);
    expect(compareVersionStrings("14.4", "14.4.0")).toBe(0);
    expect(compareVersionStrings("15.0.1", "15")).toBe(1);
    expect(compareVersionStrings("not-a-version", "14")).toBeNull();

    const gte = rules({ all: [{ field: "osVersion", op: "gte", value: "14.10" }] });
    expect(evaluateDynamicGroupRules(gte, device({ osVersion: "14.10.2" }), { now })).toBe(true);
    expect(evaluateDynamicGroupRules(gte, device({ osVersion: "14.9.9" }), { now })).toBe(false);
    expect(
      evaluateDynamicGroupRules(
        rules({ all: [{ field: "osVersion", op: "eq", value: "14.4.0" }] }),
        device({ osVersion: "14.4" }),
        { now },
      ),
    ).toBe(true);
  });

  it("does not match comparisons when the device value is missing", () => {
    expect(
      evaluateDynamicGroupRules(
        rules({ all: [{ field: "osVersion", op: "gte", value: "14" }] }),
        device({ osVersion: null }),
        { now },
      ),
    ).toBe(false);
    expect(
      evaluateDynamicGroupRules(
        rules({ all: [{ field: "serial", op: "prefix", value: "C02" }] }),
        device({ serial: null }),
        { now },
      ),
    ).toBe(false);
    expect(
      evaluateDynamicGroupRules(
        rules({ all: [{ field: "health", op: "eq", value: "healthy" }] }),
        device({ health: null }),
        { now },
      ),
    ).toBe(false);
  });

  it("supports model contains, serial prefix and asset tag prefix", () => {
    expect(
      evaluateDynamicGroupRules(
        rules({ all: [{ field: "model", op: "contains", value: "book pro" }] }),
        device(),
        { now },
      ),
    ).toBe(true);
    expect(
      evaluateDynamicGroupRules(
        rules({ all: [{ field: "model", op: "contains", value: "Mac mini" }] }),
        device(),
        { now },
      ),
    ).toBe(false);
    expect(
      evaluateDynamicGroupRules(
        rules({ all: [{ field: "serial", op: "prefix", value: "c02" }] }),
        device(),
        { now },
      ),
    ).toBe(true);
    expect(
      evaluateDynamicGroupRules(
        rules({ all: [{ field: "assetTag", op: "prefix", value: "AT-" }] }),
        device(),
        { now },
      ),
    ).toBe(true);
    expect(
      evaluateDynamicGroupRules(
        rules({ all: [{ field: "assetTag", op: "prefix", value: "ZZ" }] }),
        device(),
        { now },
      ),
    ).toBe(false);
  });

  it("evaluates stale-day thresholds against the injected clock", () => {
    const stale = rules({ all: [{ field: "staleDays", op: "gte", value: 14 }] });
    expect(evaluateDynamicGroupRules(stale, device({ lastSeenAt: at(14) }), { now })).toBe(true);
    expect(evaluateDynamicGroupRules(stale, device({ lastSeenAt: at(13) }), { now })).toBe(false);
    expect(
      evaluateDynamicGroupRules(
        rules({ all: [{ field: "staleDays", op: "gt", value: 14 }] }),
        device({ lastSeenAt: at(14) }),
        { now },
      ),
    ).toBe(false);
    expect(evaluateDynamicGroupRules(stale, device({ lastSeenAt: null }), { now })).toBe(false);
  });

  it("evaluates health levels", () => {
    expect(
      evaluateDynamicGroupRules(
        rules({ all: [{ field: "health", op: "eq", value: "critical" }] }),
        device({ health: { level: "critical", stale: false } }),
        { now },
      ),
    ).toBe(true);
    expect(
      evaluateDynamicGroupRules(
        rules({ all: [{ field: "health", op: "eq", value: "critical" }] }),
        device({ health: { level: "attention", stale: true } }),
        { now },
      ),
    ).toBe(false);
  });

  it("combines all/any/none lists", () => {
    const combined = rules({
      all: [{ field: "platform", op: "eq", value: "apple" }],
      any: [
        { field: "model", op: "contains", value: "MacBook" },
        { field: "serial", op: "prefix", value: "ZZZ" },
      ],
      none: [{ field: "health", op: "eq", value: "critical" }],
    });

    expect(evaluateDynamicGroupRules(combined, device(), { now })).toBe(true);
    expect(
      evaluateDynamicGroupRules(combined, device({ health: { level: "critical", stale: false } }), {
        now,
      }),
    ).toBe(false);
    expect(evaluateDynamicGroupRules(combined, device({ model: "Mac mini" }), { now })).toBe(false);
  });

  it("treats an empty rule set as matching nothing", () => {
    expect(evaluateDynamicGroupRules({ version: 1 }, device(), { now })).toBe(false);
    expect(
      evaluateDynamicGroupRules({ version: 1, all: [], any: [], none: [] }, device(), { now }),
    ).toBe(false);
  });

  it("requires a non-empty, supported rule set", () => {
    expect(dynamicGroupRulesProblem(null)).toMatch(/require/i);
    expect(dynamicGroupRulesProblem({ version: 1 })).toMatch(/at least one/i);
    expect(
      dynamicGroupRulesProblem({
        version: 1,
        all: [{ field: "staleDays", op: "gte", value: -1 }],
      }),
    ).toMatch(/negative/i);
    expect(
      dynamicGroupRulesProblem({
        version: 1,
        all: [{ field: "model", op: "contains", value: "  " }],
      }),
    ).toMatch(/needs a value/i);
    expect(
      dynamicGroupRulesProblem({
        version: 1,
        all: [{ field: "platform", op: "eq", value: "apple" }],
      }),
    ).toBeNull();
  });
});

describe("dynamic group materialisation", () => {
  const seedGroup = (db: ReturnType<typeof makeDb>, overrides: Schema.JsonObject = {}) => {
    db.store.enterprise_group.push({
      id: "group-1",
      organizationId: "org-1",
      name: "Dynamic",
      notes: null,
      kind: "dynamic",
      rules: rules({ all: [{ field: "platform", op: "eq", value: "apple" }] }),
      lastEvaluatedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  };

  const seedDevice = (
    db: ReturnType<typeof makeDb>,
    id: string,
    organizationId = "org-1",
    overrides: Schema.JsonObject = {},
  ) => {
    db.store.device.push({
      id,
      organizationId,
      proto: "apple",
      status: "enrolled",
      name: id,
      model: "MacBook Pro",
      serial: `SERIAL-${id}`,
      osVersion: "14.4.1",
      assetTag: null,
      enrolledAt: now,
      lastSeenAt: at(1),
      ...overrides,
    });
  };

  it("materialises matches as dynamic rows and preserves manual rows", async () => {
    const db = makeDb();
    seedGroup(db);
    seedDevice(db, "apple-1");
    seedDevice(db, "win-1", "org-1", { proto: "win", name: "Windows" });
    // An explicit manual exception that does not match the rule.
    db.store.group_device.push({ groupId: "group-1", deviceId: "win-1", source: "manual" });

    const result = await runEffect(syncDynamicGroup(db, "org-1", "group-1", { now }));

    expect(result).toMatchObject({ matched: 1, added: 1, removed: 0 });
    expect(db.store.group_device).toEqual(
      expect.arrayContaining([
        { groupId: "group-1", deviceId: "apple-1", source: "dynamic" },
        { groupId: "group-1", deviceId: "win-1", source: "manual" },
      ]),
    );
    expect(db.store.enterprise_group[0].lastEvaluatedAt).toEqual(now);
  });

  it("replaces only dynamic rows when rules change", async () => {
    const db = makeDb();
    seedGroup(db);
    seedDevice(db, "apple-1");
    seedDevice(db, "win-1", "org-1", { proto: "win", name: "Windows" });
    db.store.group_device.push({ groupId: "group-1", deviceId: "apple-1", source: "manual" });

    await runEffect(syncDynamicGroup(db, "org-1", "group-1", { now }));
    // The manual row for the already-matching device must not be rewritten as
    // dynamic (the primary key is shared).
    expect(db.store.group_device).toEqual([
      { groupId: "group-1", deviceId: "apple-1", source: "manual" },
    ]);

    db.store.enterprise_group[0].rules = rules({
      all: [{ field: "platform", op: "eq", value: "win" }],
    });
    const result = await runEffect(syncDynamicGroup(db, "org-1", "group-1", { now }));

    expect(result).toMatchObject({ matched: 1, added: 1, removed: 0 });
    expect(db.store.group_device).toEqual(
      expect.arrayContaining([
        { groupId: "group-1", deviceId: "apple-1", source: "manual" },
        { groupId: "group-1", deviceId: "win-1", source: "dynamic" },
      ]),
    );

    db.store.enterprise_group[0].rules = rules({ version: 1 });
    await runEffect(syncDynamicGroup(db, "org-1", "group-1", { now }));
    expect(db.store.group_device).toEqual([
      { groupId: "group-1", deviceId: "apple-1", source: "manual" },
    ]);
  });

  it("evaluates Windows activation from the device row", async () => {
    const db = makeDb();

    seedGroup(db, {
      rules: rules({ all: [{ field: "activation", op: "eq", value: "not-activated" }] }),
    });
    seedDevice(db, "win-unactivated", "org-1", {
      proto: "win",
      windowsActivationStatus: "not-activated",
    });
    seedDevice(db, "win-activated", "org-1", {
      proto: "win",
      windowsActivationStatus: "activated",
    });
    seedDevice(db, "win-unreported", "org-1", { proto: "win" });
    seedDevice(db, "apple-1");

    const notActivated = await runEffect(syncDynamicGroup(db, "org-1", "group-1", { now }));

    expect(notActivated.matched).toBe(1);
    expect(db.store.group_device).toEqual([
      { groupId: "group-1", deviceId: "win-unactivated", source: "dynamic" },
    ]);

    // "unknown" matches a Windows device that has not reported yet. It must
    // not match an activated device (the regression this guards against: an
    // omitted snapshot field made every Windows device unknown).
    db.store.enterprise_group[0].rules = rules({
      all: [{ field: "activation", op: "eq", value: "unknown" }],
    });

    const unknown = await runEffect(syncDynamicGroup(db, "org-1", "group-1", { now }));

    expect(unknown.matched).toBe(1);
    expect(db.store.group_device).toEqual([
      { groupId: "group-1", deviceId: "win-unreported", source: "dynamic" },
    ]);
  });

  it("never crosses tenant boundaries", async () => {
    const db = makeDb();
    seedGroup(db);
    seedDevice(db, "apple-1");

    const result = await runEffect(syncDynamicGroup(db, "org-2", "group-1", { now }));
    expect(result.matched).toBe(0);
    expect(db.store.group_device).toEqual([]);
  });

  it("updates one device without rescanning the fleet", async () => {
    const db = makeDb();
    seedGroup(db);
    seedDevice(db, "apple-1");
    seedDevice(db, "apple-2");
    // Device 2 was already materialised by a previous evaluation.
    db.store.group_device.push({ groupId: "group-1", deviceId: "apple-2", source: "dynamic" });

    const results = await runEffect(syncDynamicGroupsForDevice(db, "org-1", "apple-1", { now }));

    expect(results).toHaveLength(1);
    expect(db.store.group_device).toEqual(
      expect.arrayContaining([
        { groupId: "group-1", deviceId: "apple-1", source: "dynamic" },
        { groupId: "group-1", deviceId: "apple-2", source: "dynamic" },
      ]),
    );

    // Once the device no longer matches, only its dynamic row is removed.
    db.store.device.find((row) => row.id === "apple-1")!.proto = "win";
    await runEffect(syncDynamicGroupsForDevice(db, "org-1", "apple-1", { now }));
    expect(db.store.group_device).toEqual([
      { groupId: "group-1", deviceId: "apple-2", source: "dynamic" },
    ]);
  });

  it("previews live matches and current manual members", async () => {
    const db = makeDb();
    seedGroup(db);
    seedDevice(db, "apple-1");
    seedDevice(db, "win-1", "org-1", { proto: "win" });

    const dynamic = await runEffect(previewDynamicGroup(db, "org-1", "group-1", { now }));
    expect(dynamic).toMatchObject({ kind: "dynamic", count: 1 });
    expect(dynamic!.devices.map((row) => row.id)).toEqual(["apple-1"]);

    const manualGroup = {
      id: "manual-1",
      organizationId: "org-1",
      name: "Manual",
      notes: null,
      kind: "manual",
      rules: null,
      lastEvaluatedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    db.store.enterprise_group.push(manualGroup);
    db.store.group_device.push({ groupId: "manual-1", deviceId: "win-1", source: "manual" });
    const manual = await runEffect(previewDynamicGroup(db, "org-1", "manual-1", { now }));
    expect(manual).toMatchObject({ kind: "manual", count: 1 });
    expect(manual!.devices.map((row) => row.id)).toEqual(["win-1"]);
  });
});

describe("dynamic groups referencing other groups", () => {
  type Db = ReturnType<typeof makeDb>;

  const seedGroup = (db: Db, id: string, overrides: Schema.JsonObject = {}) =>
    db.store.enterprise_group.push({
      id,
      organizationId: "org-1",
      name: id,
      notes: null,
      kind: "manual",
      rules: null,
      directoryGroupId: null,
      lastEvaluatedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });

  const seedDevice = (db: Db, id: string, organizationId = "org-1") =>
    db.store.device.push({
      id,
      organizationId,
      proto: "apple",
      status: "enrolled",
      name: id,
      model: "MacBook Pro",
      serial: `SERIAL-${id}`,
      osVersion: "14.4.1",
      assetTag: null,
      enrolledAt: now,
      lastSeenAt: at(1),
    });

  const member = (db: Db, groupId: string, deviceId: string, source = "manual") =>
    db.store.group_device.push({ groupId, deviceId, source });

  const groupIds = (db: Db, groupId: string) =>
    db.store.group_device
      .filter((row) => row.groupId === groupId)
      .map((row) => row.deviceId)
      .sort();

  const groupRule = (references: ReadonlyArray<string>, op: "in" | "notIn" = "in") => ({
    version: 1,
    all: [{ field: "group", op, value: [...references] }],
  });

  it("materialises devices from a referenced manual group", async () => {
    const db = makeDb();

    seedGroup(db, "pilot");
    seedGroup(db, "ring", { kind: "dynamic", rules: groupRule(["pilot"]) });
    seedDevice(db, "apple-1");
    seedDevice(db, "apple-2");
    member(db, "pilot", "apple-1");

    const result = await runEffect(syncDynamicGroup(db, "org-1", "ring", { now }));

    expect(result).toMatchObject({ matched: 1, added: 1, removed: 0 });
    expect(groupIds(db, "ring")).toEqual(["apple-1"]);
  });

  it("matches a dynamic group and keeps exclusion precedence", async () => {
    const db = makeDb();

    seedGroup(db, "pilot");
    seedGroup(db, "exceptions");
    seedGroup(db, "dynamic-pilot", {
      kind: "dynamic",
      rules: { version: 1, all: [{ field: "platform", op: "eq", value: "apple" }] },
    });
    seedGroup(db, "ring", {
      kind: "dynamic",
      rules: groupRule(["pilot", "dynamic-pilot"]),
    });
    seedDevice(db, "apple-1");
    seedDevice(db, "apple-2");
    seedDevice(db, "apple-3");
    member(db, "pilot", "apple-1");
    member(db, "exceptions", "apple-2");

    await runEffect(syncDynamicGroupsForTenant(db, "org-1", { now }));

    // The dynamic reference matches all three; the manual reference adds
    // nothing new, so the union is the same set.
    expect(groupIds(db, "ring")).toEqual(["apple-1", "apple-2", "apple-3"]);

    // A device excluded from the referencing group never matches, even though
    // it is a member of a referenced group.
    db.store.group_exclusion.push({
      groupId: "ring",
      target: "device",
      targetId: "apple-1",
      createdAt: now,
    });

    await runEffect(syncDynamicGroup(db, "org-1", "ring", { now }));

    expect(groupIds(db, "ring")).toEqual(["apple-2", "apple-3"]);

    // "Everyone except the exception group" is one notIn criterion.
    db.store.enterprise_group.find((row) => row.id === "ring")!.rules = {
      version: 1,
      all: [
        { field: "platform", op: "eq", value: "apple" },
        { field: "group", op: "notIn", value: ["exceptions"] },
      ],
    };

    await runEffect(syncDynamicGroup(db, "org-1", "ring", { now }));

    // apple-1 matches the rule but its exclusion still wins; apple-2 is in the
    // exception group.
    expect(groupIds(db, "ring")).toEqual(["apple-3"]);
  });

  it("recomputes a referencing group when the referenced membership changes", async () => {
    const db = makeDb();

    seedGroup(db, "pilot");
    seedGroup(db, "ring", { kind: "dynamic", rules: groupRule(["pilot"]) });
    seedDevice(db, "apple-1");
    seedDevice(db, "apple-2");
    member(db, "pilot", "apple-1");

    await runEffect(syncDynamicGroup(db, "org-1", "ring", { now }));
    expect(groupIds(db, "ring")).toEqual(["apple-1"]);

    member(db, "pilot", "apple-2");
    const added = await runEffect(syncDynamicGroupDependents(db, "org-1", "pilot", { now }));

    expect(added.map((row) => row.groupId)).toEqual(["ring"]);
    expect(groupIds(db, "ring")).toEqual(["apple-1", "apple-2"]);

    db.store.group_device = db.store.group_device.filter(
      (row) => !(row.groupId === "pilot" && row.deviceId === "apple-1"),
    );
    await runEffect(syncDynamicGroupDependents(db, "org-1", "pilot", { now }));

    expect(groupIds(db, "ring")).toEqual(["apple-2"]);
  });

  it("recomputes dependents transitively in dependency order", async () => {
    const db = makeDb();

    seedGroup(db, "base");
    seedGroup(db, "middle", { kind: "dynamic", rules: groupRule(["base"]) });
    seedGroup(db, "outer", { kind: "dynamic", rules: groupRule(["middle"]) });
    seedDevice(db, "apple-1");
    member(db, "base", "apple-1");

    await runEffect(syncDynamicGroup(db, "org-1", "outer", { now }));
    // A full pass is needed once because neither derived group had rows yet.
    await runEffect(syncDynamicGroupsForTenant(db, "org-1", { now }));

    expect(groupIds(db, "middle")).toEqual(["apple-1"]);
    expect(groupIds(db, "outer")).toEqual(["apple-1"]);

    seedDevice(db, "apple-2");
    member(db, "base", "apple-2");

    const results = await runEffect(syncDynamicGroupDependents(db, "org-1", "base", { now }));

    expect(results.map((row) => row.groupId)).toEqual(["middle", "outer"]);
    expect(groupIds(db, "middle")).toEqual(["apple-1", "apple-2"]);
    expect(groupIds(db, "outer")).toEqual(["apple-1", "apple-2"]);
  });

  it("skips a circular reference and reports it in the preview", async () => {
    const db = makeDb();

    seedGroup(db, "group-a", { kind: "dynamic", rules: groupRule(["group-b"]) });
    seedGroup(db, "group-b", { kind: "dynamic", rules: groupRule(["group-a"]) });
    seedDevice(db, "apple-1");
    // Membership from before the loop was introduced must survive the skip.
    member(db, "group-a", "apple-1", "dynamic");

    const result = await runEffect(syncDynamicGroup(db, "org-1", "group-a", { now }));

    expect(result).toMatchObject({ skipped: "cycle", matched: 0 });
    expect(groupIds(db, "group-a")).toEqual(["apple-1"]);
    // A skipped group is not marked as freshly evaluated.
    expect(
      db.store.enterprise_group.find((row) => row.id === "group-a")!.lastEvaluatedAt,
    ).toBeNull();

    const preview = await runEffect(previewDynamicGroup(db, "org-1", "group-a", { now }));

    expect(preview?.problem).toMatch(/circular/i);
    expect(preview?.references?.map((reference) => reference.id)).toEqual(["group-b"]);
    expect(preview?.references?.[0]?.problem).toMatch(/circular/i);
  });

  it("skips a group that references a deleted group", async () => {
    const db = makeDb();

    seedGroup(db, "ring", { kind: "dynamic", rules: groupRule(["deleted-group"]) });
    seedDevice(db, "apple-1");
    member(db, "ring", "apple-1", "dynamic");

    const result = await runEffect(syncDynamicGroup(db, "org-1", "ring", { now }));
    const preview = await runEffect(previewDynamicGroup(db, "org-1", "ring", { now }));

    expect(result).toMatchObject({ skipped: "missing" });
    expect(groupIds(db, "ring")).toEqual(["apple-1"]);
    expect(preview?.problem).toMatch(/does not exist/i);
  });

  it("follows the referenced membership on a device check-in", async () => {
    const db = makeDb();

    seedGroup(db, "pilot");
    seedGroup(db, "ring", { kind: "dynamic", rules: groupRule(["pilot"]) });
    seedDevice(db, "apple-1");
    member(db, "pilot", "apple-1");

    await runEffect(syncDynamicGroupsForDevice(db, "org-1", "apple-1", { now }));
    expect(groupIds(db, "ring")).toEqual(["apple-1"]);

    db.store.group_device = db.store.group_device.filter(
      (row) => !(row.groupId === "pilot" && row.deviceId === "apple-1"),
    );
    await runEffect(syncDynamicGroupsForDevice(db, "org-1", "apple-1", { now }));

    expect(groupIds(db, "ring")).toEqual([]);
  });

  it("skips a rule that references its own nested ancestor", async () => {
    const db = makeDb();

    seedGroup(db, "parent");
    seedGroup(db, "child", {
      kind: "dynamic",
      rules: {
        version: 1,
        all: [
          { field: "platform", op: "eq", value: "apple" },
          { field: "group", op: "notIn", value: ["parent"] },
        ],
      },
    });
    db.store.group_group.push({
      parentGroupId: "parent",
      childGroupId: "child",
      createdAt: now,
    });
    seedDevice(db, "apple-1");
    member(db, "child", "apple-1", "dynamic");

    const first = await runEffect(syncDynamicGroupsForTenant(db, "org-1", { now }));
    const second = await runEffect(syncDynamicGroupsForTenant(db, "org-1", { now }));

    expect(first.find((row) => row.groupId === "child")).toMatchObject({ skipped: "cycle" });
    expect(second.find((row) => row.groupId === "child")).toMatchObject({ skipped: "cycle" });
    // The existing row survives both passes: no membership flapping.
    expect(groupIds(db, "child")).toEqual(["apple-1"]);
  });

  it("materialises a nested dynamic child before a group watching the parent", async () => {
    const db = makeDb();

    seedGroup(db, "parent");
    seedGroup(db, "child", {
      kind: "dynamic",
      rules: { version: 1, all: [{ field: "platform", op: "eq", value: "apple" }] },
    });
    seedGroup(db, "watcher", { kind: "dynamic", rules: groupRule(["parent"]) });
    db.store.group_group.push({
      parentGroupId: "parent",
      childGroupId: "child",
      createdAt: now,
    });
    seedDevice(db, "apple-1");

    const results = await runEffect(syncDynamicGroupsForTenant(db, "org-1", { now }));

    // One pass is enough: the plan orders the nested child before the watcher.
    expect(results.map((row) => row.groupId)).toEqual(["child", "watcher"]);
    expect(groupIds(db, "child")).toEqual(["apple-1"]);
    expect(groupIds(db, "watcher")).toEqual(["apple-1"]);
    expect(groupIds(db, "parent")).toEqual(["apple-1"]);
  });

  it("follows nested ancestry on a device check-in, including removal", async () => {
    const db = makeDb();

    seedGroup(db, "parent");
    seedGroup(db, "child", {
      kind: "dynamic",
      rules: { version: 1, all: [{ field: "platform", op: "eq", value: "apple" }] },
    });
    seedGroup(db, "watcher", { kind: "dynamic", rules: groupRule(["parent"]) });
    db.store.group_group.push({
      parentGroupId: "parent",
      childGroupId: "child",
      createdAt: now,
    });
    seedDevice(db, "apple-1");

    await runEffect(syncDynamicGroupsForDevice(db, "org-1", "apple-1", { now }));
    expect(groupIds(db, "watcher")).toEqual(["apple-1"]);

    db.store.device.find((row) => row.id === "apple-1")!.proto = "win";
    await runEffect(syncDynamicGroupsForDevice(db, "org-1", "apple-1", { now }));

    expect(groupIds(db, "child")).toEqual([]);
    expect(groupIds(db, "watcher")).toEqual([]);
  });

  it("recomputes a larger fleet in dependency order", async () => {
    const db = makeDb();

    seedGroup(db, "fleet");
    seedGroup(db, "blocked");
    seedGroup(db, "all-apple", {
      kind: "dynamic",
      rules: { version: 1, all: [{ field: "platform", op: "eq", value: "apple" }] },
    });
    seedGroup(db, "ring", {
      kind: "dynamic",
      rules: {
        version: 1,
        all: [
          { field: "group", op: "in", value: ["all-apple"] },
          { field: "group", op: "notIn", value: ["blocked"] },
        ],
      },
    });

    for (let index = 0; index < 2000; index++) {
      const id = `device-${index}`;
      seedDevice(db, id);
      member(db, "fleet", id);
      if (index < 500) member(db, "blocked", id);
    }

    const results = await runEffect(syncDynamicGroupsForTenant(db, "org-1", { now }));

    expect(results.map((row) => row.groupId)).toEqual(["all-apple", "ring"]);
    expect(results[0]).toMatchObject({ matched: 2000 });
    expect(results[1]).toMatchObject({ matched: 1500 });
    expect(db.store.group_device.filter((row) => row.groupId === "ring")).toHaveLength(1500);
  }, 20_000);
});
