export const TABLE_ROW_HEIGHT = 36;
export const TABLE_HEADER_HEIGHT = 32;
export const TABLE_VIRTUALIZATION_THRESHOLD = 60;
export const TABLE_OVERSCAN = 6;
export const TABLE_MAX_RENDERED_ROWS = 40;
export const TABLE_MAX_VIEWPORT_HEIGHT = 1_440;
export const TABLE_INITIAL_VIEWPORT_HEIGHT = 540;
export const TABLE_INITIAL_VIEWPORT_WIDTH = 1_440;
export const TABLE_COLUMN_WIDTH = 180;
export const TABLE_COLUMN_VIRTUALIZATION_THRESHOLD = 12;
export const TABLE_COLUMN_OVERSCAN = 2;
export const TABLE_MAX_RENDERED_COLUMNS = 12;

export const shouldVirtualizeTableRows = (rowCount: number) =>
  rowCount > TABLE_VIRTUALIZATION_THRESHOLD;

export const shouldVirtualizeTableColumns = (columnCount: number) =>
  columnCount > TABLE_COLUMN_VIRTUALIZATION_THRESHOLD;

export type TableRenderWindow = {
  readonly start: number;
  readonly end: number;
  readonly top: number;
  readonly bottom: number;
};

const rowAtOffset = (offsets: readonly number[], offset: number, rowCount: number) => {
  let low = 0;
  let high = rowCount;

  while (low < high) {
    const middle = (low + high) >>> 1;

    if ((offsets[middle + 1] ?? 0) <= offset) low = middle + 1;
    else high = middle;
  }

  return Math.min(low, rowCount - 1);
};

/**
 * Map a scroll viewport to a contiguous row slice. Offsets are prefix sums of
 * row heights, so variable-height cells do not accumulate guesswork as the
 * operator scrolls. The returned range always includes its overscan budget.
 */
export function getTableRenderWindow(input: {
  rowCount: number;
  offsets: readonly number[];
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
  maxRows?: number;
  focusIndex?: number;
}): TableRenderWindow {
  if (input.rowCount <= 0) return { start: 0, end: 0, top: 0, bottom: 0 };

  const overscan = Math.max(0, input.overscan ?? TABLE_OVERSCAN);
  const budget = Math.max(1, Math.min(input.maxRows ?? TABLE_MAX_RENDERED_ROWS, input.rowCount));
  const total = input.offsets[input.rowCount] ?? input.rowCount * TABLE_ROW_HEIGHT;
  const scrollTop = Math.max(0, Math.min(input.scrollTop, total));
  const firstVisible = rowAtOffset(input.offsets, scrollTop, input.rowCount);
  const lastVisible = rowAtOffset(
    input.offsets,
    scrollTop + Math.max(1, input.viewportHeight),
    input.rowCount,
  );
  let start = Math.max(0, firstVisible - overscan);
  let end = Math.min(input.rowCount, lastVisible + 1 + overscan);
  const focusIndex = input.focusIndex ?? -1;
  const placeWindow = (preferredStart: number) => {
    start = Math.max(0, Math.min(preferredStart, input.rowCount - budget));
    end = start + budget;
  };

  if (end - start > budget) {
    placeWindow(Math.floor((firstVisible + lastVisible) / 2) - Math.floor(budget / 2));
  }

  // Keyboard navigation can put focus just beyond the visible rows. Only spend
  // budget left over after every visible row; a tall viewport must never lose
  // rows to make room for an off-screen roving tabindex.
  const visibleCount = lastVisible - firstVisible + 1;
  const spareRows = budget - visibleCount;

  if (focusIndex >= 0 && spareRows > 0 && (focusIndex < start || focusIndex >= end)) {
    if (focusIndex < firstVisible && firstVisible - focusIndex <= spareRows) {
      end = Math.min(input.rowCount, focusIndex + budget);
      start = end - budget;
    } else if (focusIndex > lastVisible && focusIndex - lastVisible <= spareRows) {
      start = Math.max(0, focusIndex + 1 - budget);
      end = start + budget;
    }
  }

  return {
    start,
    end,
    top: input.offsets[start] ?? 0,
    bottom: total - (input.offsets[end] ?? total),
  };
}
