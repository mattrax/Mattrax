/**
 * macOS software-update status from the SOFA feed.
 *
 * SimpleMDM publishes SOFA (https://github.com/macadmins/sofa) as a JSON feed
 * of the latest macOS releases per major version, including the security
 * releases Apple has shipped for versions that are no longer current. Mattrax
 * uses it only to answer one question for a device: is the reported macOS
 * version behind the release Apple published for that major version?
 *
 * This module is deliberately pure and defensive:
 *
 * - the feed is external input, so every field is optional and malformed
 *   entries are skipped rather than failing the whole feed;
 * - status derivation reuses `compareVersionStrings` from the device query
 *   language, so there is one version comparator in the product;
 * - a missing feed, an unknown macOS version and a non-Apple device are all
 *   reported as `unknown`, never as "up to date".
 */

import { Option, Schema } from "effect";
import { isMacOsDevice } from "./deviceHealth.js";
import { compareVersionStrings } from "./deviceQuery.js";

const MAX_OS_VERSIONS = 16;

const MAX_RELEASES_PER_MAJOR = 64;

const MAX_VERSION_LENGTH = 64;

const MAX_LABEL_LENGTH = 80;

const MAX_URL_LENGTH = 2_048;

const MAX_DATE_LENGTH = 40;

export const SOFTWARE_UPDATE_STATUSES = [
  "up_to_date",
  "update_available",
  "security_update_required",
  "unknown",
] as const;

export const SoftwareUpdateStatus = Schema.Literals(SOFTWARE_UPDATE_STATUSES);

export type SoftwareUpdateStatus = typeof SoftwareUpdateStatus.Type;

/**
 * Stable reason codes. The UI explains the status from these rather than from
 * a sentence, so wording can change without breaking counts or tests.
 */
export const SOFTWARE_UPDATE_CODES = [
  "up_to_date",
  "security_release_missing",
  "unsupported_macos_major",
  "major_upgrade_available",
  "platform_unsupported",
  "version_unknown",
  "version_not_in_feed",
  "comparison_failed",
  "feed_unavailable",
  "feed_disabled",
] as const;

export const SoftwareUpdateCode = Schema.Literals(SOFTWARE_UPDATE_CODES);

export type SoftwareUpdateCode = typeof SoftwareUpdateCode.Type;

const NullableString = Schema.NullOr(Schema.String);

/** One published macOS release inside the SOFA feed. */
export const MacOsUpdateRelease = Schema.Struct({
  version: Schema.String,
  releaseDate: NullableString,
  securityInfoUrl: NullableString,
  /** True when SOFA lists at least one actively exploited CVE for the release. */
  activelyExploited: Schema.Boolean,
});

export type MacOsUpdateRelease = typeof MacOsUpdateRelease.Type;

/** The releases for one macOS major version, newest first. */
export const MacOsUpdateMajor = Schema.Struct({
  major: Schema.Finite,
  label: Schema.String,
  latest: MacOsUpdateRelease,
  releases: Schema.Array(MacOsUpdateRelease),
});

export type MacOsUpdateMajor = typeof MacOsUpdateMajor.Type;

/** The trimmed feed stored in the database and used for comparisons. */
export const MacOsUpdateCatalog = Schema.Struct({
  updateHash: NullableString,
  majors: Schema.Array(MacOsUpdateMajor),
});

export type MacOsUpdateCatalog = typeof MacOsUpdateCatalog.Type;

/**
 * Raw SOFA shapes. Only the fields this product needs are declared; unknown
 * fields are ignored so a feed addition does not break decoding.
 *
 * Nested values are decoded separately (see `parseSofaFeed`) so one malformed
 * release does not discard a whole OS version, and one malformed OS version
 * does not discard the whole feed.
 */
const SofaRelease = Schema.Struct({
  ProductVersion: Schema.optional(Schema.Json),
  ReleaseDate: Schema.optional(Schema.Json),
  SecurityInfo: Schema.optional(Schema.Json),
  ActivelyExploitedCVEs: Schema.optional(Schema.Json),
});

const SofaOsVersion = Schema.Struct({
  OSVersion: Schema.optional(Schema.Json),
  Latest: Schema.optional(Schema.Json),
  SecurityReleases: Schema.optional(Schema.Json),
});

