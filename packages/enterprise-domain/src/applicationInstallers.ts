/**
 * Installer selection for a device.
 *
 * An application can carry several installers: different versions, native
 * packages versus store listings, and artefacts that only run on a minimum OS
 * or need a capability the device reports. The MDM layer calls this before
 * building a command so the device receives the best artefact it can actually
 * install, rather than the first row in the catalogue.
 */

import { Schema } from "effect";

export type InstallerCandidate = {
  readonly id: string;
  readonly platform: "apple" | "win" | "android";
  readonly source: "manifest" | "store" | "upload";
  readonly version?: string | null;
  readonly minOsVersion?: string | null;
  readonly requiredCapability?: string | null;
  readonly priority: number;
};

export type DeviceCapabilities = {
  readonly proto: "apple" | "win" | "android";
  readonly osVersion?: string | null;
  readonly capabilities?: ReadonlyArray<string> | null;
};

const segments = (value: string): Array<number | string> =>
  value
    .trim()
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));

/** Compare two dotted versions; non-numeric segments compare lexically. */
export const compareVersions = (
  left: string | null | undefined,
  right: string | null | undefined,
) => {
  if (!left && !right) return 0;

  if (!left) return -1;

  if (!right) return 1;

  const a = segments(left);
  const b = segments(right);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index++) {
    const x = a[index];
    const y = b[index];

    if (x === undefined) return y === 0 ? 0 : -1;

    if (y === undefined) return x === 0 ? 0 : 1;

    if (x === y) continue;

    if (Schema.is(Schema.Number)(x) && Schema.is(Schema.Number)(y)) return x - y;

    return String(x).localeCompare(String(y));
  }

  return 0;
};

const meetsMinimum = (
  deviceVersion: string | null | undefined,
  minimum: string | null | undefined,
) => {
  if (!minimum) return true;

  // An unreported OS version cannot prove the minimum; use the installer that
  // has no minimum instead of guessing.
  if (!deviceVersion) return false;

  return compareVersions(deviceVersion, minimum) >= 0;
};

const hasCapability = (device: DeviceCapabilities, capability: string) =>
  (device.capabilities ?? []).some(
    (reported) => reported.trim().toLowerCase() === capability.trim().toLowerCase(),
  );

/**
 * Preference order shared by selection and catalogue listings: priority, then
 * the highest version, then id for a deterministic result.
 */
export const compareInstallerPreference = <T extends InstallerCandidate>(left: T, right: T) =>
  right.priority - left.priority ||
  compareVersions(right.version, left.version) ||
  left.id.localeCompare(right.id);

/**
 * Choose the best installer for one device.
 *
 * Order: installer priority (descending), then version (descending), then id
 * for a deterministic result. A device that matches nothing is skipped by the
 * caller rather than falling back to an incompatible artefact.
 */
export const selectInstaller = <T extends InstallerCandidate>(
  installers: ReadonlyArray<T>,
  device: DeviceCapabilities,
): T | undefined =>
  installers
    .filter(
      (installer) =>
        installer.platform === device.proto &&
        meetsMinimum(device.osVersion, installer.minOsVersion) &&
        (!installer.requiredCapability || hasCapability(device, installer.requiredCapability)),
    )
    .sort(compareInstallerPreference)[0];

/** Human-readable reason a device cannot use any of an application's installers. */
export const installerSkipReason = (
  installers: ReadonlyArray<InstallerCandidate>,
  device: DeviceCapabilities,
): string | undefined => {
  if (installers.length === 0) return "the application has no installers";

  if (!installers.some((installer) => installer.platform === device.proto))
    return `no installer targets ${device.proto}`;

  if (!installers.some((installer) => meetsMinimum(device.osVersion, installer.minOsVersion)))
    return `no installer supports ${device.proto} ${device.osVersion ?? "with an unknown OS version"}`;

  if (
    !installers.some(
      (installer) =>
        !installer.requiredCapability || hasCapability(device, installer.requiredCapability),
    )
  )
    return "the device did not report a required capability";

  return undefined;
};
