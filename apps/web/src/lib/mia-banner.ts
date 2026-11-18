/**
 * Pure decisions behind the overview MIA banner.
 *
 * Kept out of the component so zero counts, permissions, dismissal persistence
 * and the link target can be unit tested without a browser. The banner is
 * deliberately per-session: replacing a lost device does not need a warning on
 * every navigation in the same tab.
 */

/** The minimal storage surface used here; `Storage` and test doubles both fit. */
export interface MiaBannerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const miaBannerDismissKey = (tenantId: string): string =>
  `mattrax:mia-banner-dismissed:${tenantId}`;

export const readMiaBannerDismissed = (
  storage: MiaBannerStorage | undefined,
  tenantId: string,
): boolean => {
  try {
    return storage?.getItem(miaBannerDismissKey(tenantId)) === "1";
  } catch {
    // Browser policy can disable storage; the banner stays visible.
    return false;
  }
};

export const writeMiaBannerDismissed = (
  storage: MiaBannerStorage | undefined,
  tenantId: string,
): void => {
  try {
    storage?.setItem(miaBannerDismissKey(tenantId), "1");
  } catch {
    // Same storage policy as the read above.
  }
};

export const shouldShowMiaBanner = (input: {
  readonly count: number;
  readonly canRead: boolean;
  readonly dismissed: boolean;
}): boolean => input.canRead && !input.dismissed && input.count > 0;
