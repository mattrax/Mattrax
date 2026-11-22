import { appleOsFamily, applePayloadSupportForDevice, compareOsVersion } from "@mattrax/dm-apple";
import { Option, Schema } from "effect";
import { configurationPayloadTypes, parseConfigurationKind } from "./policy.ts";

/**
 * OS scoping for policy delivery.
 *
 * A configuration authored for a newer OS must not be delivered to a device
 * that cannot apply it: Apple either rejects the declaration or ignores keys,
 * and either way the policy's label promises something the device never got.
 * This module turns Apple's `supportedOS` metadata (and Windows' minimum build
 * metadata, where the designer recorded it) into a per-device filter.
 */

export type ConfigurationDelivery = {
  readonly policyId: string;
  readonly kind: string;
  readonly data: Schema.Json | undefined;
  readonly hash: string;
  /** Group or direct assignment key, preserved from the resolver result. */
  readonly groupId: string;
  readonly organizationId?: string;
};

export type SkippedConfiguration = {
  readonly policyId: string;
  readonly kind: string;
  readonly reason: string;
};

export type OsScopedConfigurations<T extends ConfigurationDelivery> = {
  readonly delivered: ReadonlyArray<T>;
  readonly skipped: ReadonlyArray<SkippedConfiguration>;
};

export type PolicyDeliveryDevice = {
  readonly proto: string;
  readonly osEdition?: string | null;
  readonly osVersion?: string | null;
  readonly osBuild?: string | null;
};

const appleDeviceOs = (device: PolicyDeliveryDevice) => ({
  family: appleOsFamily(device.osEdition),
  version: device.osVersion?.trim() || null,
});

/** A designer-authored Windows node, as stored in `mttx.windows.custom.<id>`. */
const WindowsNode = Schema.Struct({
  omaUri: Schema.optional(Schema.String),
  value: Schema.optional(Schema.Json),
  format: Schema.optional(Schema.String),
  minOs: Schema.optional(Schema.String),
});

const WindowsPolicy = Schema.Struct({
  nodes: Schema.optional(Schema.Array(Schema.Json)),
});

/** Whether one Windows OMA-URI node declares a minimum build. */
const windowsNodeMinimumBuild = (node: Schema.Json | null | undefined): string | null => {
  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(WindowsNode)(node));
  // Catalogue values carry a trailing `+` (`10.0.19041+`).
  const minimum = decoded?.minOs?.trim().replace(/\+$/, "");

  return minimum ? minimum : null;
};

/**
 * The highest minimum Windows build any node in a designer configuration
 * declares. Used by the scope summary to describe a policy's supported range
 * without re-parsing the payload differently from delivery.
 */
export const windowsConfigurationMinimumBuild = (data: Schema.Json | undefined): string | null => {
  if (data === undefined) return null;
  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(WindowsPolicy)(data));
  const nodes = decoded?.nodes ?? [data];
  let minimum: string | null = null;

  for (const node of nodes) {
    const candidate = windowsNodeMinimumBuild(node);

    if (candidate && (minimum === null || compareOsVersion(candidate, minimum) > 0))
      minimum = candidate;
  }

  return minimum;
};

/**
 * Windows metadata records `minimumSupportedVersion` as a full version
 * (`10.0.22000`). Compare against the reported OS version, falling back to the
 * build number when that is all the device sent.
 */
const windowsVersion = (device: PolicyDeliveryDevice): string | null => {
  const version = device.osVersion?.trim();

  if (version && version.split(".").length >= 3) return version;

  return device.osBuild?.trim() || version || null;
};

const windowsSupport = (
  data: Schema.Json | undefined,
  device: PolicyDeliveryDevice,
): SkippedConfiguration["reason"] | null => {
  if (data === undefined) return null;

  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(WindowsPolicy)(data));
  const nodes = decoded?.nodes ?? [data];
  const version = windowsVersion(device);

  if (!version) return null;

  for (const node of nodes) {
    const minimum = windowsNodeMinimumBuild(node);

    if (minimum && compareOsVersion(version, minimum) < 0)
      return `The setting requires Windows build ${minimum} or later`;
  }

  return null;
};

/**
 * Filter resolved configurations to the ones the device can actually apply.
 *
 * `mode` matters for Apple certificates: in DDM they are a
 * `com.apple.configuration.security.certificate` declaration (macOS 14/iOS 17),
 * while the legacy path installs a `com.apple.security.pkcs1` profile.
 */
export const scopeConfigurationsToDevice = async <T extends ConfigurationDelivery>(
  configurations: ReadonlyArray<T>,
  device: PolicyDeliveryDevice,
  mode: "ddm" | "legacy" | "none",
): Promise<OsScopedConfigurations<T>> => {
  const delivered: T[] = [];
  const skipped: SkippedConfiguration[] = [];
  const apple = appleDeviceOs(device);

  for (const configuration of configurations) {
    if (device.proto === "win") {
      const problem = windowsSupport(configuration.data, device);

      if (problem) {
        skipped.push({
          policyId: configuration.policyId,
          kind: configuration.kind,
          reason: problem,
        });
        continue;
      }

      delivered.push(configuration);
      continue;
    }

    if (device.proto !== "apple") {
      delivered.push(configuration);
      continue;
    }

    const parsed = parseConfigurationKind(configuration.kind);

    // Apple publishes the lock screen message as a profile for supervised
    // iPhone/iPadOS only. Other Apple families must not claim support.
    if (parsed.type === "lockScreenMessage") {
      const family = appleDeviceOs(device).family;

      if (family !== null && family !== "iOS") {
        skipped.push({
          policyId: configuration.policyId,
          kind: configuration.kind,
          reason: "the lock screen message is only available on supervised iPhone and iPadOS",
        });
        continue;
      }

      delivered.push(configuration);
      continue;
    }

    if (parsed.type === "certificate" && mode === "legacy") {
      delivered.push(configuration);
      continue;
    }

    const payloadTypes = await configurationPayloadTypes(
      configuration.kind,
      configuration.data ?? null,
    );

    if (payloadTypes.length === 0) {
      delivered.push(configuration);
      continue;
    }

    let problem: SkippedConfiguration["reason"] | null = null;

    for (const payloadType of payloadTypes) {
      const support = applePayloadSupportForDevice(payloadType, apple);

      if (support.supported) continue;

      if (support.reason === "os-family") {
        problem = `${payloadType} is not supported on ${device.osEdition ?? "this device"}`;
        break;
      }

      if (support.reason === "removed") {
        problem = `${payloadType} was removed in ${support.removedIn}`;
        break;
      }

      problem = `${payloadType} requires ${apple.family ?? "an Apple OS"} ${support.minimum} or later`;
      break;
    }

    if (problem) {
      skipped.push({ policyId: configuration.policyId, kind: configuration.kind, reason: problem });
      continue;
    }

    delivered.push(configuration);
  }

  return { delivered, skipped };
};

/** Human summary of what a device cannot receive, for the delivery decision. */
export const describeSkippedConfigurations = (
  skipped: ReadonlyArray<SkippedConfiguration>,
): string | null => {
  if (skipped.length === 0) return null;

  const first = skipped[0];

  return skipped.length === 1
    ? `1 configuration is not delivered because ${first.reason}.`
    : `${skipped.length} configurations are not delivered because of the device's OS version (${first.reason}).`;
};
