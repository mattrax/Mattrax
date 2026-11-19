import { describe, expect, it } from "vitest";
import { bulkFailureReason, bulkReport, rolePatch } from "./bulk-members";

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

  it("humanises other tags instead of hiding them", () => {
    expect(bulkFailureReason("last_owner")).toBe("Last owner");
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
