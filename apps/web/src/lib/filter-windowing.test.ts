import { describe, expect, it } from "vitest";
import {
  FILTER_GROUP_HEIGHT,
  FILTER_OPTION_HEIGHT,
  positionFilterRows,
  visibleFilterRows,
} from "../../../../packages/ui/src/filter-windowing";
import type { FilterPickerRow } from "../../../../packages/ui/src/filter-windowing";

const rows: FilterPickerRow[] = [
  { key: "group", height: FILTER_GROUP_HEIGHT, group: "Device" },
  ...Array.from({ length: 100 }, (_, optionIndex) => ({
    key: `option-${optionIndex}`,
    height: FILTER_OPTION_HEIGHT,
    optionIndex,
    fieldId: String(optionIndex),
    label: `Option ${optionIndex}`,
  })),
];

describe("filter picker windowing", () => {
  it("positions headings and options without folding or copying the source rows", () => {
    const positioned = positionFilterRows(rows);

    expect(positioned.entries[0]).toEqual({ row: rows[0], top: 0 });
    expect(positioned.entries[1]).toEqual({ row: rows[1], top: FILTER_GROUP_HEIGHT });
    expect(positioned.byOption.get(99)?.top).toBe(FILTER_GROUP_HEIGHT + 99 * FILTER_OPTION_HEIGHT);
    expect(positioned.height).toBe(FILTER_GROUP_HEIGHT + 100 * FILTER_OPTION_HEIGHT);
    expect(rows).toHaveLength(101);
  });

  it("renders only a viewport-bounded slice with overscan", () => {
    const positioned = positionFilterRows(rows);
    const visible = visibleFilterRows(positioned, 1_000, 260, 0);

    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThanOrEqual(11);
    expect(visible[0]!.top).toBeLessThanOrEqual(1_000);
    expect(visible.at(-1)!.top + visible.at(-1)!.row.height).toBeGreaterThanOrEqual(1_260);
  });

  it("keeps the first and last rows reachable at the scroll boundaries", () => {
    const positioned = positionFilterRows(rows);

    expect(visibleFilterRows(positioned, -20, 260, 0)[0]?.row.key).toBe("group");
    expect(visibleFilterRows(positioned, positioned.height, 260, 0).at(-1)?.row.key).toBe(
      "option-99",
    );
  });
});
