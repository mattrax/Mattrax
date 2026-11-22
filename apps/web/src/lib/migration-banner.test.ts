import { describe, expect, test } from "vitest";
import {
  migrationBannerDismissKey,
  readMigrationBannerDismissed,
  shouldShowMigrationBanner,
  writeMigrationBannerDismissed,
} from "./migration-banner";
import type { MigrationBannerStorage } from "./migration-banner";

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  } satisfies MigrationBannerStorage;
};

describe("migration banner", () => {
  test("only shows for a readable tenant with no devices", () => {
    expect(shouldShowMigrationBanner({ deviceCount: 0, canRead: true, dismissed: false })).toBe(
      true,
    );
    expect(shouldShowMigrationBanner({ deviceCount: 1, canRead: true, dismissed: false })).toBe(
      false,
    );
    expect(
      shouldShowMigrationBanner({ deviceCount: undefined, canRead: true, dismissed: false }),
    ).toBe(false);
    expect(shouldShowMigrationBanner({ deviceCount: 0, canRead: false, dismissed: false })).toBe(
      false,
    );
  });

  test("dismissal is scoped to the tenant and survives the session", () => {
    const storage = memoryStorage();

    expect(readMigrationBannerDismissed(storage, "tenant-a")).toBe(false);
    writeMigrationBannerDismissed(storage, "tenant-a");
    expect(storage.getItem(migrationBannerDismissKey("tenant-a"))).toBe("1");
    expect(readMigrationBannerDismissed(storage, "tenant-a")).toBe(true);
    expect(readMigrationBannerDismissed(storage, "tenant-b")).toBe(false);
    expect(shouldShowMigrationBanner({ deviceCount: 0, canRead: true, dismissed: true })).toBe(
      false,
    );
  });

  test("unavailable storage leaves the banner visible", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } satisfies MigrationBannerStorage;

    expect(readMigrationBannerDismissed(blocked, "tenant-a")).toBe(false);
    expect(() => writeMigrationBannerDismissed(blocked, "tenant-a")).not.toThrow();
  });
});
