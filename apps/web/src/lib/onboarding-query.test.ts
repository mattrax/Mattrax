import type { TenantOnboardingState } from "@mattrax/enterprise-domain/client";
import { describe, expect, it, vi } from "vitest";
import {
  ONBOARDING_STALE_MILLIS,
  ONBOARDING_WRITE_PERMISSIONS,
  onboardingIsDismissed,
  onboardingQueryEnabled,
  readOnboardingDismissal,
  writeOnboardingDismissal,
} from "./onboarding-query";

describe("onboarding query access", () => {
  it("fails closed until membership permissions are known", () => {
    expect(onboardingQueryEnabled(false, true, false)).toBe(false);
  });

  it("does not fetch aggregate counts for a read-only member", () => {
    expect(onboardingQueryEnabled(true, false, false)).toBe(false);
  });

  it("does not refetch a checklist already known to be dismissed", () => {
    expect(onboardingQueryEnabled(true, true, true)).toBe(false);
  });

  it("re-enables when authoritative cache data replaces a failed optimistic dismissal", () => {
    let cache: Pick<TenantOnboardingState, "dismissedAt"> = {
      dismissedAt: "2026-11-24T12:00:00.000Z",
    };

    expect(onboardingQueryEnabled(true, true, onboardingIsDismissed(cache))).toBe(false);

    cache = { dismissedAt: null };

    expect(onboardingQueryEnabled(true, true, onboardingIsDismissed(cache))).toBe(true);
  });

  it("fetches once for an eligible member with no dismissal", () => {
    expect(onboardingQueryEnabled(true, true, false)).toBe(true);
    expect(ONBOARDING_WRITE_PERMISSIONS).toEqual([
      "groups.write",
      "policies.write",
      "enrollment.write",
      "members.write",
    ]);
    expect(ONBOARDING_STALE_MILLIS).toBe(30_000);
  });
});

describe("onboarding dismissal reload cache", () => {
  const storage = () => {
    const values = new Map<string, string>();

    return {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    };
  };

  it("remembers dismissal across a reload without leaking across accounts or tenants", () => {
    const browser = storage();
    writeOnboardingDismissal(browser, "account-1", "tenant-1", true);

    expect(readOnboardingDismissal(browser, "account-1", "tenant-1")).toBe(true);
    expect(readOnboardingDismissal(browser, "account-2", "tenant-1")).toBe(false);
    expect(readOnboardingDismissal(browser, "account-1", "tenant-2")).toBe(false);
  });

  it("clears the negative cache when a dismissal is rolled back", () => {
    const browser = storage();
    writeOnboardingDismissal(browser, "account-1", "tenant-1", true);
    writeOnboardingDismissal(browser, "account-1", "tenant-1", false);

    expect(readOnboardingDismissal(browser, "account-1", "tenant-1")).toBe(false);
    expect(browser.removeItem).toHaveBeenCalledOnce();
  });

  it("fails open when browser storage is unavailable", () => {
    expect(readOnboardingDismissal(undefined, "account-1", "tenant-1")).toBe(false);
    expect(() => writeOnboardingDismissal(undefined, "account-1", "tenant-1", true)).not.toThrow();
  });
});
