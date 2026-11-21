/**
 * App Store storefronts.
 *
 * Apple's App Store identity is the numeric `trackId` (also called `adamId`
 * in Apps and Books). The id is allocated once per app record and does not
 * change with the storefront: Pages is `361309726` whether it is looked up in
 * the US, UK or Japanese store. What does change is availability — an app can
 * be published in some storefronts and not others — and a vendor can publish
 * separate app records for different markets, which then have different ids.
 *
 * A catalogue entry therefore keeps one row per storefront instead of assuming
 * one id is globally valid, and resolves the id to hand a device from the
 * device's region (the tenant's default storefront when the device does not
 * report one) with a deterministic fallback.
 *
 * This module is pure: it parses Apple's lookup response shape and decides
 * which id a region should use. Network access lives in the API package.
 */

import { Option, Schema } from "effect";

export const ApplicationAvailability = Schema.Literals(["unknown", "available", "unavailable"]);

export type ApplicationAvailability = typeof ApplicationAvailability.Type;

/**
 * Storefront used when neither the tenant nor the device names one. Apple's
 * lookup endpoint defaults to the US store, so choosing the same value keeps
 * a legacy catalogue entry behaving as it did before regions were recorded.
 */
export const DEFAULT_STOREFRONT_REGION = "US";

/** ISO 3166-1 alpha-2 code, upper-cased, as Apple uses in `country` params. */
export const normaliseStorefrontRegion = (value: Schema.Json | undefined): string | undefined => {
  if (!Schema.is(Schema.String)(value)) return undefined;

  const region = value.trim().toUpperCase();

  return /^[A-Z]{2}$/.test(region) ? region : undefined;
};

export const storefrontUnavailableReason = (region: string) =>
  `Not found in the ${region} App Store`;

/** The subset of a stored storefront row that resolution and summaries read. */
export type StorefrontAvailability = {
  readonly region: string;
  readonly storeId?: string | null;
  readonly available: boolean;
  readonly lastSeenAt?: string | Date | null;
  readonly reason?: string | null;
};

export type ResolvedStoreId = {
  readonly storeId: string;
  readonly region: string;
  readonly source: "storefront" | "legacy";
};

/**
 * Pick the App Store id for one region.
 *
 * Preference order is deterministic: the preferred region (tenant setting or
 * device region), then the default US storefront, then the remaining regions
 * in lexical order. Only storefronts that are currently available and carry an
 * id are considered. When no region row can supply an id, the installer's
 * legacy single `storeId` is used so existing catalogue entries keep working.
 */
export const resolveApplicationStoreId = (input: {
  readonly storefronts: ReadonlyArray<StorefrontAvailability>;
  readonly preferredRegion?: string | null;
  readonly legacyStoreId?: string | null;
}): ResolvedStoreId | undefined => {
  const preferred = normaliseStorefrontRegion(input.preferredRegion) ?? DEFAULT_STOREFRONT_REGION;

  const available = new Map(
    input.storefronts.flatMap((storefront) => {
      const region = normaliseStorefrontRegion(storefront.region);
      const storeId = storefront.storeId?.trim();

      return storefront.available && region && storeId ? [[region, storeId] as const] : [];
    }),
  );

  const rank = (region: string) =>
    region === preferred ? 0 : region === DEFAULT_STOREFRONT_REGION ? 1 : 2;

  const region = [...available.keys()].sort(
    (left, right) => rank(left) - rank(right) || left.localeCompare(right),
  )[0];

  if (region) {
    return { storeId: available.get(region)!, region, source: "storefront" };
  }

  const legacyStoreId = input.legacyStoreId?.trim();

  if (legacyStoreId) return { storeId: legacyStoreId, region: preferred, source: "legacy" };

  return undefined;
};

const toTimestamp = (value: string | Date | null | undefined): number | undefined => {
  if (value == null) return undefined;

  const time = value instanceof Date ? value.getTime() : Date.parse(value);

  return Number.isFinite(time) ? time : undefined;
};

