/**
 * Dismissal for the "bring your fleet over" nudge shown on an empty tenant.
 *
 * Unlike the MIA banner, this is a one-time onboarding prompt: once a person
 * dismisses it, it stays dismissed in this browser. It is tenant-scoped so a
 * second tenant can still surface the option.
 */

export interface MigrationBannerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const migrationBannerDismissKey = (tenantId: string): string =>
  `mattrax:migration-banner-dismissed:${tenantId}`;

export const readMigrationBannerDismissed = (
  storage: MigrationBannerStorage | undefined,
  tenantId: string,
): boolean => {
  try {
    return storage?.getItem(migrationBannerDismissKey(tenantId)) === "1";
  } catch {
    return false;
  }
};

export const writeMigrationBannerDismissed = (
  storage: MigrationBannerStorage | undefined,
  tenantId: string,
): void => {
  try {
    storage?.setItem(migrationBannerDismissKey(tenantId), "1");
  } catch {
    // Storage policy; the banner simply returns on the next visit.
  }
};

export const shouldShowMigrationBanner = (input: {
  readonly deviceCount: number | undefined;
  readonly canRead: boolean;
  readonly dismissed: boolean;
}): boolean => input.canRead && !input.dismissed && input.deviceCount === 0;
