import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  dynamicGroupDependentsOf,
  dynamicGroupReferenceProblem,
  DynamicGroupRules,
  dynamicGroupRuleGroupIds,
  dynamicGroupRulesProblem,
  evaluateDynamicGroupRules,
  planDynamicGroupDependencies,
} from "./dynamicGroups.ts";
import type { DynamicGroupReferenceNode } from "./dynamicGroups.ts";
import type { DeviceQueryDevice } from "./deviceQuery.ts";

const now = new Date("2026-11-10T12:00:00.000Z");

const device = (overrides: Partial<DeviceQueryDevice> = {}): DeviceQueryDevice => ({
  proto: "apple",
  model: "MacBook Pro",
  osVersion: "14.4.1",
  serial: "C02ABC123",
  lastSeenAt: new Date("2026-11-09T12:00:00.000Z"),
  health: { level: "healthy", stale: false },
  ...overrides,
});

const membership = (groups: Record<string, ReadonlyArray<string>>) =>
  new Map(
    Object.entries(groups).map(([id, deviceIds]) => [id, { members: new Set(deviceIds) } as const]),
  );

describe("dynamic group rule versioning", () => {
  it("decodes a rule saved before the group criterion existed", () => {
    const saved: DynamicGroupRules = {
      version: 1,
      all: [
        { field: "platform", op: "eq", value: "apple" },
        { field: "osVersion", op: "gte", value: "14" },
      ],
      any: [{ field: "model", op: "contains", value: "MacBook" }],
      none: [{ field: "health", op: "eq", value: "critical" }],
    };

    // The old JSON must decode to exactly the same tree. Adding `group`
    // additively is what keeps existing saved rules and the API valid.
    expect(Schema.decodeUnknownSync(DynamicGroupRules)(saved)).toEqual(saved);
    expect(Schema.encodeSync(DynamicGroupRules)(saved)).toEqual(saved);
  });

  it("accepts a group condition with one id or a list", () => {
    const rules = (value: string | ReadonlyArray<string>) => ({
      version: 1,
      all: [{ field: "group", op: "in", value }],
    });

    expect(
      dynamicGroupRuleGroupIds(Schema.decodeUnknownSync(DynamicGroupRules)(rules("a"))),
    ).toEqual(["a"]);
    expect(
      dynamicGroupRuleGroupIds(Schema.decodeUnknownSync(DynamicGroupRules)(rules(["a", "b"]))),
    ).toEqual(["a", "b"]);
  });

  it("requires a group criterion to name at least one group", () => {
    expect(dynamicGroupRulesProblem({ version: 1, all: [{ field: "group", value: [] }] })).toMatch(
      /at least one group/i,
    );
    expect(
      dynamicGroupRulesProblem({ version: 1, all: [{ field: "group", value: ["group-1"] }] }),
    ).toBeNull();
  });
});

describe("dynamic group group criterion", () => {
  it("matches any listed group for in and none for notIn", () => {
    const inAny = { version: 1, all: [{ field: "group", op: "in", value: ["a", "b"] }] } as const;
    const groups = membership({ a: [], b: ["device-1"] });

    expect(
      evaluateDynamicGroupRules(inAny, device(), {
        now,
        deviceId: "device-1",
        groupMembership: groups,
      }),
    ).toBe(true);
    expect(
      evaluateDynamicGroupRules(inAny, device(), {
        now,
        deviceId: "device-2",
        groupMembership: groups,
      }),
    ).toBe(false);

    const notIn = {
      version: 1,
      all: [{ field: "group", op: "notIn", value: ["b"] }],
    } as const;
    expect(
      evaluateDynamicGroupRules(notIn, device(), {
        now,
        deviceId: "device-2",
        groupMembership: groups,
      }),
    ).toBe(true);
    expect(
      evaluateDynamicGroupRules(notIn, device(), {
        now,
        deviceId: "device-1",
        groupMembership: groups,
      }),
    ).toBe(false);
  });

  it("fails an unresolved reference instead of treating it as empty", () => {
    const rules = {
      version: 1,
      all: [{ field: "group", op: "notIn", value: ["gone"] }],
    } as const;

    // No membership context at all is "unknown", not "not a member": matching
    // would silently widen a notIn rule to the whole fleet.
    expect(evaluateDynamicGroupRules(rules, device(), { now, deviceId: "device-1" })).toBe(false);
    expect(
      evaluateDynamicGroupRules(rules, device(), {
        now,
        deviceId: "device-1",
        groupMembership: new Map([["gone", { members: new Set(), problem: "missing" }]]),
      }),
    ).toBe(false);
  });
});