const latestTimestamp = (values: ReadonlyArray<string | Date | null | undefined>) => {
  let latest: number | undefined;

  for (const value of values) {
    const time = toTimestamp(value);

    if (time !== undefined && (latest === undefined || time > latest)) latest = time;
  }

  return latest === undefined ? undefined : new Date(latest).toISOString();
};

export type ApplicationAvailabilitySummary = {
  readonly availability: ApplicationAvailability;
  readonly reason?: string;
  readonly lastSeenAt?: string;
};

/**
 * Roll the per-storefront rows up for the application badge.
 *
 * No rows means `unknown` (nobody has checked yet). One available storefront
 * makes the app installable somewhere. Every checked storefront missing the app
 * marks it `unavailable`, keeping the most recent successful sighting and the
 * first reason in region order so repeated checks are stable.
 */
export const summariseApplicationAvailability = (
  storefronts: ReadonlyArray<StorefrontAvailability>,
): ApplicationAvailabilitySummary => {
  const rows = storefronts.flatMap((storefront) => {
    const region = normaliseStorefrontRegion(storefront.region);

    return region ? [{ ...storefront, region }] : [];
  });

  if (rows.length === 0) return { availability: "unknown" };

  const available = rows.filter((storefront) => storefront.available);

  if (available.length > 0)
    return {
      availability: "available",
      lastSeenAt: latestTimestamp(available.map((storefront) => storefront.lastSeenAt)),
    };

  const sorted = [...rows].sort((left, right) => left.region.localeCompare(right.region));

  return {
    availability: "unavailable",
    reason:
      sorted.find((storefront) => storefront.reason?.trim())?.reason?.trim() ??
      "Not found in any configured App Store storefront",
    lastSeenAt: latestTimestamp(rows.map((storefront) => storefront.lastSeenAt)),
  };
};

export type AppleStoreLookup = {
  readonly found: boolean;
  readonly region: string;
  readonly storeId?: string;
  readonly name?: string;
  readonly bundleId?: string;
  readonly version?: string;
  readonly reason?: string;
};

const text = (value: Schema.Json | undefined): string | undefined => {
  if (Schema.is(Schema.String)(value)) {
    const trimmed = value.trim();

    return trimmed ? trimmed : undefined;
  }

  if (Schema.is(Schema.Number)(value) && Number.isFinite(value)) return String(value);

  return undefined;
};

/** The only shape read from Apple's lookup response. Every member is optional. */
const StoreLookupResponse = Schema.Struct({
  results: Schema.Array(Schema.Json),
});

/**
 * Parse an iTunes Search API `lookup` response for one storefront.
 *
 * Apple returns `{ resultCount, results: [...] }`; a lookup can also match a
 * song, book or podcast when given a track id, so only software results with a
 * `trackId` are accepted. Missing or malformed payloads are treated as "not
 * found" rather than throwing: an app that has been pulled from the store is
 * exactly the case this needs to detect.
 */
export const parseAppleStoreLookup = (
  payload: Schema.Json | undefined,
  regionInput: Schema.Json | undefined,
): AppleStoreLookup => {
  const region = normaliseStorefrontRegion(regionInput) ?? DEFAULT_STOREFRONT_REGION;

  const missing: AppleStoreLookup = {
    found: false,
    region,
    reason: storefrontUnavailableReason(region),
  };

  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(StoreLookupResponse)(payload));

  if (!decoded) return missing;

  const result = decoded.results.find((candidate) => {
    if (!Schema.is(Schema.JsonObject)(candidate)) return false;

    const trackId = text(candidate.trackId);

    if (!trackId) return false;

    const kind = text(candidate.kind)?.toLowerCase();
    const wrapperType = text(candidate.wrapperType)?.toLowerCase();

    // Older lookup responses omit both fields; those are still software
    // results, while a song/book result always carries a kind.
    return (
      wrapperType === "software" ||
      kind === "software" ||
      kind === "mac-software" ||
      (wrapperType === undefined && kind === undefined)
    );
  });

  if (!result || !Schema.is(Schema.JsonObject)(result)) return missing;

  const storeId = text(result.trackId);

  if (!storeId) return missing;

  return {
    found: true,
    region,
    storeId,
    name: text(result.trackName),
    bundleId: text(result.bundleId),
    version: text(result.version),
  };
};
