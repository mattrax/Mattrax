/**
 * Initials for an avatar tile. One name gives one letter; two or more give the
 * first letter of the first two words, which matches how people scan a list.
 */
export function initials(name: string | undefined | null): string {
  if (!name) return "?";

  const parts = name.trim().split(/\s+/);

  if (parts.length >= 2) return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();

  return parts[0]?.[0]?.toUpperCase() ?? "?";
}
