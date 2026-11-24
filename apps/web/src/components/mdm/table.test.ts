import { describe, expect, it } from "vitest";
import { applyRangeSelection } from "~/lib/table-selection";
import {
  getTableLeadingColumnCount,
  getTableRenderWindow,
  shouldVirtualizeTableColumns,
  shouldVirtualizeTableRows,
} from "./table-render-window";

const offsetsFor = (rowCount: number, rowHeight = 36) =>
  Array.from({ length: rowCount + 1 }, (_, index) => index * rowHeight);

describe("getTableRenderWindow", () => {
  it("renders the visible rows plus a bounded overscan", () => {
    const window = getTableRenderWindow({
      rowCount: 200,
      offsets: offsetsFor(200),
      scrollTop: 100 * 36,
      viewportHeight: 10 * 36,
    });

    expect(window.start).toBe(94);
    expect(window.end).toBe(117);
    expect(window.end - window.start).toBeLessThanOrEqual(40);
    expect(window.top).toBe(94 * 36);
    expect(window.bottom).toBe(83 * 36);
  });

  it("keeps a hard render budget even when the viewport is very tall", () => {
    const window = getTableRenderWindow({
      rowCount: 500,
      offsets: offsetsFor(500),
      scrollTop: 0,
      viewportHeight: 20_000,
    });

    expect(window.end - window.start).toBe(40);
  });

  it("uses measured variable row heights for both search and spacers", () => {
    const offsets = [0, 36, 76, 112, 148, 184, 220];
    const window = getTableRenderWindow({
      rowCount: 6,
      offsets,
      scrollTop: 70,
      viewportHeight: 50,
      overscan: 1,
    });

    expect(window.start).toBe(0);
    expect(window.end).toBe(5);
    expect(window.top).toBe(0);
    expect(window.bottom).toBe(36);
  });

  it("includes nearby keyboard focus without losing the visible rows", () => {
    const window = getTableRenderWindow({
      rowCount: 200,
      offsets: offsetsFor(200),
      scrollTop: 100 * 36,
      viewportHeight: 10 * 36,
      focusIndex: 93,
    });

    expect(window.start).toBeLessThanOrEqual(93);
    expect(window.end).toBeGreaterThan(93);
    expect(window.start).toBeLessThanOrEqual(100);
    expect(window.end).toBeGreaterThanOrEqual(110);
    expect(window.end - window.start).toBeLessThanOrEqual(40);
  });

  it("does not let distant roving focus displace the visible rows", () => {
    const window = getTableRenderWindow({
      rowCount: 200,
      offsets: offsetsFor(200),
      scrollTop: 100 * 36,
      viewportHeight: 10 * 36,
      focusIndex: 0,
    });

    expect(window.start).toBe(94);
    expect(window.end).toBe(117);
  });

  it("preserves every visible row when the hard budget is nearly full", () => {
    const window = getTableRenderWindow({
      rowCount: 200,
      offsets: offsetsFor(200),
      scrollTop: 100 * 36,
      viewportHeight: 35 * 36,
      focusIndex: 93,
    });

    expect(window.end - window.start).toBe(40);
    expect(window.start).toBeLessThanOrEqual(100);
    expect(window.end).toBeGreaterThanOrEqual(135);
  });

  it("clamps focus-aware windows to the start of the table", () => {
    const window = getTableRenderWindow({
      rowCount: 100,
      offsets: offsetsFor(100),
      scrollTop: 0,
      viewportHeight: 36,
      overscan: 0,
      focusIndex: 5,
    });

    expect(window.start).toBe(0);
    expect(window.end).toBe(40);
  });

  it("returns an empty range for an empty table", () => {
    expect(
      getTableRenderWindow({ rowCount: 0, offsets: [0], scrollTop: 0, viewportHeight: 400 }),
    ).toEqual({ start: 0, end: 0, top: 0, bottom: 0 });
  });
});

describe("shouldVirtualizeTableRows", () => {
  it("leaves small tables unchanged and windows larger result sets", () => {
    expect(shouldVirtualizeTableRows(0)).toBe(false);
    expect(shouldVirtualizeTableRows(50)).toBe(false);
    expect(shouldVirtualizeTableRows(60)).toBe(false);
    expect(shouldVirtualizeTableRows(61)).toBe(true);
  });
});

describe("shouldVirtualizeTableColumns", () => {
  it("keeps ordinary column sets intact and windows attribute-heavy tables", () => {
    expect(shouldVirtualizeTableColumns(8)).toBe(false);
    expect(shouldVirtualizeTableColumns(12)).toBe(false);
    expect(shouldVirtualizeTableColumns(13)).toBe(true);
  });
});

describe("getTableLeadingColumnCount", () => {
  it("matches the exposed leading columns at desktop and phone widths", () => {
    expect(
      getTableLeadingColumnCount({
        selectable: true,
        rowNumbers: true,
        rowNumbersVisible: true,
      }),
    ).toBe(2);
    expect(
      getTableLeadingColumnCount({
        selectable: true,
        rowNumbers: true,
        rowNumbersVisible: false,
      }),
    ).toBe(1);
    expect(
      getTableLeadingColumnCount({
        selectable: false,
        rowNumbers: true,
        rowNumbersVisible: false,
      }),
    ).toBe(0);
  });
});

describe("column render budget", () => {
  it("caps mounted columns and reports horizontal spacer widths", () => {
    const offsets = Array.from({ length: 25 }, (_, index) => index * 180);
    const window = getTableRenderWindow({
      rowCount: 24,
      offsets,
      scrollTop: 1_800,
      viewportHeight: 1_080,
      overscan: 2,
      maxRows: 12,
    });

    expect(window.end - window.start).toBeLessThanOrEqual(12);
    expect(window.start).toBeGreaterThan(0);
    expect(window.top).toBe(window.start * 180);
    expect(window.bottom).toBe((24 - window.end) * 180);
  });
});

describe("virtualized selection mapping", () => {
  it("maps a rendered row back to its full index for range selection", () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({ id: `row-${index}` }));
    const renderWindow = getTableRenderWindow({
      rowCount: rows.length,
      offsets: offsetsFor(rows.length),
      scrollTop: 100 * 36,
      viewportHeight: 10 * 36,
    });
    const localIndex = 3;
    const target = rows[renderWindow.start + localIndex]!;
    const anchor = rows[5]!;
    const result = applyRangeSelection({
      rows,
      selected: new Set([anchor.id]),
      anchorId: anchor.id,
      targetId: target.id,
      checked: true,
      range: true,
    });

    expect(target.id).toBe(`row-${renderWindow.start + localIndex}`);
    expect(result.ids.size).toBe(renderWindow.start + localIndex - 5 + 1);
    expect(result.ids.has("row-50")).toBe(true);
    expect(result.ids.has("row-150")).toBe(false);
    expect(result.anchorId).toBe(anchor.id);
  });
});
