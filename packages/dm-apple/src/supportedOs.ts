import {
  APPLE_DECLARATIVE_PROTOCOL_SUPPORT,
  APPLE_SUPPORTED_OS,
  type AppleSupportedOs,
} from "./generated/supportedOs.js";

/**
 * Apple payload/declaration OS support.
 *
 * Apple publishes `supportedOS` for every payload and declaration type. Policy
 * delivery consults it so a configuration authored for a newer OS is not sent
 * to a device that cannot apply it, and so the designer's OS label is a
 * guarantee the delivery path actually keeps.
 *
 * This lives in the protocol package because the managed Worker imports it at
 * request time; the generated policy schemas are not bundled into the Worker.
 */

/**
 * Apple OS families Mattrax reasons about. `iPadOS` is folded into `iOS`
 * because Apple's schemas only carry an iOS entry for iPad payloads; devices
 * report `iPadOS` as their marketing name.
 */
export type AppleOsFamily = "iOS" | "macOS" | "tvOS" | "visionOS" | "watchOS";

const FAMILY_BY_MARKETING_NAME: ReadonlyArray<[RegExp, AppleOsFamily]> = [
  [/^ipados/i, "iOS"],
  [/^ios/i, "iOS"],
  [/^macos/i, "macOS"],
  [/^tvos/i, "tvOS"],
  [/^visionos/i, "visionOS"],
  [/^watchos/i, "watchOS"],
];

/** Numeric comparison of dotted OS versions (`14.10` sorts above `14.9`). */
export const compareOsVersion = (left: string, right: string): number => {
  const parse = (value: string) =>
    value
      .trim()
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));

  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);

    if (difference !== 0) return difference;
  }

  return 0;
};

/**
 * Resolve an OS family from the marketing name a device reports
 * (`device.operating-system.marketing-name`). Returns null when the string is
 * not an Apple OS, which keeps the caller from guessing.
 */
export const appleOsFamily = (marketingName: string | null | undefined): AppleOsFamily | null => {
  const name = marketingName?.trim();

  if (!name) return null;

  for (const [pattern, family] of FAMILY_BY_MARKETING_NAME) if (pattern.test(name)) return family;

  return null;
};

/**
 * Minimum OS version an Apple payload/declaration type supports, optionally
 * narrowed to one family. Returns null when Apple publishes no support data
 * (custom payloads and anything not generated from the schemas).
 */
export const applePayloadMinimumOs = (
  identifier: string,
  family?: AppleOsFamily,
): string | null => {
  const supported = APPLE_SUPPORTED_OS[identifier];

  if (!supported) return null;

  if (family) {
    const entry = supported[family] ?? (family === "iOS" ? supported.iPadOS : undefined);

    return entry?.introduced ?? null;
  }

  const versions = Object.values(supported).map((entry) => entry.introduced);

  if (versions.length === 0) return null;

  return versions.sort(compareOsVersion)[0] ?? null;
};

/** The OS versions a payload/declaration type supports, for display. */
export const applePayloadOsVersions = (identifier: string): ReadonlyArray<string> => {
  const supported = APPLE_SUPPORTED_OS[identifier];

  return supported ? Object.keys(supported) : [];
};

/**
 * Minimum OS version that supports the Declarative Management engine itself.
 * A device below this version cannot apply a declaration, whatever else it
 * reports.
 */
export const appleDeclarativeMinimumOs = (family: AppleOsFamily): string | null =>
  APPLE_DECLARATIVE_PROTOCOL_SUPPORT[family]?.introduced ??
  (family === "iOS" ? (APPLE_DECLARATIVE_PROTOCOL_SUPPORT.iPadOS?.introduced ?? null) : null);

export type AppleSupportResult =
  | { readonly supported: true }
  | {
      readonly supported: false;
      /** `os-version` when the device is too old, `os-family` when Apple does not support the family. */
      readonly reason: "os-version" | "os-family" | "removed";
      readonly minimum?: string;
      readonly removedIn?: string;
    };

/**
 * Whether a device OS can apply a payload/declaration type.
 *
 * A missing family or version is treated as supported: the delivery path must
 * not silently drop a configuration because inventory has not arrived yet.
 */
export const applePayloadSupportForDevice = (
  identifier: string,
  device: { readonly family: AppleOsFamily | null; readonly version: string | null },
): AppleSupportResult => {
  const supported: AppleSupportedOs | undefined = APPLE_SUPPORTED_OS[identifier];

  if (!supported || !device.family) return { supported: true };

  const entry =
    supported[device.family] ?? (device.family === "iOS" ? supported.iPadOS : undefined);

  if (!entry) return { supported: false, reason: "os-family" };

  if (!device.version) return { supported: true };

  if (entry.removed && compareOsVersion(device.version, entry.removed) >= 0)
    return { supported: false, reason: "removed", removedIn: entry.removed };

  if (compareOsVersion(device.version, entry.introduced) < 0)
    return { supported: false, reason: "os-version", minimum: entry.introduced };

  return { supported: true };
};
