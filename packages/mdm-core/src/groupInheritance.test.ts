import { describe, expect, it } from "vitest";
import {
  GROUP_NESTING_MAX_DEPTH,
  ancestorGroupIds,
  groupHierarchyProblem,
  type GroupHierarchyEdge,
} from "./groupInheritance.ts";

const edge = (parentId: string, childId: string): GroupHierarchyEdge => ({ parentId, childId });

describe("groupHierarchyProblem", () => {
  it("allows a plain parent/child edge", () => {
    expect(groupHierarchyProblem([], "parent", "child")).toBeNull();
  });

  it("rejects nesting a group inside itself", () => {
    expect(groupHierarchyProblem([], "group", "group")).toContain("itself");
  });

  it("rejects a direct loop", () => {
    const edges = [edge("a", "b")];

    // b -> a would close a <-> b.
    expect(groupHierarchyProblem(edges, "b", "a")).toContain("loop");
  });

  it("rejects an indirect loop across several levels", () => {
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "d")];

    // d -> a would make a -> b -> c -> d -> a.
    expect(groupHierarchyProblem(edges, "d", "a")).toContain("loop");
  });

  it("treats an existing edge as an idempotent no-op", () => {
    expect(groupHierarchyProblem([edge("a", "b")], "a", "b")).toBeNull();
  });

  it("allows a device to reach the same group through two branches", () => {
    const edges = [edge("root", "left"), edge("root", "right"), edge("left", "leaf")];

    expect(groupHierarchyProblem(edges, "right", "leaf")).toBeNull();
  });

  it("refuses a chain deeper than the cap", () => {
    const edges: Array<GroupHierarchyEdge> = [];

    for (let index = 0; index < GROUP_NESTING_MAX_DEPTH - 1; index++)
      edges.push(edge(`g${index}`, `g${index + 1}`));

    // The existing chain already has the maximum number of groups; adding a
    // child below the deepest group would make it one too many.
    expect(
      groupHierarchyProblem(edges, `g${GROUP_NESTING_MAX_DEPTH - 1}`, "extra"),
    ).toContain("levels deep");
  });

  it("allows a chain exactly at the cap", () => {
    const edges: Array<GroupHierarchyEdge> = [];

    for (let index = 0; index < GROUP_NESTING_MAX_DEPTH - 2; index++)
      edges.push(edge(`g${index}`, `g${index + 1}`));

    expect(
      groupHierarchyProblem(edges, `g${GROUP_NESTING_MAX_DEPTH - 2}`, `g${GROUP_NESTING_MAX_DEPTH - 1}`),
    ).toBeNull();
  });
});

describe("ancestorGroupIds", () => {
  it("returns the group then each enclosing group, nearest first", () => {
    const edges = [edge("root", "middle"), edge("middle", "leaf")];

    expect(ancestorGroupIds(edges, "leaf")).toEqual(["leaf", "middle", "root"]);
  });

  it("deduplicates a diamond and reports each group once", () => {
    const edges = [edge("root", "left"), edge("root", "right"), edge("left", "leaf")];

    const chain = ancestorGroupIds(edges, "leaf");

    expect(chain[0]).toBe("leaf");
    expect(chain).toContain("left");
    expect(new Set(chain).size).toBe(chain.length);
  });

  it("terminates on corrupt cyclic data", () => {
    const edges = [edge("a", "b"), edge("b", "a")];

    const chain = ancestorGroupIds(edges, "a");

    expect(chain).toEqual(["a", "b"]);
    expect(chain.length).toBeLessThanOrEqual(GROUP_NESTING_MAX_DEPTH);
  });

  it("caps a chain that is deeper than the supported nesting", () => {
    const edges: Array<GroupHierarchyEdge> = [];

    for (let index = 0; index < GROUP_NESTING_MAX_DEPTH + 5; index++)
      edges.push(edge(`g${index}`, `g${index + 1}`));

    expect(ancestorGroupIds(edges, `g${GROUP_NESTING_MAX_DEPTH + 5}`)).toHaveLength(
      GROUP_NESTING_MAX_DEPTH,
    );
  });
});
