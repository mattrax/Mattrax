/**
 * Shared copy for plan/seat limits. Kept out of the components so the wording
 * can be tested without a DOM.
 */

export const PLAN_LIMIT_REACHED_TITLE = "Plan limit reached";

export const PLAN_LIMIT_REACHED_BODY =
  "This tenant is over its plan limit, so new devices or tenants cannot be added until you upgrade or remove usage. Existing devices remain manageable.";

export const DEVICE_LIMIT_REACHED_TITLE = "Device limit reached";

export const formatPlanLimit = (limit: number | null | undefined): string =>
  limit === null || limit === undefined ? "Unlimited" : String(limit);

export const formatPlanUsage = (
  used: number | null | undefined,
  limit: number | null | undefined,
): string => `${used ?? 0} / ${formatPlanLimit(limit)}`;

export const deviceLimitReachedMessage = (limit: number | null | undefined): string =>
  `This plan allows ${limit ?? 0} device${limit === 1 ? "" : "s"}. Contact your administrator to upgrade before enrolling another device.`;

export const UNLIMITED_PLAN_NOTICE =
  "This deployment has no plan catalogue configured, so device and tenant usage is unlimited.";