const SofaFeed = Schema.Struct({
  UpdateHash: Schema.optional(Schema.Json),
  OSVersions: Schema.optional(Schema.Json),
});

const decodeSofaFeed = Schema.decodeUnknownOption(SofaFeed);

const decodeSofaOsVersion = Schema.decodeUnknownOption(SofaOsVersion);

const decodeSofaRelease = Schema.decodeUnknownOption(SofaRelease);

const text = (value: Schema.Json | undefined, maximum: number): string | null => {
  if (!Schema.is(Schema.String)(value)) return null;
  const trimmed = value.trim();

  if (trimmed.length === 0) return null;

  return trimmed.slice(0, maximum);
};

const versionText = (value: Schema.Json | undefined): string | null => {
  const candidate = text(value, MAX_VERSION_LENGTH);

  if (!candidate) return null;

  // SOFA versions are dotted integers. A marketing string such as
  // "macOS 15.1" is deliberately rejected rather than guessed at.
  if (!/^\d+(?:[._]\d+)*$/.test(candidate)) return null;

  return candidate;
};

const majorOf = (version: string): number | null => {
  const match = /^\s*(\d+)/.exec(version);

  if (!match) return null;
  const major = Number(match[1]);

  return Number.isSafeInteger(major) && major > 0 ? major : null;
};

const dateText = (value: Schema.Json | undefined): string | null => {
  const candidate = text(value, MAX_DATE_LENGTH);

  if (!candidate) return null;
  const parsed = new Date(candidate);

  return Number.isNaN(parsed.getTime()) ? null : candidate;
};

