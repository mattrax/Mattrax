import { describe, expect, it } from "vitest";
import { toggleVisibleColumnIds } from "./table-columns";

const columns = [{ id: "name" }, { id: "status" }, { id: "serial" }, { id: "model" }];

describe("controlled table columns", () => {
  it("adds one column to the active view's set instead of resetting to defaults", () => {
    expect(toggleVisibleColumnIds(columns, ["name", "model"], "serial", true)).toEqual([
      "name",
      "serial",
      "model",
    ]);
  });

  it("removes only the toggled column and keeps the rest", () => {
    expect(toggleVisibleColumnIds(columns, ["name", "status", "model"], "status", false)).toEqual([
      "name",
      "model",
    ]);
  });

  it("preserves the view's order when re-enabling a middle column", () => {
    expect(toggleVisibleColumnIds(columns, ["name", "model"], "status", true)).toEqual([
      "name",
      "status",
      "model",
    ]);
  });
});
