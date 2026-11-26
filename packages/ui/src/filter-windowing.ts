export const FILTER_OPTION_HEIGHT = 28;

export const FILTER_GROUP_HEIGHT = 24;

export const FILTER_OVERSCAN_PIXELS = 112;

export type FilterPickerRow = {
  readonly key: string;
  readonly height: number;
  /** Position among selectable options, excluding group headings. */
  readonly optionIndex?: number;
  readonly fieldId?: string;
  readonly label?: string;
  readonly group?: string;
};

export type PositionedFilterRow = {
  readonly row: FilterPickerRow;
  readonly top: number;
};

export type PositionedFilterRows = {
  readonly entries: ReadonlyArray<PositionedFilterRow>;
  readonly byOption: ReadonlyMap<number, PositionedFilterRow>;
  readonly height: number;
};

export const positionFilterRows = (rows: ReadonlyArray<FilterPickerRow>): PositionedFilterRows => {
  const entries: PositionedFilterRow[] = [];
  const byOption = new Map<number, PositionedFilterRow>();
  let top = 0;

  for (const row of rows) {
    const positioned = { row, top };
    entries.push(positioned);
    if (row.optionIndex !== undefined) byOption.set(row.optionIndex, positioned);
    top += row.height;
  }

  return { entries, byOption, height: top };
};

/** Binary-search the fixed-height rows so scrolling does not scan the list. */
export const visibleFilterRows = (
  positioned: PositionedFilterRows,
  scrollTop: number,
  viewportHeight: number,
  overscan = FILTER_OVERSCAN_PIXELS,
): ReadonlyArray<PositionedFilterRow> => {
  const { entries } = positioned;
  const maxScroll = Math.max(0, positioned.height - viewportHeight);
  const top = Math.min(Math.max(scrollTop, 0), maxScroll);
  const firstEdge = Math.max(0, top - overscan);
  const lastEdge = top + viewportHeight + overscan;
  let low = 0;
  let high = entries.length;

  while (low < high) {
    const middle = (low + high) >>> 1;
    const entry = entries[middle]!;

    if (entry.top + entry.row.height <= firstEdge) low = middle + 1;
    else high = middle;
  }

  const start = low;
  high = entries.length;

  while (low < high) {
    const middle = (low + high) >>> 1;
    const entry = entries[middle]!;

    if (entry.top < lastEdge) low = middle + 1;
    else high = middle;
  }

  return entries.slice(start, low);
};
