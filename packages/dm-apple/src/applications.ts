/**
 * Enterprise application install commands.
 *
 * Apple has two paths for an imperative install:
 *
 * - `InstallEnterpriseApplication` (macOS 10.13.6+) installs a signed `.pkg`
 *   from an inline manifest or a `ManifestURL`. This is the only path that can
 *   install a `.pkg`, and it is what Mattrax uses for uploaded packages.
 * - `InstallApplication` installs an App Store app (`iTunesStoreID`) or an
 *   enterprise `.ipa` described by an OTA manifest (`ManifestURL`). It works on
 *   iOS, iPadOS and macOS.
 *
 * Both commands accept an app `Configuration` dictionary (managed app config),
 * which is how the third-party app catalogue delivers settings for an app it
 * also installs.
 *
 * These helpers are pure: they build the command dictionary that goes into the
 * `Command` body, never the outer `CommandUUID` envelope or the plist.
 */

import type { Schema } from "effect";

/**
 * How long a package URL embedded in an install command stays valid.
 *
 * A command has a 24 hour delivery deadline and the device may download the
 * package after acknowledging the command, so the asset link lives for the
 * whole command window instead of the much shorter declaration refresh window.
 */
export const APPLE_INSTALL_ASSET_TTL_SECONDS = 24 * 60 * 60;

/**
 * Expiry for a package URL minted at `now` (Unix milliseconds).
 *
 * The result is rounded up to the next hour so repeated check-ins inside one
 * hour produce byte-identical commands. Without that, the expiring URL would
 * change on every check-in and the command queue's de-duplication key (a hash
 * of the payload) could never recognise the work as already queued.
 */
export const appleInstallAssetExpiresAt = (now: number = Date.now()): number => {
  const hour = 60 * 60 * 1000;
  const nextHour = Math.floor(now / hour) * hour + hour;

  return Math.floor(nextHour / 1000) + APPLE_INSTALL_ASSET_TTL_SECONDS;
};

export type AppleManifestAsset = {
  readonly kind: "software-package";
  readonly url: string;
  readonly sha256?: string;
};

/**
 * The `ManifestURL` plist a device downloads for an enterprise app.
 *
 * Apple requires `items/assets/kind` to be `software-package`, and a SHA-256
 * digest is preferred over MD5 so the device verifies the exact bytes Mattrax
 * stored.
 */
export type AppleManifestItem = {
  readonly assets: ReadonlyArray<AppleManifestAsset>;
  readonly metadata: {
    readonly "bundle-identifier": string;
    readonly "bundle-version": string;
    readonly kind: "software";
    readonly title: string;
  };
};

export type AppleManifest = {
  readonly items: ReadonlyArray<AppleManifestItem>;
};

export const buildAppleManifest = (input: {
  readonly url: string;
  readonly sha256?: string;
  readonly bundleId: string;
  readonly version: string;
  readonly title: string;
}): AppleManifest => {
  const asset: AppleManifestAsset = input.sha256
    ? { kind: "software-package", url: input.url, sha256: input.sha256 }
    : { kind: "software-package", url: input.url };

  return {
    items: [
      {
        assets: [asset],
        metadata: {
          "bundle-identifier": input.bundleId,
          "bundle-version": input.version,
          kind: "software",
          title: input.title,
        },
      },
    ],
  };
};

/** Managed app configuration is a plist dictionary; an array or scalar is not valid. */
export const isAppConfiguration = (value: Schema.Json | undefined): value is Schema.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export type AppleInstallPayload = Schema.JsonObject;

/**
 * Payload for `InstallEnterpriseApplication`.
 *
 * `Manifest` is inlined because the package URL (and therefore the manifest) is
 * device-bound and expires; a shared `ManifestURL` would have to be public and
 * long-lived. That gives up manifest pinning, which an inline manifest cannot
 * use, but the package itself is still fetched over a signed, expiring URL.
 */
export const buildInstallEnterpriseApplicationPayload = (input: {
  readonly manifest: AppleManifest;
  readonly configuration?: Schema.JsonObject;
  readonly managementFlags?: number;
}): AppleInstallPayload => {
  const entries: Array<[string, Schema.Json]> = [
    // SAFETY: AppleManifest is a JSON-compatible dictionary of strings and
    // arrays of dictionaries; Schema.Json accepts exactly that shape.
    ["Manifest", input.manifest],
    ["InstallAsManaged", true],
  ];

  if (input.managementFlags !== undefined) entries.push(["ManagementFlags", input.managementFlags]);

  if (input.configuration !== undefined) entries.push(["Configuration", input.configuration]);

  return Object.fromEntries(entries);
};

/**
 * Payload for `InstallApplication`.
 *
 * Exactly one of `manifestUrl` or `storeId` must be supplied. Apple rejects a
 * command that carries neither, and silently prefers one when both are present.
 */
export const buildInstallApplicationPayload = (input: {
  readonly manifestUrl?: string;
  readonly storeId?: string;
  readonly configuration?: Schema.JsonObject;
  readonly managementFlags?: number;
}): Schema.JsonObject => {
  if ((input.manifestUrl === undefined) === (input.storeId === undefined))
    throw new Error(
      "An InstallApplication payload needs exactly one of ManifestURL or iTunesStoreID",
    );

  const entries: Array<[string, Schema.Json]> =
    input.storeId !== undefined
      ? [["iTunesStoreID", Number(input.storeId)]]
      : [["ManifestURL", input.manifestUrl!]];

  entries.push(["InstallAsManaged", true]);

  if (input.managementFlags !== undefined) entries.push(["ManagementFlags", input.managementFlags]);

  if (input.configuration !== undefined) entries.push(["Configuration", input.configuration]);

  return Object.fromEntries(entries);
};

const PKG_CONTENT_TYPES = new Set([
  "application/vnd.apple.installer+xml",
  "application/x-newton-compatible-pkg",
  "application/octet-stream",
]);

/**
 * Whether an uploaded Apple artefact is a `.pkg`.
 *
 * Only a package can be installed with `InstallEnterpriseApplication`. An
 * uploaded `.ipa` needs an OTA manifest URL (iOS `InstallApplication`), which a
 * bare upload does not provide, so callers must report that instead of queueing
 * an install the device cannot perform.
 */
export const isApplePackageUpload = (input: {
  readonly fileName?: string | null;
  readonly contentType?: string | null;
}): boolean => {
  const fileName = input.fileName?.trim().toLowerCase() ?? "";

  if (fileName.endsWith(".pkg")) return true;

  if (fileName.endsWith(".ipa") || fileName.endsWith(".dmg") || fileName.endsWith(".zip"))
    return false;

  return (
    input.contentType !== null &&
    input.contentType !== undefined &&
    PKG_CONTENT_TYPES.has(input.contentType.toLowerCase())
  );
};
