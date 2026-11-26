export type SectionTabModifiers = {
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
};

/**
 * The next tab for a WAI-ARIA horizontal tablist key press.
 *
 * Arrow keys wrap, Home and End jump to the edges. Returns undefined for any
 * other key so the browser keeps its normal behaviour.
 *
 * Modified presses are browser shortcuts (Alt+Left and Alt+Right are history,
 * Ctrl/Cmd+Home and Ctrl/Cmd+End jump the document), so the tablist must not
 * consume them.
 */
export function sectionTabTarget(
  ids: ReadonlyArray<string>,
  activeId: string,
  key: string,
  modifiers?: SectionTabModifiers,
): string | undefined {
  if (
    modifiers &&
    (modifiers.altKey || modifiers.ctrlKey || modifiers.metaKey || modifiers.shiftKey)
  )
    return undefined;

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

/**
 * Activate a navigation tab after the current key event has settled.
 *
 * Solid Router starts link navigation as a transition. A synthetic click in
 * the keydown that first adopts a hydrated tablist can be dropped while that
 * transition is still settling, so automatic keyboard activation waits one
 * macrotask before clicking the real anchor.
 */
export function activateSectionTabAnchor(anchor: Pick<HTMLElement, "click"> | undefined): void {
  if (!anchor) return;

  setTimeout(() => anchor.click(), 0);
}
