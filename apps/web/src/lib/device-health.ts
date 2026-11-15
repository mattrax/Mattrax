/**
 * Ordering for the derived device-health rollup.
 *
 * The backend computes health per device (it is not a stored column), so the
 * list's `health` sort is a server sort. These ranks keep the table's header
 * arrow and any client-side use consistent with the API: ascending lists the
 * worst devices first, which is the same order the "needs attention" filter and
 * the fleet summary use.
 */
export const HEALTH_LEVELS = ["critical", "attention", "unknown", "healthy"] as const;

export type HealthLevel = (typeof HEALTH_LEVELS)[number];

const RANK: Record<HealthLevel, number> = {
  critical: 0,
  attention: 1,
  unknown: 2,
  healthy: 3,
};

/** Unknown levels sort with `unknown` rather than above `healthy`. */
export const healthRank = (level: string | undefined | null): number =>
  level === "critical" || level === "attention" || level === "unknown" || level === "healthy"
    ? RANK[level]
    : RANK.unknown;

/** The label the API/table uses, for a client-side fallback. */
export const healthLabel = (level: string | undefined | null): string => {
  switch (level) {
    case "critical":
      return "Critical";
    case "attention":
      return "Attention";
    case "healthy":
      return "Healthy";
    default:
      return "Unknown";
  }
};
