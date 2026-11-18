/**
 * Ordering for the derived device-health rollup.
 *
 * The backend computes health per device (it is not a stored column), so the
 * list's `health` sort is a server sort. These ranks keep the table's header
 * arrow and any client-side use consistent with the API: ascending lists the
 * worst devices first, which is the same order the "needs attention" filter and
 * the fleet summary use.
 */
export const HEALTH_LEVELS = ["critical", "missing", "attention", "unknown", "healthy"] as const;

export type HealthLevel = (typeof HEALTH_LEVELS)[number];

const RANK: Record<HealthLevel, number> = {
  critical: 0,
  missing: 1,
  attention: 2,
  unknown: 3,
  healthy: 4,
};

/** Unknown levels sort with `unknown` rather than above `healthy`. */
export const healthRank = (level: string | undefined | null): number =>
  level === "critical" ||
  level === "missing" ||
  level === "attention" ||
  level === "unknown" ||
  level === "healthy"
    ? RANK[level]
    : RANK.unknown;

/** The label the API/table uses, for a client-side fallback. */
export const healthLabel = (level: string | undefined | null): string => {
  switch (level) {
    case "critical":
      return "Critical";
    case "missing":
      return "MIA";
    case "attention":
      return "Attention";
    case "healthy":
      return "Healthy";
    default:
      return "Unknown";
  }
};

/**
 * How many MIA devices a proactive banner should report.
 *
 * The API counts enrolled devices past the 14-day MIA threshold in
 * `counts.missing`; an absent rollup (still loading, or no permission) is zero.
 */
export const missingDeviceCount = (
  counts: { readonly missing?: number } | null | undefined,
): number => {
  const count = counts?.missing ?? 0;

  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
};
