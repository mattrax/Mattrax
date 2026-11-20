import type { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STOREFRONT_REGION,
  normaliseStorefrontRegion,
  parseAppleStoreLookup,
  resolveApplicationStoreId,
  summariseApplicationAvailability,
} from "./appleStorefront.js";

const lookup = (overrides: Record<string, Schema.Json> = {}) => ({
  resultCount: 1,
  results: [
    {
      wrapperType: "software",
      kind: "software",
      trackId: 361309726,
      trackName: "Pages",
      bundleId: "com.apple.Pages",
      version: "14.2",
      ...overrides,
    },
  ],
});

describe("App Store storefront normalization", () => {
  it("upper-cases a two-letter region and rejects anything else", () => {
    expect(normaliseStorefrontRegion(" gb ")).toBe("GB");
    expect(normaliseStorefrontRegion("US")).toBe("US");
    expect(normaliseStorefrontRegion("usa")).toBeUndefined();
    expect(normaliseStorefrontRegion("")).toBeUndefined();
    expect(normaliseStorefrontRegion(undefined)).toBeUndefined();
  });
});

describe("Apple App Store lookup parsing", () => {
  it("extracts the id and metadata from a software result", () => {
    expect(parseAppleStoreLookup(lookup(), "gb")).toEqual({
      found: true,
      region: "GB",
      storeId: "361309726",
      name: "Pages",
      bundleId: "com.apple.Pages",
      version: "14.2",
    });
  });

  it("accepts string track ids and mac-software results", () => {
    const parsed = parseAppleStoreLookup(
      lookup({ trackId: "123456789", kind: "mac-software" }),
      "US",
    );

    expect(parsed).toMatchObject({ found: true, storeId: "123456789", region: "US" });
  });

  it("treats a zero-result lookup as unavailable and names the storefront", () => {
    expect(parseAppleStoreLookup({ resultCount: 0, results: [] }, "jp")).toEqual({
      found: false,
      region: "JP",
      reason: "Not found in the JP App Store",
    });
  });

  it("ignores non-software matches", () => {
    const parsed = parseAppleStoreLookup(
      {
        resultCount: 1,
        results: [{ wrapperType: "track", kind: "song", trackId: 42, trackName: "A song" }],
      },
      "US",
    );

    expect(parsed.found).toBe(false);
    expect("storeId" in parsed).toBe(false);
    expect(parsed.reason).toBe("Not found in the US App Store");
  });

  it("does not throw on malformed payloads", () => {
    expect(parseAppleStoreLookup(undefined, "US")).toMatchObject({ found: false, region: "US" });
    expect(parseAppleStoreLookup({ results: "nope" }, "US")).toMatchObject({ found: false });
    expect(parseAppleStoreLookup({ results: [{}] }, "US")).toMatchObject({ found: false });
  });
});

describe("App Store id resolution", () => {
  const storefronts = [
    { region: "GB", storeId: "gb-id", available: true },
    { region: "US", storeId: "us-id", available: true },
    { region: "JP", storeId: "jp-id", available: true },
  ];

  it("uses the preferred region when the app is available there", () => {
    expect(resolveApplicationStoreId({ storefronts, preferredRegion: "jp" })).toEqual({
      storeId: "jp-id",
      region: "JP",
      source: "storefront",
    });
  });

  it("falls back to the US storefront, then lexical region order", () => {
    expect(
      resolveApplicationStoreId({
        storefronts,
        preferredRegion: "FR",
      }),
    ).toEqual({ storeId: "us-id", region: "US", source: "storefront" });

    expect(
      resolveApplicationStoreId({
        storefronts: storefronts.filter((row) => row.region !== "US"),
        preferredRegion: "FR",
      }),
    ).toEqual({ storeId: "gb-id", region: "GB", source: "storefront" });
  });

  it("skips unavailable and id-less rows", () => {
    expect(
      resolveApplicationStoreId({
        storefronts: [
          { region: "US", storeId: "us-id", available: false },
          { region: "GB", storeId: null, available: true },
          { region: "AU", storeId: "au-id", available: true },
        ],
        preferredRegion: "US",
      }),
    ).toEqual({ storeId: "au-id", region: "AU", source: "storefront" });
  });

  it("uses the legacy installer id when no storefront can supply one", () => {
    expect(
      resolveApplicationStoreId({
        storefronts: [{ region: "US", storeId: "us-id", available: false }],
        preferredRegion: "GB",
        legacyStoreId: " legacy-id ",
      }),
    ).toEqual({ storeId: "legacy-id", region: "GB", source: "legacy" });
  });

  it("returns undefined when there is no usable id", () => {
    expect(
      resolveApplicationStoreId({
        storefronts: [],
        preferredRegion: "US",
        legacyStoreId: "  ",
      }),
    ).toBeUndefined();
  });

  it("defaults the region to the US storefront", () => {
    expect(
      resolveApplicationStoreId({
        storefronts: [],
        legacyStoreId: "legacy-id",
      }),
    ).toEqual({
      storeId: "legacy-id",
      region: DEFAULT_STOREFRONT_REGION,
      source: "legacy",
    });
  });
});

describe("application availability summary", () => {
  it("is unknown before any storefront has been checked", () => {
    expect(summariseApplicationAvailability([])).toEqual({ availability: "unknown" });
  });

  it("is available when any storefront still carries the app", () => {
    expect(
      summariseApplicationAvailability([
        {
          region: "US",
          storeId: "us-id",
          available: true,
          lastSeenAt: "2026-11-18T10:00:00.000Z",
        },
        {
          region: "GB",
          storeId: "gb-id",
          available: false,
          lastSeenAt: "2026-11-17T10:00:00.000Z",
          reason: "Not found in the GB App Store",
        },
      ]),
    ).toEqual({
      availability: "available",
      lastSeenAt: "2026-11-18T10:00:00.000Z",
    });
  });

  it("marks every missing storefront unavailable and keeps the last sighting", () => {
    expect(
      summariseApplicationAvailability([
        {
          region: "GB",
          storeId: "gb-id",
          available: false,
          lastSeenAt: "2026-11-17T10:00:00.000Z",
          reason: "Not found in the GB App Store",
        },
        {
          region: "US",
          storeId: "us-id",
          available: false,
          lastSeenAt: "2026-11-19T10:00:00.000Z",
          reason: "Not found in the US App Store",
        },
      ]),
    ).toEqual({
      availability: "unavailable",
      reason: "Not found in the GB App Store",
      lastSeenAt: "2026-11-19T10:00:00.000Z",
    });
  });

  it("survives rows with malformed regions", () => {
    expect(
      summariseApplicationAvailability([
        { region: "USA", storeId: "x", available: false },
        { region: "us", storeId: "us-id", available: true, lastSeenAt: "2026-11-18T10:00:00Z" },
      ]),
    ).toMatchObject({ availability: "available" });
  });
});