/** Only https URLs are exposed for rendering; anything else is dropped. */
const httpsUrl = (value: Schema.Json | undefined): string | null => {
  const candidate = text(value, MAX_URL_LENGTH);

  if (!candidate) return null;

  try {
    return new URL(candidate).protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
};

const activelyExploited = (value: Schema.Json | undefined): boolean =>
  Array.isArray(value) && value.length > 0;

const releaseFrom = (value: Schema.Json | undefined): MacOsUpdateRelease | null => {
  const decoded = Option.getOrNull(decodeSofaRelease(value));

  if (!decoded) return null;
  const version = versionText(decoded.ProductVersion);

  if (!version) return null;

  return {
    version,
    releaseDate: dateText(decoded.ReleaseDate),
    securityInfoUrl: httpsUrl(decoded.SecurityInfo),
    activelyExploited: activelyExploited(decoded.ActivelyExploitedCVEs),
  };
};

const sortReleases = (releases: ReadonlyArray<MacOsUpdateRelease>): MacOsUpdateRelease[] =>
  [...releases].sort((left, right) => {
    const comparison = compareVersionStrings(left.version, right.version);

    return comparison === null ? 0 : -comparison;
  });

/**
 * Parse a SOFA `macos_data_feed.json` payload.
 *
 * Returns `null` when the payload has no usable OS versions. Individual
 * malformed releases and OS versions are dropped, which keeps a partially
 * broken upstream feed useful instead of treating the whole fleet as unknown.
 */
export const parseSofaFeed = (input: Schema.Json): MacOsUpdateCatalog | null => {
  const feed = Option.getOrNull(decodeSofaFeed(input));

  if (!feed || !Array.isArray(feed.OSVersions)) return null;

  const byMajor = new Map<number, MacOsUpdateMajor>();

  for (const raw of feed.OSVersions.slice(0, MAX_OS_VERSIONS)) {
    const decoded = Option.getOrNull(decodeSofaOsVersion(raw));

    if (!decoded) continue;

    const releases: MacOsUpdateRelease[] = [];
    const latest = releaseFrom(decoded.Latest);

    if (latest) releases.push(latest);

    if (Array.isArray(decoded.SecurityReleases))
      for (const entry of decoded.SecurityReleases.slice(0, MAX_RELEASES_PER_MAJOR)) {
        const release = releaseFrom(entry);

        if (release) releases.push(release);
      }

    if (releases.length === 0) continue;

    // Deduplicate by version; when both `Latest` and a security release list
    // the same version, keep the one with the most complete metadata.
    const unique = new Map<string, MacOsUpdateRelease>();

    for (const release of releases) {
      const existing = unique.get(release.version);

      if (!existing) {
        unique.set(release.version, release);
        continue;
      }

      unique.set(release.version, {
        ...existing,
        releaseDate: existing.releaseDate ?? release.releaseDate,
        securityInfoUrl: existing.securityInfoUrl ?? release.securityInfoUrl,
        activelyExploited: existing.activelyExploited || release.activelyExploited,
      });
    }

    const sorted = sortReleases([...unique.values()]);
    const newest = sorted[0]!;
    const major = majorOf(newest.version);

    if (major === null) continue;
    const label = text(decoded.OSVersion, MAX_LABEL_LENGTH) ?? `macOS ${major}`;

    const entry: MacOsUpdateMajor = {
      major,
      label,
      latest: newest,
      releases: sorted,
    };

    const existing = byMajor.get(major);

    // A feed should list each major once. If it does not, keep the entry with
    // the higher latest release instead of letting input order decide.
    if (
      !existing ||
      (compareVersionStrings(entry.latest.version, existing.latest.version) ?? 0) > 0
    )
      byMajor.set(major, entry);
  }

  const majors = [...byMajor.values()].sort((left, right) => right.major - left.major);

  if (majors.length === 0) return null;

  return {
    updateHash: text(feed.UpdateHash, 128),
    majors,
  };
};

/** The newest major in the feed, or `null` when the catalog is unusable. */
export const newestMacOsUpdateMajor = (catalog: MacOsUpdateCatalog | null | undefined) =>
  catalog?.majors[0] ?? null;

/**
 * The oldest major still inside the support window. Apple typically ships
 * security updates for the current major and the two previous ones; the count
 * is configurable because some fleets keep a stricter or looser window.
 */
export const supportedMacOsUpdateMajors = (
  catalog: MacOsUpdateCatalog | null | undefined,
  supportedMajorCount: number,
) => {
  if (!catalog || catalog.majors.length === 0) return [];

  const count = Math.min(Math.max(Math.trunc(supportedMajorCount) || 1, 1), catalog.majors.length);

  return catalog.majors.slice(0, count);
};

/** The latest release and the minimum supported release for the feed. */
export const macOsUpdateBaseline = (
  catalog: MacOsUpdateCatalog | null | undefined,
  supportedMajorCount: number,
) => {
  const supported = supportedMacOsUpdateMajors(catalog, supportedMajorCount);
  const newest = newestMacOsUpdateMajor(catalog);
  const oldest = supported.at(-1) ?? null;

  return {
    latestVersion: newest?.latest.version ?? null,
    minimumSupportedVersion: oldest?.latest.version ?? null,
    minimumSupportedMajor: oldest?.major ?? null,
    newestMajor: newest?.major ?? null,
  };
};

export const SoftwareUpdateInfo = Schema.Struct({
  status: SoftwareUpdateStatus,
  code: SoftwareUpdateCode,
  currentVersion: NullableString,
  latestVersion: NullableString,
  requiredMinimumVersion: NullableString,
  releaseDate: NullableString,
  securityInfoUrl: NullableString,
});

export type SoftwareUpdateInfo = typeof SoftwareUpdateInfo.Type;

const unknownInfo = (
  code: SoftwareUpdateCode,
  input: {
    readonly currentVersion?: string | null;
    readonly latestVersion?: string | null;
    readonly requiredMinimumVersion?: string | null;
  } = {},
): SoftwareUpdateInfo => ({
  status: "unknown",
  code,
  currentVersion: input.currentVersion ?? null,
  latestVersion: input.latestVersion ?? null,
  requiredMinimumVersion: input.requiredMinimumVersion ?? null,
  releaseDate: null,
  securityInfoUrl: null,
});

const infoFor = (
  status: Exclude<SoftwareUpdateStatus, "unknown">,
  code: Exclude<
    SoftwareUpdateCode,
    | "platform_unsupported"
    | "version_unknown"
    | "version_not_in_feed"
    | "comparison_failed"
    | "feed_unavailable"
    | "feed_disabled"
  >,
  input: {
    readonly currentVersion: string;
    readonly target: MacOsUpdateRelease;
    readonly requiredMinimumVersion: string | null;
  },
): SoftwareUpdateInfo => ({
  status,
  code,
  currentVersion: input.currentVersion,
  latestVersion: input.target.version,
  requiredMinimumVersion: input.requiredMinimumVersion,
  releaseDate: input.target.releaseDate,
  securityInfoUrl: input.target.securityInfoUrl,
});

export type SoftwareUpdateDeviceInput = {
  readonly proto?: string | null;
  readonly osVersion?: string | null;
  readonly osEdition?: string | null;
  readonly model?: string | null;
};

/**
 * Derive one device's update status.
 *
 * A device on the newest major version but behind its latest release gets
 * `security_update_required`; a device that is current for its major but has a
 * newer major available gets `update_available`. A device outside the support
 * window also requires an update, even when it is current for its own major.
 */
export const deriveSoftwareUpdate = (
  device: SoftwareUpdateDeviceInput,
  catalog: MacOsUpdateCatalog | null | undefined,
  options: { readonly supportedMajorCount?: number } = {},
): SoftwareUpdateInfo => {
  if (!isMacOsDevice(device)) return unknownInfo("platform_unsupported");

  const reportedVersion = device.osVersion?.trim() || null;

  if (!reportedVersion) return unknownInfo("version_unknown");

  // Only dotted integers are comparable. A marketing string such as
  // "15.0 Beta (24A123)" must not be read as 15.0 and reported as a missing
  // security release.
  const currentVersion = versionText(reportedVersion);

  if (!currentVersion) return unknownInfo("version_unknown", { currentVersion: reportedVersion });

  const currentMajor = majorOf(currentVersion);

  if (currentMajor === null) return unknownInfo("version_unknown", { currentVersion });

  if (!catalog || catalog.majors.length === 0)
    return unknownInfo("feed_unavailable", { currentVersion });

  const baseline = macOsUpdateBaseline(catalog, options.supportedMajorCount ?? 3);
  const entry = catalog.majors.find((major) => major.major === currentMajor);
  const newest = newestMacOsUpdateMajor(catalog)!;

  // Outside the support window: the target is the newest release overall,
  // because the device must cross a major upgrade to receive security fixes.
  if (currentMajor < (baseline.minimumSupportedMajor ?? Number.POSITIVE_INFINITY))
    return {
      status: "security_update_required",
      code: "unsupported_macos_major",
      currentVersion,
      latestVersion: newest.latest.version,
      requiredMinimumVersion: baseline.minimumSupportedVersion,
      releaseDate: newest.latest.releaseDate,
      securityInfoUrl: newest.latest.securityInfoUrl,
    };

  // A version the feed has never listed (for example a pre-release) is not
  // evidence that the device is current, so it stays unknown.
  if (!entry)
    return unknownInfo("version_not_in_feed", {
      currentVersion,
      latestVersion: newest.latest.version,
    });

  const comparison = compareVersionStrings(currentVersion, entry.latest.version);

  if (comparison === null)
    return unknownInfo("comparison_failed", {
      currentVersion,
      latestVersion: entry.latest.version,
    });

  if (comparison < 0)
    return infoFor("security_update_required", "security_release_missing", {
      currentVersion,
      target: entry.latest,
      requiredMinimumVersion: baseline.minimumSupportedVersion,
    });

  if (currentMajor < newest.major)
    return infoFor("update_available", "major_upgrade_available", {
      currentVersion,
      target: newest.latest,
      requiredMinimumVersion: baseline.minimumSupportedVersion,
    });

  return infoFor("up_to_date", "up_to_date", {
    currentVersion,
    target: entry.latest,
    requiredMinimumVersion: baseline.minimumSupportedVersion,
  });
};

export type SoftwareUpdateCounts = {
  readonly total: number;
  readonly upToDate: number;
  readonly updateAvailable: number;
  readonly securityRequired: number;
  readonly behind: number;
  /** macOS devices the feed could not evaluate. */
  readonly unknown: number;
  /** Non-macOS devices, which this feed does not cover. */
  readonly notApplicable: number;
};

/** Aggregate per-device results for the dashboard and API summary. */
export const countSoftwareUpdates = (
  infos: ReadonlyArray<SoftwareUpdateInfo>,
): SoftwareUpdateCounts => {
  let upToDate = 0;
  let updateAvailable = 0;
  let securityRequired = 0;
  let unknown = 0;
  let notApplicable = 0;

  for (const info of infos) {
    switch (info.status) {
      case "up_to_date":
        upToDate += 1;
        break;
      case "update_available":
        updateAvailable += 1;
        break;
      case "security_update_required":
        securityRequired += 1;
        break;
      case "unknown":
        if (info.code === "platform_unsupported") notApplicable += 1;
        else unknown += 1;
        break;
    }
  }

  return {
    total: infos.length,
    upToDate,
    updateAvailable,
    securityRequired,
    behind: updateAvailable + securityRequired,
    unknown,
    notApplicable,
  };
};

/** What the UI needs to know about the feed that produced the statuses. */
export const SoftwareUpdateFeedInfo = Schema.Struct({
  source: Schema.Literal("sofa"),
  url: Schema.String,
  available: Schema.Boolean,
  stale: Schema.Boolean,
  fetchedAt: NullableString,
  /** Stable failure code, never a raw upstream body. */
  error: NullableString,
  latestVersion: NullableString,
  minimumSupportedVersion: NullableString,
});

export type SoftwareUpdateFeedInfo = typeof SoftwareUpdateFeedInfo.Type;

/** One device in the dashboard's short "behind" list. */
export const SoftwareUpdateAttentionDevice = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: SoftwareUpdateStatus,
  code: SoftwareUpdateCode,
  currentVersion: NullableString,
  latestVersion: NullableString,
  releaseDate: NullableString,
  securityInfoUrl: NullableString,
});

