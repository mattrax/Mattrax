import type { Permission } from "@mattrax/enterprise-domain/client";

export const ONBOARDING_WRITE_PERMISSIONS: ReadonlyArray<Permission> = [
  "groups.write",
  "policies.write",
  "enrollment.write",
  "members.write",
];

export const ONBOARDING_STALE_MILLIS = 30_000;

export const onboardingQueryEnabled = (
  permissionsKnown: boolean,
  canWrite: boolean,
  dismissed: boolean,
): boolean => permissionsKnown && canWrite && !dismissed;

type OnboardingDismissalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const dismissalKey = (userId: string | undefined, tenantId: string): string | undefined => {
  if (!userId || !tenantId) return undefined;

  return `mattrax:onboarding-dismissed:v1:${encodeURIComponent(userId)}:${encodeURIComponent(tenantId)}`;
};

/** A negative cache for reloads; the member row remains the source of truth. */
export const readOnboardingDismissal = (
  storage: OnboardingDismissalStorage | undefined,
  userId: string | undefined,
  tenantId: string,
): boolean => {
  const key = dismissalKey(userId, tenantId);

  if (!storage || !key) return false;

  try {
    return storage.getItem(key) === "1";
  } catch {
    return false;
  }
};

export const writeOnboardingDismissal = (
  storage: OnboardingDismissalStorage | undefined,
  userId: string | undefined,
  tenantId: string,
  dismissed: boolean,
): void => {
  const key = dismissalKey(userId, tenantId);

  if (!storage || !key) return;

  try {
    if (dismissed) storage.setItem(key, "1");
    else storage.removeItem(key);
  } catch {
    // Private mode or a full quota only costs the reload optimisation.
  }
};
