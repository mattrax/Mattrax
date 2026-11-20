import { describe, expect, it } from "vitest";
import {
  appleScheduleOsUpdatePayload,
  androidSystemUpdatePolicy,
  completeOsPolicy,
  countOsCompliance,
  deriveOsCompliance,
  normalizeMinimumVersion,
  osPolicyDeferralEndsAt,
  windowsOsUpdatePolicyNodes,
  type MacOsUpdateCatalog,
  type OsPolicyRule,
} from "./index.js";

const now = new Date("2026-11-20T12:00:00.000Z");

const release = (version: string) => ({
  version,
  releaseDate: null,
  securityInfoUrl: null,
  activelyExploited: false,
});

const catalog: MacOsUpdateCatalog = {
  updateHash: null,
  majors: [
    {
      major: 15,
      label: "macOS 15",
      latest: release("15.1"),
      releases: [release("15.1"), release("15.0")],
    },
    {
      major: 14,
      label: "macOS 14",
      latest: release("14.7"),
      releases: [release("14.7"), release("14.6")],
    },
    {
      major: 13,
      label: "macOS 13",
      latest: release("13.7"),
      releases: [release("13.7")],
    },
  ],
};

const rule = (input: Partial<OsPolicyRule> & Pick<OsPolicyRule, "platform">): OsPolicyRule => ({
  minimumVersion: null,
  enforcement: "warn",
  deferralDays: 0,
  updatedAt: new Date("2026-11-01T00:00:00.000Z"),
  ...input,
});

const mac = (osVersion: string) => ({
  proto: "apple",
  osVersion,
  osEdition: "macOS",
  model: "Mac14,2",
});

describe("normalizeMinimumVersion", () => {
  it("accepts dotted versions and platform labels", () => {
    expect(normalizeMinimumVersion("14.6")).toBe("14.6");
    expect(normalizeMinimumVersion("  macOS 14.6 ")).toBe("14.6");
    expect(normalizeMinimumVersion("Windows 10.0.22631")).toBe("10.0.22631");
    expect(normalizeMinimumVersion("Android 14")).toBe("14");
  });

  it("rejects marketing names and partial input", () => {
    expect(normalizeMinimumVersion("Sonoma")).toBeNull();
    expect(normalizeMinimumVersion("15.0 Beta")).toBeNull();
    expect(normalizeMinimumVersion("")).toBeNull();
    expect(normalizeMinimumVersion("0.1")).toBeNull();
  });
});