export type SoftwareUpdateAttentionDevice = typeof SoftwareUpdateAttentionDevice.Type;

export const SoftwareUpdateSummaryResponse = Schema.Struct({
  feed: SoftwareUpdateFeedInfo,
  counts: Schema.Struct({
    total: Schema.Finite,
    upToDate: Schema.Finite,
    updateAvailable: Schema.Finite,
    securityRequired: Schema.Finite,
    behind: Schema.Finite,
    unknown: Schema.Finite,
    notApplicable: Schema.Finite,
  }),
  devices: Schema.Array(SoftwareUpdateAttentionDevice),
});

export type SoftwareUpdateSummaryResponse = typeof SoftwareUpdateSummaryResponse.Type;

const STATUS_RANK: Record<SoftwareUpdateStatus, number> = {
  security_update_required: 0,
  update_available: 1,
  up_to_date: 2,
  unknown: 3,
};

/** Worst-first ordering for the dashboard's short list of affected devices. */
export const softwareUpdateRank = (status: SoftwareUpdateStatus): number => STATUS_RANK[status];

/** Human-readable summary of why a status was assigned. */
export const softwareUpdateReason = (info: SoftwareUpdateInfo): string => {
  switch (info.code) {
    case "up_to_date":
      return info.latestVersion
        ? `Up to date with macOS ${info.latestVersion}.`
        : "Up to date with the published macOS release.";
    case "security_release_missing":
      return info.latestVersion
        ? `macOS ${info.latestVersion} includes security fixes this device is missing.`
        : "A security update is available for this macOS version.";
    case "unsupported_macos_major":
      return `macOS ${info.currentVersion ?? "on this device"} is outside the supported update window.`;
    case "major_upgrade_available":
      return info.latestVersion
        ? `macOS ${info.latestVersion} is available as a major upgrade.`
        : "A newer macOS major version is available.";
    case "platform_unsupported":
      return "OS update checks currently cover macOS only.";
    case "version_unknown":
      return "The device has not reported its macOS version.";
    case "version_not_in_feed":
      return "This macOS version is not in the update feed yet.";
    case "comparison_failed":
      return "The reported macOS version could not be compared with the feed.";
    case "feed_disabled":
      return "The macOS update feed is disabled on this deployment.";
    case "feed_unavailable":
      return "The macOS update feed is unavailable.";
  }
};
