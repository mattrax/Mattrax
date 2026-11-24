/**
 * Bring a URL fragment into view after the page has rendered.
 *
 * The browser scrolls to a fragment during the initial load, before a
 * client-rendered section exists. Pages that own their scrollport (the
 * settings pane does) also reset it on navigation. Both cases need an explicit
 * lookup once the target element is mounted.
 */

export const hashTargetId = (hash: string): string | undefined => {
  if (!hash.startsWith("#")) return undefined;

  const id = hash.slice(1);

  return id.length > 0 ? id : undefined;
};

type HashTarget = {
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
};

export function scrollToHashTarget(
  hash: string,
  lookup: (id: string) => HashTarget | null | undefined,
): boolean {
  const id = hashTargetId(hash);

  if (!id) return false;

  const element = lookup(id);

  if (!element) return false;

  element.scrollIntoView({ block: "start" });

  return true;
}
