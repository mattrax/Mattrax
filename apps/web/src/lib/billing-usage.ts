export type BillingUsageState = "unlimited" | "over" | "full" | "near" | "healthy";

const NEAR_LIMIT_PERCENT = 80;

/** Usage state shared by the billing meters and their status labels. */
export const billingUsageState = (
  used: number,
  limit: number | null | undefined,
  overLimit = false,
): BillingUsageState => {
  if (limit === null || limit === undefined) return "unlimited";
  if (overLimit || used > limit) return "over";
  if (used === limit) return "full";
  if (limit > 0 && (used / limit) * 100 >= NEAR_LIMIT_PERCENT) return "near";
  return "healthy";
};

/** A meter never paints past its track, even when usage is over the limit. */
export const billingUsagePercent = (used: number, limit: number | null | undefined): number => {
  if (limit === null || limit === undefined || limit <= 0) return 0;

  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
};

export const billingUsageRemaining = (
  used: number,
  limit: number | null | undefined,
): number | null => {
  if (limit === null || limit === undefined) return null;

  return Math.max(0, limit - used);
};
