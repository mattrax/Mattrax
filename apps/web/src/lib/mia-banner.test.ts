import { describe, expect, test } from "vitest";
import {
  miaBannerDismissKey,
  readMiaBannerDismissed,
  shouldShowMiaBanner,
  writeMiaBannerDismissed,
} from "./mia-banner";
import type { MiaBannerStorage } from "./mia-banner";

const fakeStorage = (initial: Record<string, string> = {}): MiaBannerStorage => {
  const values = new Map(Object.entries(initial));

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

describe("MIA banner visibility", () => {
  test("hides at zero devices", () => {
    expect(shouldShowMiaBanner({ count: 0, canRead: true, dismissed: false })).toBe(false);
  });

  test("hides without device read permission", () => {
    expect(shouldShowMiaBanner({ count: 2, canRead: false, dismissed: false })).toBe(false);
  });

  test("shows when there are MIA devices, permission is present and it was not dismissed", () => {
    expect(shouldShowMiaBanner({ count: 2, canRead: true, dismissed: false })).toBe(true);
    expect(shouldShowMiaBanner({ count: 1, canRead: true, dismissed: false })).toBe(true);
  });

  test("stays hidden for the rest of the session once dismissed", () => {
    const storage = fakeStorage();

    expect(readMiaBannerDismissed(storage, "tenant-1")).toBe(false);
    writeMiaBannerDismissed(storage, "tenant-1");
    expect(readMiaBannerDismissed(storage, "tenant-1")).toBe(true);
    expect(shouldShowMiaBanner({ count: 3, canRead: true, dismissed: true })).toBe(false);
  });

  test("scopes the dismissal to the tenant", () => {
    const storage = fakeStorage();

    writeMiaBannerDismissed(storage, "tenant-1");

    expect(readMiaBannerDismissed(storage, "tenant-1")).toBe(true);
    expect(readMiaBannerDismissed(storage, "tenant-2")).toBe(false);
    expect(miaBannerDismissKey("tenant-1")).not.toBe(miaBannerDismissKey("tenant-2"));
  });

  test("treats unavailable storage as not dismissed and never throws", () => {
    const throwing: MiaBannerStorage = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
    };

    expect(readMiaBannerDismissed(undefined, "tenant-1")).toBe(false);
    expect(readMiaBannerDismissed(throwing, "tenant-1")).toBe(false);
    expect(() => writeMiaBannerDismissed(throwing, "tenant-1")).not.toThrow();
  });
});