describe("deriveOsCompliance", () => {
  it("reports a macOS device on the newest release as compliant", () => {
    const info = deriveOsCompliance(
      mac("15.1"),
      [rule({ platform: "macos", minimumVersion: "15.0", enforcement: "warn" })],
      catalog,
      { now },
    );

    expect(info.status).toBe("compliant");
    expect(info.reason).toBe("up_to_date");
    expect(info.updateKnowledge).toBe("known");
    expect(info.minimumVersion).toBe("15.0");
  });

  it("reports a macOS security release as an update", () => {
    const info = deriveOsCompliance(
      mac("15.0"),
      [rule({ platform: "macos", minimumVersion: "15.0" })],
      catalog,
      { now },
    );

    expect(info.status).toBe("update-available");
    expect(info.reason).toBe("update_available");
    expect(info.targetVersion).toBe("15.1");
  });

  it("reports below-minimum before looking at the feed", () => {
    const info = deriveOsCompliance(
      mac("14.6"),
      [rule({ platform: "macos", minimumVersion: "15.0", enforcement: "enforce" })],
      catalog,
      { now },
    );

    expect(info.status).toBe("below-minimum");
    expect(info.reason).toBe("below_minimum");
    expect(info.enforced).toBe(true);
    expect(info.targetVersion).toBe("15.0");
  });

  it("treats an active deferral as update-available, not compliant", () => {
    const policy = rule({
      platform: "macos",
      minimumVersion: "15.0",
      enforcement: "enforce",
      deferralDays: 7,
      updatedAt: new Date("2026-11-15T12:00:00.000Z"),
    });

    const during = deriveOsCompliance(mac("14.6"), [policy], catalog, { now });

    expect(during.status).toBe("update-available");
    expect(during.reason).toBe("deferral_active");
    expect(during.enforced).toBe(false);
    expect(during.deferralEndsAt).toBe("2026-11-22T12:00:00.000Z");
  });

  it("ends the deferral exactly at the deadline", () => {
    const policy = rule({
      platform: "macos",
      minimumVersion: "15.0",
      enforcement: "enforce",
      deferralDays: 7,
      updatedAt: new Date("2026-11-01T00:00:00.000Z"),
    });

    expect(osPolicyDeferralEndsAt(policy)?.toISOString()).toBe("2026-11-08T00:00:00.000Z");

    const before = deriveOsCompliance(mac("14.6"), [policy], catalog, {
      now: new Date("2026-11-07T23:59:59.999Z"),
    });

    const at = deriveOsCompliance(mac("14.6"), [policy], catalog, {
      now: new Date("2026-11-08T00:00:00.000Z"),
    });

    expect(before.reason).toBe("deferral_active");
    expect(at.reason).toBe("below_minimum");
  });

  it("never treats an unknown version as compliant", () => {
    const rules = [rule({ platform: "macos", minimumVersion: "14.0" })];

    expect(
      deriveOsCompliance({ proto: "apple", osEdition: "macOS" }, rules, catalog, { now }),
    ).toMatchObject({
      status: "unknown",
      reason: "version_unknown",
      updateKnowledge: "unknown",
    });

    expect(deriveOsCompliance(mac("Sonoma"), rules, catalog, { now })).toMatchObject({
      status: "unknown",
      reason: "version_unknown",
    });
  });

  it("keeps macOS unknown when the feed is unavailable, even above the minimum", () => {
    const info = deriveOsCompliance(
      mac("14.6"),
      [rule({ platform: "macos", minimumVersion: "14.0" })],
      null,
      { now },
    );

    expect(info.status).toBe("unknown");
    expect(info.reason).toBe("feed_unavailable");
  });

  it("does not apply a macOS minimum to iOS", () => {
    const info = deriveOsCompliance(
      { proto: "apple", osEdition: "iOS", osVersion: "18.1", model: "iPhone15,2" },
      [rule({ platform: "macos", minimumVersion: "99.0", enforcement: "enforce" })],
      catalog,
      { now },
    );

    expect(info.status).toBe("unknown");
    expect(info.reason).toBe("platform_not_covered");
    expect(info.minimumVersion).toBeNull();
  });

  it("compares Windows only against the configured minimum", () => {
    const rules = [rule({ platform: "windows", minimumVersion: "10.0.22631" })];
    const device = { proto: "win", osVersion: "10.0.22631.4460" };

    const compliant = deriveOsCompliance(device, rules, catalog, { now });

    expect(compliant).toMatchObject({
      status: "compliant",
      reason: "up_to_date_minimum_only",
      updateKnowledge: "unknown",
    });

    expect(
      deriveOsCompliance({ proto: "win", osVersion: "10.0.19045" }, rules, catalog, { now }),
    ).toMatchObject({ status: "below-minimum", reason: "below_minimum" });
  });

  it("has nothing to report for Windows without a minimum", () => {
    expect(
      deriveOsCompliance({ proto: "win", osVersion: "10.0.22631" }, [], catalog, { now }),
    ).toMatchObject({ status: "unknown", reason: "policy_not_configured" });

    expect(
      deriveOsCompliance(
        { proto: "win", osVersion: "10.0.22631" },
        [rule({ platform: "windows", minimumVersion: "10.0.22631", enforcement: "off" })],
        catalog,
        { now },
      ),
    ).toMatchObject({ status: "unknown", reason: "policy_off" });
  });

  it("compares Android against its own minimum", () => {
    const rules = [rule({ platform: "android", minimumVersion: "15" })];

    expect(
      deriveOsCompliance({ proto: "android", osVersion: "14" }, rules, catalog, { now }),
    ).toMatchObject({
      status: "below-minimum",
    });

    expect(
      deriveOsCompliance({ proto: "android", osVersion: "15" }, rules, catalog, { now }),
    ).toMatchObject({
      status: "compliant",
      reason: "up_to_date_minimum_only",
    });
  });
});

