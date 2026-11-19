import { describe, expect, it } from "vitest";
import {
  bulkEntityNoun,
  bulkFailureDetails,
  bulkFailureReason,
  bulkReport,
  chunkIds,
  mergeBulkResults,
  rolePatch,
  runBulkBatches,
} from "./bulk-members";

describe("rolePatch", () => {
  it("maps a built-in role token to the API shape", () => {
    expect(rolePatch("builtin:admin")).toEqual({ role: "admin", roleId: null });
  });

  it("maps a custom role token to member fallback plus the role id", () => {
    expect(rolePatch("role:role-1")).toEqual({ role: "member", roleId: "role-1" });
  });
});

describe("bulkFailureReason", () => {
  it("translates the tagged not-found reason", () => {
    expect(bulkFailureReason("notFound")).toBe("No longer exists");
  });

  it("labels the other tagged reasons instead of camel-casing them", () => {
    expect(bulkFailureReason("forbidden")).toBe("Not allowed");
    expect(bulkFailureReason("lastOwner")).toBe("Cannot remove the last owner");
  });

  it("humanises other tags instead of hiding them", () => {
    expect(bulkFailureReason("last_owner")).toBe("Last owner");
  });
});

describe("bulk entity copy", () => {
  it("pluralises policies without drifting from the member labels", () => {
    expect(bulkEntityNoun("policy", 1)).toBe("1 policy");
    expect(bulkEntityNoun("policy", 3)).toBe("3 policies");
    expect(bulkEntityNoun("device", 2)).toBe("2 devices");
  });

  it("formats one detail line per failed row", () => {
    expect(
      bulkFailureDetails([{ id: "user-1", name: "Ada", reason: "No longer exists" }]),
    ).toEqual(["Ada: No longer exists"]);
  });
});

describe("bulk batching", () => {
  it("splits ids into endpoint-sized batches", () => {
    expect(chunkIds(["a", "b", "c", "d", "e"], 2)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ]);
  });

  it("merges updated and failed rows from every batch", async () => {
    const batches: string[][] = [];

    const result = await runBulkBatches(["a", "b", "c", "d", "e"], 2, async (batch) => {
      batches.push(batch);

      return {
        updated: batch.slice(0, 1),
        failed: batch.slice(1).map((id) => ({ id, reason: "notFound" })),
      };
    });

    expect(batches).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(result).toEqual({
      updated: ["a", "c", "e"],
      failed: [
        { id: "b", reason: "notFound" },
        { id: "d", reason: "notFound" },
      ],
    });
  });

  it("keeps the merge order when batches are combined directly", () => {
    expect(
      mergeBulkResults([
        { updated: ["a"], failed: [] },
        { updated: [], failed: [{ id: "b", reason: "forbidden" }] },
        { updated: ["c"], failed: [] },
      ]),
    ).toEqual({
      updated: ["a", "c"],
      failed: [{ id: "b", reason: "forbidden" }],
    });
  });
});

describe("bulkReport", () => {
  const noun = { one: "administrator", many: "administrators" };

  it("reports a clean success", () => {
    expect(
      bulkReport(noun, { ok: "changed the role for", fail: "could not change the role for" }, {
        succeeded: 2,
        failed: [],
      }),
    ).toEqual({
      tone: "success",
      title: "Changed the role for 2 administrators",
      details: [],
    });
  });

  it("reports a partial failure with the failed rows", () => {
    expect(
      bulkReport(noun, { ok: "added", fail: "could not add" }, {
        succeeded: 1,
        failed: [{ id: "user-2", name: "Ada", reason: "No longer exists" }],
      }),
    ).toEqual({
      tone: "warning",
      title: "Added 1 of 2 administrators",
      description: "1 administrator did not complete.",
      details: ["Ada: No longer exists"],
    });
  });

  it("reports a total failure as an error", () => {
    expect(
      bulkReport(noun, { ok: "added", fail: "could not add" }, {
        succeeded: 0,
        failed: [
          { id: "user-1", name: "Ada", reason: "No longer exists" },
          { id: "user-2", name: "Grace", reason: "Forbidden" },
        ],
      }),
    ).toEqual({
      tone: "error",
      title: "Could not add 2 administrators",
      details: ["Ada: No longer exists", "Grace: Forbidden"],
    });
  });
});
