import { Schema } from "effect";
import { DeviceRelation } from "./Group.js";
import { GroupRelation } from "./Group.js";
import { NullableString } from "./Errors.js";

import { ApplicationAvailability } from "./appleStorefront.js";

export { ApplicationAvailability };

export const ApplicationPlatform = Schema.Literals(["apple", "win", "android"]);

export type ApplicationPlatform = typeof ApplicationPlatform.Type;

export const ApplicationSource = Schema.Literals(["manifest", "store", "upload"]);

export type ApplicationSource = typeof ApplicationSource.Type;

export const ApplicationInstallerRow = Schema.Struct({
  id: Schema.String,
  platform: ApplicationPlatform,
  source: ApplicationSource,
  bundleId: Schema.optional(NullableString),
  version: Schema.optional(NullableString),
  manifestUrl: Schema.optional(NullableString),
  storeId: Schema.optional(NullableString),
  fileName: Schema.optional(NullableString),
  contentType: Schema.optional(NullableString),
  size: Schema.optional(Schema.Number),
  sha256: Schema.optional(NullableString),
  /** Minimum device OS version this installer supports. */
  minOsVersion: Schema.optional(NullableString),
  /** Capability the device must report, e.g. `vpp` or `msi`. */
  requiredCapability: Schema.optional(NullableString),
  priority: Schema.Number,
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});

export type ApplicationInstallerRow = typeof ApplicationInstallerRow.Type;

export const ApplicationInstallerInput = Schema.Struct({
  /** Present when updating an existing installer. */
  id: Schema.optional(Schema.String),
  platform: ApplicationPlatform,
  source: Schema.optional(ApplicationSource),
  bundleId: Schema.optional(NullableString),
  version: Schema.optional(NullableString),
  manifestUrl: Schema.optional(NullableString),
  storeId: Schema.optional(NullableString),
  minOsVersion: Schema.optional(NullableString),
  requiredCapability: Schema.optional(NullableString),
  priority: Schema.optional(Schema.Number),
});

export type ApplicationInstallerInput = typeof ApplicationInstallerInput.Type;

export const ApplicationRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  platform: ApplicationPlatform,
  bundleId: Schema.optional(NullableString),
  version: Schema.optional(NullableString),
  source: ApplicationSource,
  manifestUrl: Schema.optional(NullableString),
  storeId: Schema.optional(NullableString),
  fileName: Schema.optional(NullableString),
  contentType: Schema.optional(NullableString),
  size: Schema.optional(Schema.Number),
  sha256: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
  installers: Schema.Array(ApplicationInstallerRow),
  groupsCount: Schema.optional(Schema.Number),
  /** Directory user groups assigned this application. */
  userGroupsCount: Schema.optional(Schema.Number),
  devicesCount: Schema.optional(Schema.Number),
  /**
   * Roll-up across the recorded App Store storefronts. `unknown` until an
   * availability check has run; an app no storefront carries is
   * `unavailable` and is not offered for new installs.
   */
  availability: Schema.optional(ApplicationAvailability),
  availabilityReason: Schema.optional(NullableString),
  /** Last time any storefront still carried the app. */
  lastSeenAt: Schema.optional(NullableString),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

/**
 * One App Store storefront for an application.
 *
 * The numeric App Store id is global per app record, but availability differs
 * by storefront and some vendors publish separate records for different
 * markets. Keeping the mapping per region makes those cases explicit instead
 * of overwriting one id with another.
 */
export const ApplicationStorefrontRow = Schema.Struct({
  region: Schema.String,
  /** App Store track id in this storefront; null when the app is missing. */
  storeId: Schema.optional(NullableString),
  available: Schema.Boolean,
  name: Schema.optional(NullableString),
  bundleId: Schema.optional(NullableString),
  version: Schema.optional(NullableString),
  /** `lookup` rows come from Apple; `manual` rows were entered by an admin. */
  source: Schema.Literals(["lookup", "manual"]),
  lastSeenAt: Schema.optional(NullableString),
  reason: Schema.optional(NullableString),
  checkedAt: Schema.String,
});

export type ApplicationStorefrontRow = typeof ApplicationStorefrontRow.Type;

export const ApplicationStorefrontListResponse = Schema.Struct({
  availability: ApplicationAvailability,
  storefronts: Schema.Array(ApplicationStorefrontRow),
});

export type ApplicationStorefrontListResponse = typeof ApplicationStorefrontListResponse.Type;

export type ApplicationRow = typeof ApplicationRow.Type;

export const ApplicationListResponse = Schema.Struct({
  applications: Schema.Array(ApplicationRow),
});

/**
 * A catalogue application surfaced by the command palette. It carries only the
 * fields the result row renders, not the installer/assignment detail that the
 * applications page fetches.
 */
export const ApplicationSearchRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  platform: ApplicationPlatform,
  /** Bundle id, package name or store id when the catalogue holds one. */
  identifier: Schema.optional(NullableString),
  /** Canonical store id, kept so store-only matches survive client filtering. */
  storeId: Schema.optional(NullableString),
});

export type ApplicationSearchRow = typeof ApplicationSearchRow.Type;