describe("dynamic group dependency plan", () => {
  const node = (id: string, references: ReadonlyArray<string> = []): DynamicGroupReferenceNode => ({
    id,
    rules:
      references.length === 0
        ? { version: 1, all: [{ field: "platform", op: "eq", value: "apple" }] }
        : { version: 1, all: [{ field: "group", op: "in", value: [...references] }] },
  });

  it("orders dependencies before the groups that reference them", () => {
    const plan = planDynamicGroupDependencies([node("a", ["b"]), node("b", ["c"]), node("c")]);

    expect(plan.order).toEqual(["c", "b", "a"]);
    expect(plan.problems.size).toBe(0);
  });

  it("handles a diamond reference once per group", () => {
    const plan = planDynamicGroupDependencies([
      node("a", ["b", "c"]),
      node("b", ["d"]),
      node("c", ["d"]),
      node("d"),
    ]);

    expect(plan.problems.size).toBe(0);
    expect(new Set(plan.order).size).toBe(4);
    expect(plan.order.indexOf("d")).toBeLessThan(plan.order.indexOf("b"));
    expect(plan.order.indexOf("d")).toBeLessThan(plan.order.indexOf("c"));
    expect(plan.order.indexOf("b")).toBeLessThan(plan.order.indexOf("a"));
    expect(plan.order.indexOf("c")).toBeLessThan(plan.order.indexOf("a"));
  });

  it("detects a direct self-reference", () => {
    const plan = planDynamicGroupDependencies([node("a", ["a"])]);

    expect(plan.order).toEqual([]);
    expect(plan.problems.get("a")).toMatchObject({ reason: "cycle" });
    expect(plan.problems.get("a")?.path).toEqual(["a", "a"]);
  });

  it("detects a transitive cycle and skips dependents", () => {
    const plan = planDynamicGroupDependencies([
      node("a", ["b"]),
      node("b", ["c"]),
      node("c", ["a"]),
      node("d", ["a"]),
    ]);

    expect(plan.order).toEqual([]);
    expect(plan.problems.get("a")?.reason).toBe("cycle");
    expect(plan.problems.get("b")?.reason).toBe("cycle");
    expect(plan.problems.get("c")?.reason).toBe("cycle");
    expect(plan.problems.get("d")?.reason).toBe("cycle");
    // The recorded path is the cycle the DFS closed, not a rotation per member.
    expect(plan.problems.get("b")?.path).toEqual(["a", "b", "c", "a"]);
    expect(plan.problems.get("d")?.path).toEqual(["d", "a", "b", "c", "a"]);
  });

  it("skips a group whose reference was deleted", () => {
    const plan = planDynamicGroupDependencies([node("a", ["gone"])]);

    expect(plan.order).toEqual([]);
    expect(plan.problems.get("a")).toMatchObject({ reason: "missing" });
  });

  it("lets a manual group be referenced without contributing edges", () => {
    const plan = planDynamicGroupDependencies([
      { id: "manual-1", rules: null },
      node("dynamic-1", ["manual-1"]),
    ]);

    expect(plan.problems.size).toBe(0);
    expect(plan.order).toEqual(["dynamic-1"]);
    expect([...dynamicGroupDependentsOf(plan, "manual-1")]).toEqual(["dynamic-1"]);
  });

  it("rejects self and longer cycles on the write path", () => {
    const groups = [node("a", ["b"]), node("b", ["c"]), node("c")];

    expect(
      dynamicGroupReferenceProblem(
        "a",
        { version: 1, all: [{ field: "group", op: "in", value: ["a"] }] },
        groups,
      ),
    ).toMatch(/itself/i);
    expect(
      dynamicGroupReferenceProblem(
        "c",
        { version: 1, all: [{ field: "group", op: "in", value: ["a"] }] },
        groups,
      ),
    ).toMatch(/circular/i);
    expect(
      dynamicGroupReferenceProblem(
        "c",
        { version: 1, all: [{ field: "group", op: "in", value: ["missing"] }] },
        groups,
      ),
    ).toMatch(/same tenant/i);
  });
});