describe("countOsCompliance", () => {
  it("weights every status and counts enforced non-compliance", () => {
    const rules = [
      rule({ platform: "macos", minimumVersion: "15.0", enforcement: "enforce" }),
      rule({ platform: "windows", minimumVersion: "10.0.22631" }),
    ];

    const counts = countOsCompliance([
      deriveOsCompliance(mac("15.1"), rules, catalog, { now }),
      deriveOsCompliance(mac("14.6"), rules, catalog, { now }),
      deriveOsCompliance({ proto: "win", osVersion: "10.0.19045" }, rules, catalog, { now }),
      deriveOsCompliance({ proto: "win", osVersion: "10.0.22631" }, rules, catalog, { now }),
      deriveOsCompliance({ proto: "android", osVersion: "14" }, rules, catalog, { now }),
      deriveOsCompliance({ proto: "apple", osEdition: "iOS", osVersion: "18" }, rules, catalog, {
        now,
      }),
    ]);

    expect(counts).toEqual({
      total: 6,
      compliant: 2,
      updateAvailable: 0,
      belowMinimum: 2,
      deferred: 0,
      unknown: 2,
      enforcedBelowMinimum: 1,
    });
  });
});

describe("policy remediation payloads", () => {
  it("generates a Windows update ring only when enforcing", () => {
    expect(windowsOsUpdatePolicyNodes(rule({ platform: "windows", enforcement: "warn" }))).toEqual(
      [],
    );

    const nodes = windowsOsUpdatePolicyNodes(
      rule({
        platform: "windows",
        enforcement: "enforce",
        minimumVersion: "10.0.22631",
        deferralDays: 10,
      }),
    );

    expect(nodes.map((node) => node.omaUri)).toEqual([
      "./Device/Vendor/MSFT/Policy/Config/Update/AllowAutoUpdate",
      "./Device/Vendor/MSFT/Policy/Config/Update/DeferQualityUpdatesPeriodInDays",
      "./Device/Vendor/MSFT/Policy/Config/Update/DeferFeatureUpdatesPeriodInDays",
      "./Device/Vendor/MSFT/Policy/Config/Update/ConfigureDeadlineForQualityUpdates",
      "./Device/Vendor/MSFT/Policy/Config/Update/ConfigureDeadlineGracePeriod",
    ]);
    expect(nodes.some((node) => node.omaUri.includes("TargetReleaseVersion"))).toBe(false);
  });

  it("only sets the Android system update policy when enforcing", () => {
    expect(
      androidSystemUpdatePolicy(rule({ platform: "android", enforcement: "warn" })),
    ).toBeNull();

    expect(
      androidSystemUpdatePolicy(rule({ platform: "android", enforcement: "enforce" })),
    ).toEqual({ type: "AUTO" });
  });

  it("builds an Apple ScheduleOSUpdate payload with a bounded deferral count", () => {
    expect(appleScheduleOsUpdatePayload({ installAction: "InstallASAP", now })).toEqual({
      Updates: [{ InstallAction: "InstallASAP" }],
    });

    expect(
      appleScheduleOsUpdatePayload({
        installAction: "InstallLater",
        deadline: new Date("2026-11-25T12:00:00.000Z"),
        now,
      }),
    ).toEqual({ Updates: [{ InstallAction: "InstallLater", MaxUserDeferrals: 5 }] });

    expect(
      appleScheduleOsUpdatePayload({
        installAction: "InstallLater",
        productKey: " 041-00000 ",
        now,
      }),
    ).toEqual({
      Updates: [{ InstallAction: "InstallLater", ProductKey: "041-00000" }],
    });
  });
});

describe("completeOsPolicy", () => {
  it("fills every platform with an inert default", () => {
    const completed = completeOsPolicy([rule({ platform: "macos", minimumVersion: "14.6" })]);

    expect(completed.map((entry) => entry.platform)).toEqual(["macos", "windows", "android"]);
    expect(completed[1]?.enforcement).toBe("off");
    expect(completed[2]?.minimumVersion).toBeNull();
  });
});
