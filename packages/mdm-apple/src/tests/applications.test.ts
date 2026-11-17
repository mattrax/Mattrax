import { describe, expect, it } from "vitest";
import { parseInstalledApplications } from "@mattrax/mdm-core";

describe("parseInstalledApplications", () => {
  it("normalises the standard response fields", () => {
    expect(
      parseInstalledApplications({
        InstalledApplicationList: [
          {
            Identifier: "com.apple.Safari",
            Name: "Safari",
            Version: "18.1",
            ShortVersion: "18.1",
            BundleSize: 1200,
            DynamicSize: 900,
            HasUpdateAvailable: true,
            IsManaged: true,
          },
          {
            Identifier: "com.example.Slack",
            Name: "Slack",
            Version: "4.40.0",
            ShortVersion: "4.40",
            BundleSize: "9999999999",
            DynamicSize: "5000000000",
            HasUpdateAvailable: "false",
          },
        ],
      }),
    ).toEqual([
      {
        bundleId: "com.apple.Safari",
        name: "Safari",
        version: "18.1",
        shortVersion: "18.1",
        bundleSize: 1200,
        dynamicSize: 900,
        hasUpdateAvailable: true,
        isManaged: true,
      },
      {
        bundleId: "com.example.Slack",
        name: "Slack",
        version: "4.40.0",
        shortVersion: "4.40",
        bundleSize: 9999999999,
        dynamicSize: 5000000000,
        hasUpdateAvailable: false,
        isManaged: false,
      },
    ]);
  });

  it("de-duplicates by bundle identifier and skips unaddressable entries", () => {
    expect(
      parseInstalledApplications({
        InstalledApplicationList: [
          { Identifier: "com.example.App", Name: "Old", Version: "1" },
          { Identifier: "com.example.App", Name: "New", Version: "2", ManagementFlags: 1 },
          { Name: "No identifier", Version: "1" },
        ],
      }),
    ).toEqual([
      {
        bundleId: "com.example.App",
        name: "New",
        version: "2",
        hasUpdateAvailable: false,
        isManaged: true,
      },
    ]);
  });

  it("distinguishes a missing report from an empty inventory", () => {
    expect(parseInstalledApplications(undefined)).toBeUndefined();
    expect(parseInstalledApplications({ SecurityInfo: { FDE_Enabled: true } })).toBeUndefined();
    expect(parseInstalledApplications({ InstalledApplicationList: [] })).toEqual([]);
  });
});
