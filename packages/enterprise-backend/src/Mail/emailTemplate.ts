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
 * Resolve a logo to an absolute `https` URL. Same-origin root-relative paths
 * are resolved against the deployment origin because tenant settings accept
 * them; inline data URLs and unsafe schemes are dropped. Email clients do not
 * reliably fetch data URLs, so the settings and docs tell operators to use an
 * https image for mail.
 */
export const safeLogoUrl = (
  value: string | null | undefined,
  origin?: string | null,
): string | null => {
  const trimmed = trimOrNull(value);

  if (!trimmed) return null;

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    if (!origin) return null;

    try {
      const resolved = new URL(trimmed, origin);

      return resolved.protocol === "https:" ? resolved.href : null;
    } catch {
      return null;
    }
  }

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

const NEAR_BLACK = "#1c1917";

const expandHex = (background: string): string | null => {
  const hex = background.trim().replace(/^#/, "");

  if (hex.length === 3)
    return hex
      .split("")
      .map((char) => `${char}${char}`)
      .join("");

  return /^[0-9a-f]{6}$/i.test(hex) ? hex : null;
};

/** WCAG 2 relative luminance for an sRGB hex colour. */
export const relativeLuminance = (background: string): number => {
  const hex = expandHex(background);

  if (!hex) return 0;

  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;

    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
};

/** WCAG contrast ratio between two sRGB hex colours. */
export const contrastRatio = (left: string, right: string): number => {
  const first = relativeLuminance(left);
  const second = relativeLuminance(right);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);

  return (lighter + 0.05) / (darker + 0.05);
};

/**
 * Pick accessible text for a brand background.
 *
 * White and near-black cover the design, but a mid-tone grey can leave both
 * just under 4.5:1. Pure black is the final candidate, and the chosen pair is
 * always the best of the three that meets WCAG AA. Near-black is preferred when
 * it passes so the product palette survives.
 */
export const buttonTextColor = (background: string): string => {
  const candidates = ["#ffffff", NEAR_BLACK, "#000000"] as const;
  const preferred = contrastRatio(background, NEAR_BLACK) >= 4.5 ? NEAR_BLACK : null;
  const white = contrastRatio(background, "#ffffff") >= 4.5 ? "#ffffff" : null;
  const black = contrastRatio(background, "#000000") >= 4.5 ? "#000000" : null;

  return (
    preferred ??
    white ??
    black ??
    candidates.reduce((best, candidate) =>
      contrastRatio(background, candidate) > contrastRatio(background, best) ? candidate : best,
    )
  );
};
