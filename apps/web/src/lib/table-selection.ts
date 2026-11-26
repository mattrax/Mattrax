/**
 * Whether the bulk bar should offer "select all N matching this filter".
 *
 * Only server-paged tables know a total larger than the rendered page; client
 * tables already hold every row, so their header checkbox is the whole result
 * set. The offer is suppressed once all-matching is active (the bar then shows
 * the total instead) and while the page is only partially selected.
 */
export function shouldOfferAllMatching(state: {
  controlled: boolean;
  allMatching: boolean;
  allSelected: boolean;
  visible: number;
  total: number | undefined;
}): boolean {
  return (
    !state.controlled &&
    !state.allMatching &&
    state.allSelected &&
    state.total !== undefined &&
    state.total > state.visible
  );
}

/**
 * Shift-click range selection helpers.
 *
 * The range is computed over the rows the operator can currently see, in the
 * order the table is rendering them. Filtering and sorting therefore define
 * the range exactly as they define what "select all shown" means, and ids that
 * are selected but not visible (another page, or a row filtered out) are
 * preserved untouched.
 */

export type RangeSelectionResult = {
  /** The complete selection after applying the range. */
  readonly ids: Set<string>;
  /**
   * Anchor for the next shift-click. A plain toggle moves it to the clicked
   * row; extending a range keeps the original anchor so a second shift-click
   * grows or shrinks the same span.
   */
  readonly anchorId: string | null;
};

/**
 * Apply a checkbox change, extending from `anchorId` to `targetId` when the
 * caller reports a range gesture.
 *
 * If the anchor is missing (for example the page changed since it was set), the
 * gesture degrades to a single-row toggle rather than selecting an arbitrary
 * span.
 */
export function applyRangeSelection<Row extends { readonly id: string }>(state: {
  readonly rows: ReadonlyArray<Row>;
  readonly selected: ReadonlySet<string>;
  readonly anchorId: string | null;
  readonly targetId: string;
  readonly checked: boolean;
  readonly range: boolean;
}): RangeSelectionResult {
  const ids = new Set(state.selected);
  const targetIndex = state.rows.findIndex((row) => row.id === state.targetId);

  if (targetIndex < 0) return { ids, anchorId: state.anchorId };

  const anchorIndex =
    state.range && state.anchorId !== null
      ? state.rows.findIndex((row) => row.id === state.anchorId)
      : -1;

  if (!state.range || anchorIndex < 0 || state.anchorId === state.targetId) {
    if (state.checked) ids.add(state.targetId);
    else ids.delete(state.targetId);

    return { ids, anchorId: state.targetId };
  }

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);

  for (let index = start; index <= end; index++) {
    const row = state.rows[index];

    if (!row) continue;

    if (state.checked) ids.add(row.id);
    else ids.delete(row.id);
  }

  // Keep the anchor: a follow-up shift-click extends the same span.
  return { ids, anchorId: state.anchorId };
}

/** Whether a keyboard or pointer event asked for a range gesture. */
export const isRangeGesture = (event: {
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
}): boolean => event.shiftKey === true;
