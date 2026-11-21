import type { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { compareVersionStrings } from "./deviceQuery.js";
import {
  countSoftwareUpdates,
  deriveSoftwareUpdate,
  macOsUpdateBaseline,
  parseSofaFeed,
  softwareUpdateReason,
} from "./softwareUpdates.js";
import type { MacOsUpdateCatalog } from "./softwareUpdates.js";

const release = (version: string, overrides: Record<string, Schema.Json> = {}) => ({
  ProductVersion: version,
  ReleaseDate: "2026-11-09T00:00:00Z",
  SecurityInfo: "https://support.apple.com/en-us/149718",
  ActivelyExploitedCVEs: [],
  ...overrides,
});

const feed = (overrides: Record<string, Schema.Json> = {}) => ({
  UpdateHash: "abc123",
  OSVersions: [
    {
      OSVersion: "Tahoe 26",
      Latest: release("26.7.3", { ActivelyExploitedCVEs: ["CVE-2026-1"] }),
      SecurityReleases: [release("26.7.2"), release("26.7.3")],
    },
    {
      OSVersion: "Sequoia 15",
      Latest: release("15.8.3"),
      SecurityReleases: [release("15.8.2"), release("15.8.1")],
    },
    {
      OSVersion: "Sonoma 14",
      Latest: release("14.8.9"),
      SecurityReleases: [release("14.8.8")],
    },
    {
      OSVersion: "Ventura 13",
      Latest: release("13.7.8"),
      SecurityReleases: [],
    },
  ],
  ...overrides,
});

const catalog = (): MacOsUpdateCatalog => {
  const parsed = parseSofaFeed(feed());

  if (!parsed) throw new Error("fixture did not parse");

  return parsed;
};

const status = (osVersion: string | null, parsed: MacOsUpdateCatalog | null = catalog()) =>
  deriveSoftwareUpdate(
    { proto: "apple", osEdition: "macOS", model: "MacBookPro18,3", osVersion },
    parsed,
    { supportedMajorCount: 3 },
  );

describe("SOFA feed parsing", () => {
  it("extracts the latest release and security releases per major", () => {
    const parsed = catalog();

    expect(parsed.updateHash).toBe("abc123");
    expect(parsed.majors.map((major) => major.major)).toEqual([26, 15, 14, 13]);
    expect(parsed.majors[0]?.label).toBe("Tahoe 26");
    expect(parsed.majors[0]?.latest.version).toBe("26.7.3");
    expect(parsed.majors[0]?.latest.securityInfoUrl).toBe("https://support.apple.com/en-us/149718");
    expect(parsed.majors[0]?.latest.activelyExploited).toBe(true);
    expect(parsed.majors[0]?.releases.map((entry) => entry.version)).toEqual(["26.7.3", "26.7.2"]);
  });

  it("picks the highest version when Latest and SecurityReleases disagree", () => {
    const parsed = parseSofaFeed(
      feed({
        OSVersions: [
          {
            OSVersion: "Sequoia 15",
            Latest: release("15.8.1"),
            SecurityReleases: [release("15.8.3")],
          },
        ],
      }),
    );

    expect(parsed?.majors[0]?.latest.version).toBe("15.8.3");
  });

  it("skips malformed releases without discarding the rest of the feed", () => {
    const parsed = parseSofaFeed(
      feed({
        OSVersions: [
          {
            OSVersion: "Sequoia 15",
            Latest: { ProductVersion: 15 },
            SecurityReleases: [
              { ProductVersion: "", ReleaseDate: "not-a-date" },
              { ProductVersion: "not-a-version" },
              release("15.8.9", { SecurityInfo: "javascript:alert(1)" }),
            ],
          },
          { OSVersion: "Sonoma 14", Latest: release("14.8.9"), SecurityReleases: "nope" },
        ],
      }),
    );

    expect(parsed?.majors.map((major) => major.major)).toEqual([15, 14]);
    const sequoia = parsed?.majors.find((major) => major.major === 15);

    expect(sequoia?.latest.version).toBe("15.8.9");
    expect(sequoia?.latest.releaseDate).toBe("2026-11-09T00:00:00Z");
    expect(sequoia?.latest.securityInfoUrl).toBeNull();
  });

  it("falls back to a generated label when OSVersion is missing", () => {
    const parsed = parseSofaFeed(
      feed({
        OSVersions: [{ Latest: release("15.8.3"), SecurityReleases: [] }],
      }),
    );

    expect(parsed?.majors[0]?.label).toBe("macOS 15");
  });

  it("returns null for malformed or empty payloads", () => {
    expect(parseSofaFeed(null)).toBeNull();
    expect(parseSofaFeed("not-json")).toBeNull();
    expect(parseSofaFeed({})).toBeNull();
    expect(parseSofaFeed({ OSVersions: "nope" })).toBeNull();
    expect(parseSofaFeed({ OSVersions: [] })).toBeNull();
    expect(
      parseSofaFeed({
        OSVersions: [{ OSVersion: "Sequoia 15", Latest: { ProductVersion: "oops" } }],
      }),
    ).toBeNull();
  });
});

describe("macOS update status", () => {
  it("reports the newest release as up to date", () => {
    const info = status("26.7.3");

    expect(info.status).toBe("up_to_date");
    expect(info.code).toBe("up_to_date");
    expect(info.latestVersion).toBe("26.7.3");
  });

  it("requires a security update when the major release is behind", () => {
    const info = status("26.7.1");

    expect(info.status).toBe("security_update_required");
    expect(info.code).toBe("security_release_missing");
    expect(info.latestVersion).toBe("26.7.3");
    expect(softwareUpdateReason(info)).toContain("26.7.3");
  });

  it("distinguishes a major upgrade from a missing security release", () => {
    const current = status("15.8.3");
    const behind = status("15.8.2");

    expect(current.status).toBe("update_available");
    expect(current.code).toBe("major_upgrade_available");
    expect(current.latestVersion).toBe("26.7.3");

    expect(behind.status).toBe("security_update_required");
    expect(behind.latestVersion).toBe("15.8.3");
  });

  it("treats a major outside the support window as requiring an update", () => {
    // Current plus two previous majors: 26, 15 and 14, so Ventura 13 is out.
    const info = status("13.7.8");

    expect(info.status).toBe("security_update_required");
    expect(info.code).toBe("unsupported_macos_major");
    expect(info.latestVersion).toBe("26.7.3");
    expect(info.requiredMinimumVersion).toBe("14.8.9");
  });

  it("returns unknown for platforms, missing versions and missing feeds", () => {
    expect(status("26.7.3", null).code).toBe("feed_unavailable");
    expect(
      deriveSoftwareUpdate(
        { proto: "apple", osEdition: "iOS", model: "iPhone15,2", osVersion: "18.4" },
        catalog(),
      ).code,
    ).toBe("platform_unsupported");
    expect(status(null).code).toBe("version_unknown");
    expect(status("26.7").status).toBe("security_update_required");
  });

  it("does not invent a status for a version the feed has never seen", () => {
    const info = status("16.0");

    expect(info.status).toBe("unknown");
    expect(info.code).toBe("version_not_in_feed");
  });

  it("treats a marketing/pre-release string as version_unknown", () => {
    for (const version of ["15.0 Beta (24A123)", "15.0 beta", "Sequoia 15.0"]) {
      const info = status(version);

      expect(info.status, version).toBe("unknown");
      expect(info.code, version).toBe("version_unknown");
    }
  });

  it("compares trailing zero segments as equal", () => {
    expect(compareVersionStrings("14.4", "14.4.0")).toBe(0);
    expect(compareVersionStrings("15.10", "15.9")).toBe(1);
    expect(compareVersionStrings("13.6.1", "14")).toBe(-1);
    expect(compareVersionStrings("not-a-version", "14")).toBeNull();

    const parsed = parseSofaFeed(
      feed({
        OSVersions: [
          {
            OSVersion: "Sequoia 15",
            Latest: release("15.8"),
            SecurityReleases: [],
          },
          {
            OSVersion: "Tahoe 26",
            Latest: release("26.7.3"),
            SecurityReleases: [],
          },
        ],
      }),
    );

    expect(
      deriveSoftwareUpdate({ proto: "apple", osEdition: "macOS", osVersion: "15.8.0" }, parsed, {
        supportedMajorCount: 2,
      }).status,
    ).toBe("update_available");
  });

  it("computes the supported baseline from the major count", () => {
    expect(macOsUpdateBaseline(catalog(), 3)).toMatchObject({
      latestVersion: "26.7.3",
      minimumSupportedVersion: "14.8.9",
      minimumSupportedMajor: 14,
      newestMajor: 26,
    });
    expect(macOsUpdateBaseline(catalog(), 1)).toMatchObject({
      minimumSupportedVersion: "26.7.3",
      minimumSupportedMajor: 26,
    });
  });
});

describe("macOS update counts", () => {
  it("counts every category without folding unknown into up to date", () => {
    const infos = [
      status("26.7.3"),
      status("26.7.1"),
      status("15.8.3"),
      status("13.7.8"),
      status("16.0"),
      deriveSoftwareUpdate(
        { proto: "win", osEdition: "Windows 11 Pro", osVersion: "10.0.26100" },
        catalog(),
      ),
    ];

    expect(countSoftwareUpdates(infos)).toEqual({
      total: 6,
      upToDate: 1,
      updateAvailable: 1,
      securityRequired: 2,
      behind: 3,
      unknown: 1,
      notApplicable: 1,
    });
  });
});
