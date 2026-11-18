import { describe, expect, it } from "vitest";
import {
  APPLICATION_INVENTORY_STALE_MS,
  applicationsInventoryStale,
  normalizeReportedName,
  shouldApplyReportedName,
  windowsActivationStatusFromLicenseStatus,
  windowsLicenseStatusValue,
} from "./deviceInventory.ts";

describe("shouldApplyReportedName", () => {
  it("fills a name the server never had", () => {
    expect(shouldApplyReportedName({ currentName: "", reportedName: "Oscar's MacBook" })).toBe(
      true,
    );
    expect(shouldApplyReportedName({ currentName: null, reportedName: " Oscar's MacBook " })).toBe(
      true,
    );
  });

  it("never replaces an administrator-chosen name", () => {
    expect(
      shouldApplyReportedName({
        currentName: "Design - Sarah",
        reportedName: "Sarahs-MacBook-Pro",
        placeholders: ["C02X1234", "MacBookPro18,1", "udid-1"],
      }),
    ).toBe(false);
  });

  it("replaces the enrolment placeholder once the device reports its name", () => {
    expect(
      shouldApplyReportedName({
        currentName: "C02X1234",
        reportedName: "Sarahs-MacBook-Pro",
        placeholders: ["C02X1234", "MacBookPro18,1", "udid-1"],
      }),
    ).toBe(true);
  });

  it("follows an OS-level rename while the management name is still the reported one", () => {
    expect(
      shouldApplyReportedName({
        currentName: "DESKTOP-OLD",
        reportedName: "DESKTOP-NEW",
        placeholders: ["DESKTOP-OLD"],
      }),
    ).toBe(true);
  });

  it("ignores a blank report and a report equal to the current name", () => {
    expect(shouldApplyReportedName({ currentName: "Mac", reportedName: "  " })).toBe(false);
    expect(shouldApplyReportedName({ currentName: "Mac", reportedName: "Mac" })).toBe(false);
  });
});

describe("normalizeReportedName", () => {
  it("collapses whitespace and treats blanks as absent", () => {
    expect(normalizeReportedName("  Oscar's   MacBook  ")).toBe("Oscar's MacBook");
    expect(normalizeReportedName("   ")).toBeUndefined();
    expect(normalizeReportedName(null)).toBeUndefined();
  });
});

describe("windowsActivationStatusFromLicenseStatus", () => {
  it("treats only Licensed as activated", () => {
    expect(windowsActivationStatusFromLicenseStatus(1)).toBe("activated");
  });

  it("groups every unlicensed, grace and notification state as not activated", () => {
    for (const raw of [0, 2, 3, 4, 5, 6])
      expect(windowsActivationStatusFromLicenseStatus(raw)).toBe("not-activated");
  });

  it("never guesses when the value is missing or out of range", () => {
    for (const raw of [undefined, null, 7, -1, 1.5, Number.NaN])
      expect(windowsActivationStatusFromLicenseStatus(raw)).toBe("unknown");
  });
});

describe("windowsLicenseStatusValue", () => {
  it("keeps only the documented integer 0-6 range", () => {
    for (const raw of [0, 1, 2, 3, 4, 5, 6]) expect(windowsLicenseStatusValue(raw)).toBe(raw);
  });

  it("drops fractional, negative, huge and missing values", () => {
    for (const raw of [undefined, null, 1.5, -1, 7, 1e20, Number.NaN, Number.POSITIVE_INFINITY])
      expect(windowsLicenseStatusValue(raw)).toBeNull();
  });
});

describe("applicationsInventoryStale", () => {
  const now = new Date("2026-11-16T12:00:00Z");

  it("treats a missing or unparseable report as stale", () => {
    expect(applicationsInventoryStale({ updatedAt: null, now })).toBe(true);
    expect(applicationsInventoryStale({ updatedAt: "not-a-date", now })).toBe(true);
  });

  it("is fresh inside the refresh cadence and stale after it", () => {
    expect(
      applicationsInventoryStale({
        updatedAt: new Date(now.getTime() - APPLICATION_INVENTORY_STALE_MS + 60_000),
        now,
      }),
    ).toBe(false);

    expect(
      applicationsInventoryStale({
        updatedAt: new Date(now.getTime() - APPLICATION_INVENTORY_STALE_MS - 60_000),
        now,
      }),
    ).toBe(true);

    expect(applicationsInventoryStale({ updatedAt: "2026-11-05T12:00:00.000Z", now })).toBe(true);
    expect(applicationsInventoryStale({ updatedAt: "2026-11-10T12:00:00.000Z", now })).toBe(false);
  });
});
