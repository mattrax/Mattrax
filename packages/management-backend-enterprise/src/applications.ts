/**
 * `InstalledApplicationList` command-result parsing.
 *
 * The device reports a full inventory on every refresh. `undefined` means the
 * command result did not contain an inventory (for example a different
 * command); an empty array means the device reported that no applications are
 * installed, which is a legitimate result that must clear stale rows.
 */

import {
  isPlistArray,
  isPlistObject,
  plistBoolean,
  plistText,
  type PlistInput,
} from "./internal/plistValue.js";

/**
 * The installed-application query used at enrolment and by the daily sweep.
 * Only the fields the inventory table persists are requested: an
 * `InstalledApplicationList` response can be large, and every extra item
 * multiplies the payload across a fleet.
 */
export const APPLE_APPLICATION_INVENTORY_PAYLOAD = {
  Items: [
    "Identifier",
    "Name",
    "Version",
    "ShortVersion",
    "BundleSize",
    "DynamicSize",
    "HasUpdateAvailable",
  ],
  ManagedAppsOnly: false,
};

/**
 * The identity query used at enrolment. macOS reports the user-visible
 * computer name in `DeviceName`; without this query the management name stays
 * a serial number forever.
 */
export const APPLE_DEVICE_INFORMATION_PAYLOAD = {
  Queries: ["DeviceName", "Model", "ModelName", "SerialNumber", "OSVersion", "BuildVersion"],
};

export type InstalledApplicationReport = {
  readonly bundleId: string;
  readonly name?: string;
  readonly version?: string;
  readonly shortVersion?: string;
  readonly bundleSize?: number;
  readonly dynamicSize?: number;
  readonly hasUpdateAvailable: boolean;
  readonly isManaged: boolean;
};

const byteCount = (value: PlistInput): number | undefined => {
  const raw = plistText(value);

  if (raw === undefined) return undefined;

  if (!/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const itemList = (queryResponses: PlistInput): PlistInput => {
  if (!isPlistObject(queryResponses)) return undefined;
  const value = queryResponses.InstalledApplicationList;

  if (isPlistArray(value)) return value;

  if (!isPlistObject(value)) return undefined;

  return value.InstalledApplicationListItem;
};

/**
 * Normalise every reported application, de-duplicating by bundle identifier.
 * Entries without an identifier cannot be addressed on the next refresh and
 * are skipped.
 */
export const parseInstalledApplications = (
  queryResponses: PlistInput,
): InstalledApplicationReport[] | undefined => {
  const items = itemList(queryResponses);

  if (!isPlistArray(items)) return undefined;

  const applications = new Map<string, InstalledApplicationReport>();

  for (const item of items) {
    if (!isPlistObject(item)) continue;
    const bundleId = plistText(item.Identifier) ?? plistText(item.BundleIdentifier);

    if (!bundleId) continue;
    const name = plistText(item.Name);
    const version = plistText(item.Version);
    const shortVersion = plistText(item.ShortVersion);
    const bundleSize = byteCount(item.BundleSize);
    const dynamicSize = byteCount(item.DynamicSize);
    const managementFlags = byteCount(item.ManagementFlags);

    // Optional fields are `undefined` when the device did not report them;
    // JSON serialization and the response schema both treat that as absent.
    const report: InstalledApplicationReport = {
      bundleId,
      hasUpdateAvailable: plistBoolean(item.HasUpdateAvailable) ?? false,
      isManaged:
        plistBoolean(item.IsManaged) ??
        plistBoolean(item.Managed) ??
        (managementFlags !== undefined && managementFlags > 0),
      name,
      version,
      shortVersion,
      bundleSize,
      dynamicSize,
    };

    applications.set(bundleId, report);
  }

  return [...applications.values()];
};
