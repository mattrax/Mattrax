import { Schema } from "effect";
import { DeviceRelation } from "./Group.js";
import { GroupRelation } from "./Group.js";
import { NullableString } from "./Errors.js";

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
  devicesCount: Schema.optional(Schema.Number),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

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
});

export type ApplicationSearchRow = typeof ApplicationSearchRow.Type;

export const ApplicationNode = Schema.Struct({
  ...ApplicationRow.fields,
  groups: Schema.Array(GroupRelation),
  devices: Schema.Array(DeviceRelation),
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

export const PatchApplicationAssignmentsRequest = Schema.Struct({
  assign: Schema.optional(
    Schema.Struct({
      groups: Schema.optional(Schema.Array(Schema.String)),
      devices: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  unassign: Schema.optional(
    Schema.Struct({
      groups: Schema.optional(Schema.Array(Schema.String)),
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
