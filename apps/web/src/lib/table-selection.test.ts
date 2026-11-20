import { describe, expect, it } from "vitest";
import { applyRangeSelection, isRangeGesture, shouldOfferAllMatching } from "./table-selection";

const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];

const select = (
  selected: ReadonlyArray<string>,
  anchorId: string | null,
  targetId: string,
  checked = true,
  range = true,
  visible = rows,
) =>
  applyRangeSelection({
    rows: visible,
    selected: new Set(selected),
    anchorId,
    targetId,
    checked,
    range,
  });

describe("applyRangeSelection", () => {
  it("selects the inclusive span from anchor to target", () => {
    const result = select(["b"], "b", "d");

    expect([...result.ids].sort()).toEqual(["b", "c", "d"]);
    expect(result.anchorId).toBe("b");
  });

  it("works upwards and keeps the anchor for the next range gesture", () => {
    const result = select([], "d", "a");
    expect([...result.ids]).toEqual(["a", "b", "c", "d"]);

    // Extending again from the same anchor adds to the same span rather than
    // starting from the last target.
    const extended = select([...result.ids], result.anchorId, "b");
    expect([...extended.ids].sort()).toEqual(["a", "b", "c", "d"]);

    // Shift-clicking an already-selected row deselects the whole span and
    // leaves ids outside it alone.
    const cleared = select([...result.ids], result.anchorId, "b", false);
    expect([...cleared.ids]).toEqual(["a"]);
  });

  it("deselects the span without touching rows outside it", () => {
    const result = select(["a", "b", "c", "e"], "a", "c", false);

    expect([...result.ids].sort()).toEqual(["e"]);
  });

  it("preserves selected ids that are not visible on this page", () => {
    const result = select(["z", "b"], "b", "c");

    expect([...result.ids].sort()).toEqual(["b", "c", "z"]);
  });

  it("uses the rendered (filtered and sorted) row order as the range", () => {
    // A filtered view: only c, d and e are visible. A shift-click from c to e
    // must select exactly c, d, e, not the hidden ids between them.
    const visible = [{ id: "e" }, { id: "d" }, { id: "c" }];
    const result = select(["a"], "c", "e", true, true, visible);

    expect([...result.ids].sort()).toEqual(["a", "c", "d", "e"]);
  });

  it("falls back to a single toggle when the anchor is no longer visible", () => {
    const result = select(["a"], "a", "d", true, true, [
      { id: "b" },
      { id: "c" },
      { id: "d" },
    ]);

    expect([...result.ids].sort()).toEqual(["a", "d"]);
    expect(result.anchorId).toBe("d");
  });

  it("moves the anchor on a plain toggle", () => {
    const result = select(["a"], "a", "c", true, false);

    expect([...result.ids].sort()).toEqual(["a", "c"]);
    expect(result.anchorId).toBe("c");
  });

  it("ignores a target that is no longer rendered", () => {
    const result = select(["a"], "a", "gone");

    expect([...result.ids]).toEqual(["a"]);
    expect(result.anchorId).toBe("a");
  });
});

describe("isRangeGesture", () => {
  it("only treats Shift as a range modifier", () => {
    expect(isRangeGesture({ shiftKey: true })).toBe(true);
    expect(isRangeGesture({ shiftKey: false, ctrlKey: true, metaKey: true })).toBe(false);
    expect(isRangeGesture({})).toBe(false);
  });
});

describe("shouldOfferAllMatching", () => {
  it("is suppressed for controlled membership tables and when all-matching is on", () => {
    const base = {
      controlled: false,
      allMatching: false,
      allSelected: true,
      visible: 50,
      total: 120,
    };

    expect(shouldOfferAllMatching(base)).toBe(true);
    expect(shouldOfferAllMatching({ ...base, controlled: true })).toBe(false);
    expect(shouldOfferAllMatching({ ...base, allMatching: true })).toBe(false);
  });
});
