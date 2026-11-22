/** Region labels shared by the picker trigger and its lazily loaded globe. */

let regionNames: Intl.DisplayNames | undefined;

try {
  regionNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  regionNames = undefined;
}

export const regionName = (code: string): string => {
  const normalized = code.trim().toUpperCase();

  if (normalized.length !== 2) return normalized;

  try {
    return regionNames?.of(normalized) ?? normalized;
  } catch {
    return normalized;
  }
};

export const flagOf = (code: string): string =>
  code
    .trim()
    .toUpperCase()
    .replaceAll(/[A-Z]/g, (character) => String.fromCodePoint(127397 + character.charCodeAt(0)));
