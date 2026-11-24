import { describe, expect, it } from "vitest";
import {
  accessibleBrandForeground,
  enrollmentLinkProblemCopy,
  enrollmentPlatformAvailable,
  enrollmentPlatformLabel,
  enrollmentPlatformUnavailableCopy,
  formatEnrollmentDate,
} from "./enrollment-presentation";

describe("enrollment link states", () => {
  it("gives expired and invalid links a clear next step", () => {
    expect(enrollmentLinkProblemCopy("expired")).toMatchObject({
      title: "Ask your administrator for a new link",
      action: "contact",
      tone: "warning",
    });
    expect(enrollmentLinkProblemCopy("invalid")).toMatchObject({
      description: "This enrollment link is no longer valid.",
      action: "contact",
    });
    expect(enrollmentLinkProblemCopy("invalid").message).toContain("reset or replaced");
  });

  it("offers a reload, not a new link, for a temporary outage", () => {
    expect(enrollmentLinkProblemCopy("unavailable")).toMatchObject({
      title: "Try again in a moment",
      action: "reload",
      actionLabel: "Reload page",
      tone: "warning",
    });
  });
});

describe("enrollment platform readiness", () => {
  it("recognises each usable enrollment payload", () => {
    expect(enrollmentPlatformAvailable("apple", { profile: "plist" })).toBe(true);
    expect(
      enrollmentPlatformAvailable("windows", { discoveryUrl: "https://mdm.test/windows" }),
    ).toBe(true);
    expect(
      enrollmentPlatformAvailable("android", {
        enrollmentToken: "token",
        provisioningMode: "work-profile",
      }),
    ).toBe(true);
  });

  it("does not treat an error or placeholder as ready", () => {
    expect(enrollmentPlatformAvailable("apple", { error: "disabled" })).toBe(false);
    expect(enrollmentPlatformAvailable("apple", "available")).toBe(false);
    expect(enrollmentPlatformAvailable("windows", "unavailable")).toBe(false);
    expect(enrollmentPlatformAvailable("android", "unavailable")).toBe(false);
  });

  it("explains disabled and unconfigured platforms without raw backend punctuation", () => {
    expect(
      enrollmentPlatformUnavailableCopy("apple", {
        error: "Apple enrollment is disabled! Contact your administrator.",
      }),
    ).toEqual({
      title: "Apple enrollment is turned off",
      message:
        "Apple enrollment is disabled. Ask your administrator to turn it on, then reload this page.",
      tone: "warning",
    });
    expect(
      enrollmentPlatformUnavailableCopy("android", {
        error: "Android Enterprise is not configured! Contact your administrator.",
      }),
    ).toMatchObject({
      title: "Android enrollment isn't set up yet",
      message: expect.stringContaining("Android Enterprise is not configured"),
    });
  });

  it("handles temporary failures, missing connections and device limits", () => {
    expect(
      enrollmentPlatformUnavailableCopy("windows", {
        error: "Windows enrollment is temporarily unavailable! Contact your administrator.",
      }),
    ).toMatchObject({ title: "Windows is temporarily unavailable", tone: "danger" });
    expect(
      enrollmentPlatformUnavailableCopy("android", {
        error: "Android Enterprise is not connected! Contact your administrator.",
      }),
    ).toMatchObject({ title: "Android enrollment isn't connected yet" });
    expect(
      enrollmentPlatformUnavailableCopy("apple", { error: "The device limit has been reached" }),
    ).toMatchObject({ title: "This organization can't enroll another device" });
    expect(enrollmentPlatformUnavailableCopy("android", "unavailable")).toMatchObject({
      title: "Android enrollment isn't connected yet",
    });
  });

  it("labels every platform", () => {
    expect(enrollmentPlatformLabel("apple")).toBe("Apple");
    expect(enrollmentPlatformLabel("windows")).toBe("Windows");
    expect(enrollmentPlatformLabel("android")).toBe("Android");
  });
});

describe("enrollment branding and dates", () => {
  it("chooses a readable foreground for light and dark brand colours", () => {
    expect(accessibleBrandForeground("#1c1917")).toBe("#ffffff");
    expect(accessibleBrandForeground("#2563eb")).toBe("#ffffff");
    expect(accessibleBrandForeground("#facc15")).toBe("#111111");
    expect(accessibleBrandForeground("#fff")).toBe("#111111");
    expect(accessibleBrandForeground("not-a-colour")).toBe("#ffffff");
  });

  it("formats expiry dates consistently for SSR and hydration", () => {
    expect(formatEnrollmentDate("2026-12-01T10:30:00.000Z")).toContain("UTC");
    expect(formatEnrollmentDate("2026-12-01T10:30:00.000Z")).toContain("Dec 1, 2026");
    expect(formatEnrollmentDate(undefined)).toBeUndefined();
    expect(formatEnrollmentDate("invalid")).toBeUndefined();
  });
});
