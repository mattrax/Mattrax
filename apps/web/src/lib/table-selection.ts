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