export const ApplicationNode = Schema.Struct({
  ...ApplicationRow.fields,
  groups: Schema.Array(GroupRelation),
  devices: Schema.Array(DeviceRelation),
  /** Directory user groups assigned this application. */
  userGroups: Schema.Array(GroupRelation),
  /** Devices reached directly or through any assignment (group, directory group). */
  resolvedDevicesCount: Schema.optional(Schema.Number),
  /** Per-storefront availability and id mapping, ordered by region. */
  storefronts: Schema.Array(ApplicationStorefrontRow),
});

export type ApplicationNode = typeof ApplicationNode.Type;

/**
 * Tenant backup bundle format.
 *
 * A bundle is intentionally self-contained: internal ids are exported as
 * opaque `key` values and relationships reference those keys, so an import can
 * allocate fresh ids without trusting (or colliding with) another deployment.
 * Secrets never belong in a bundle: APNs/SCEP private keys, token hashes,
 * passwords, sessions and auth proofs are excluded by construction.
 */

export const CreateApplicationRequest = Schema.Struct({
  name: Schema.String,
  /** Legacy single-installer fields; omit when `installers` is supplied. */
  platform: Schema.optional(ApplicationPlatform),
  bundleId: Schema.optional(NullableString),
  version: Schema.optional(NullableString),
  source: Schema.optional(ApplicationSource),
  manifestUrl: Schema.optional(NullableString),
  storeId: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
  installers: Schema.optional(Schema.Array(ApplicationInstallerInput)),
});

export const PatchApplicationRequest = Schema.Struct({
  /** The application's `updatedAt` when the caller loaded it; a mismatch is a 412. */
  expectedUpdatedAt: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  bundleId: Schema.optional(NullableString),
  version: Schema.optional(NullableString),
  source: Schema.optional(ApplicationSource),
  manifestUrl: Schema.optional(NullableString),
  storeId: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
  /** Replace the installer set. Omit to keep it unchanged. */
  installers: Schema.optional(Schema.Array(ApplicationInstallerInput)),
});

export const ApplicationStorefrontInput = Schema.Struct({
  /** ISO 3166-1 alpha-2 storefront, for example `US` or `GB`. */
  region: Schema.String,
  /** Required when `available` is true. */
  storeId: Schema.optional(NullableString),
  available: Schema.optional(Schema.Boolean),
  name: Schema.optional(NullableString),
  bundleId: Schema.optional(NullableString),
  version: Schema.optional(NullableString),
  reason: Schema.optional(NullableString),
});

export type ApplicationStorefrontInput = typeof ApplicationStorefrontInput.Type;

/** Replace the manual storefront mapping. Rows omitted from the list are removed. */
export const PatchApplicationStorefrontsRequest = Schema.Struct({
  storefronts: Schema.Array(ApplicationStorefrontInput),
});

/** Regions to check; omitted means the storefronts already recorded for the app. */
export const RefreshApplicationStorefrontsRequest = Schema.Struct({
  regions: Schema.optional(Schema.Array(Schema.String)),
});

export const RemovedApplicationAssignments = Schema.Struct({
  groups: Schema.Number,
  userGroups: Schema.Number,
  devices: Schema.Number,
});

export type RemovedApplicationAssignments = typeof RemovedApplicationAssignments.Type;

export const UnlinkApplicationResult = Schema.Struct({
  status: Schema.Literal("ok"),
  removed: RemovedApplicationAssignments,
  /** The catalogue row and its install history are never deleted by an unlink. */
  retainedApplication: Schema.Boolean,
});

export type UnlinkApplicationResult = typeof UnlinkApplicationResult.Type;

export const UnlinkApplicationRequest = Schema.Struct({
  /** Free-text note recorded on the audit entry. */
  reason: Schema.optional(Schema.String),
});

export const ApplicationStorefrontRefreshResult = Schema.Struct({
  ...ApplicationStorefrontListResponse.fields,
  /** Storefronts Apple could not be asked about; their rows were left untouched. */
  errors: Schema.Array(Schema.Struct({ region: Schema.String, message: Schema.String })),
  /** Present when auto-unlink removed assignments after the app went missing. */
  unlinked: Schema.optional(RemovedApplicationAssignments),
});

export type ApplicationStorefrontRefreshResult = typeof ApplicationStorefrontRefreshResult.Type;

export const PatchApplicationAssignmentsRequest = Schema.Struct({
  assign: Schema.optional(
    Schema.Struct({
      groups: Schema.optional(Schema.Array(Schema.String)),
      /** Directory (Entra/SCIM) user groups; members' devices receive the app. */
      userGroups: Schema.optional(Schema.Array(Schema.String)),
      devices: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  unassign: Schema.optional(
    Schema.Struct({
      groups: Schema.optional(Schema.Array(Schema.String)),
      userGroups: Schema.optional(Schema.Array(Schema.String)),
      devices: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});

export const ApplicationInstallResult = Schema.Struct({
  status: Schema.Literal("ok"),
  queued: Schema.Number,
  skipped: Schema.Number,
  message: Schema.optional(Schema.String),
});

export type ApplicationInstallResult = typeof ApplicationInstallResult.Type;
