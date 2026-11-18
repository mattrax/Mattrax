/**
 * Formatting helpers shared by the transactional templates. They are kept
 * free of database, transport and Worker dependencies so the rendered output
 * can be tested directly.
 */

export const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** Collapse whitespace so tenant-controlled text cannot inject mail headers. */
export const headerValue = (value: string): string => value.replaceAll(/\s+/g, " ").trim();

export const trimOrNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
};

/**
 * Only absolute `https` logos survive. Relative paths, inline data URLs and
 * unsafe schemes are dropped rather than rewritten, so the template never
 * emits an unusable or untrustworthy image.
 */
export const safeLogoUrl = (value: string | null | undefined): string | null => {
  const trimmed = trimOrNull(value);

  if (!trimmed) return null;

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  return parsed.protocol === "https:" ? trimmed : null;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const pad = (value: number): string => String(value).padStart(2, "0");

/** Format the expiry in UTC so every recipient sees the same deadline. */
export const formatExpiry = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isNaN(date.getTime()))
    return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} at ${pad(
      date.getUTCHours(),
    )}:${pad(date.getUTCMinutes())} UTC`;

  const raw = value instanceof Date ? "" : value.trim();

  return raw || "an unknown time";
};

/**
 * Pick black or white button text from the background luminance so a light
 * tenant brand colour stays readable.
 */
export const buttonTextColor = (background: string): string => {
  const hex = background.slice(1);

  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : hex;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.6 ? "#1c1917" : "#ffffff";
};
