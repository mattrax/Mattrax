/**
 * The next tab for a WAI-ARIA horizontal tablist key press.
 *
 * Arrow keys wrap, Home and End jump to the edges. Returns undefined for any
 * other key so the browser keeps its normal behaviour.
 */
export function sectionTabTarget(
  ids: ReadonlyArray<string>,
  activeId: string,
  key: string,
): string | undefined {
  if (ids.length === 0) return undefined;

  const current = Math.max(0, ids.indexOf(activeId));

  switch (key) {
    case "ArrowRight":
      return ids[(current + 1) % ids.length];
    case "ArrowLeft":
      return ids[(current - 1 + ids.length) % ids.length];
    case "Home":
      return ids[0];
    case "End":
      return ids.at(-1);
    default:
      return undefined;
  }
}
