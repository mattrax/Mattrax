import {
  appleDeclarativeMinimumOs,
  appleOsFamily,
  compareOsVersion,
  type AppleOsFamily,
} from "@mattrax/dm-apple";
import { Option, Schema } from "effect";

/**
 * How an Apple device receives policy.
 *
 * Declarative management is only available from macOS 13 / iOS 15 and only when
 * the client advertises declarative configuration support. A device that fails
 * either check is put on the legacy path: Mattrax installs the policy's legacy
 * kinds as `.mobileconfig` profiles through classic `InstallProfile` commands
 * instead of returning a `DdmSync` the device cannot apply.
 */
export type AppleDeliveryMode = "ddm" | "legacy";

export type AppleDeliveryDecision = {
  readonly mode: AppleDeliveryMode;
  /** Operator-facing explanation, stored on the device for support. */
  readonly reason: string;
};

const DECLARATIVE_CONFIGURATION_PREFIX = "com.apple.configuration.";

const DeclarationsCapability = Schema.Struct({
  configurations: Schema.optional(Schema.Array(Schema.String)),
});

const PayloadsCapability = Schema.Struct({
  declarations: Schema.optional(DeclarationsCapability),
  "status-items": Schema.optional(Schema.Array(Schema.String)),
  statusItems: Schema.optional(Schema.Array(Schema.String)),
  status_items: Schema.optional(Schema.Array(Schema.String)),
});

/**
 * `management.client-capabilities` is reported as the dictionary Apple
 * documents (`supported-versions`, `supported-payloads.declarations`) but some
 * clients flatten the key names. Both spellings are accepted.
 */
const ClientCapabilities = Schema.Struct({
  "supported-versions": Schema.optional(Schema.Array(Schema.String)),
  supportedVersions: Schema.optional(Schema.Array(Schema.String)),
  supported_versions: Schema.optional(Schema.Array(Schema.String)),
  "supported-payloads": Schema.optional(PayloadsCapability),
  supportedPayloads: Schema.optional(PayloadsCapability),
  supported_payloads: Schema.optional(PayloadsCapability),
});

export type AppleCapabilitySupport = "supported" | "unsupported" | "unknown";

export type AppleCapabilityReport = {
  readonly support: AppleCapabilitySupport;
  readonly detail: string;
};

/**
 * Whether the client advertises declarative configuration support.
 *
 * `unknown` means the capability item has not been reported (or the value is not
 * the documented dictionary); `unsupported` is positive evidence that the client
 * cannot apply declarations.
 */
export const appleDeclarativeCapability = (
  capabilities: Schema.Json | null | undefined,
): AppleCapabilityReport => {
  const decoded = Option.getOrUndefined(
    Schema.decodeUnknownOption(ClientCapabilities)(capabilities),
  );

  if (!decoded) return { support: "unknown", detail: "no client capability report" };

  const payloads =
    decoded["supported-payloads"] ?? decoded.supportedPayloads ?? decoded.supported_payloads;

  const versions =
    decoded["supported-versions"] ?? decoded.supportedVersions ?? decoded.supported_versions ?? [];

  const configurations = payloads?.declarations?.configurations ?? [];

  if (configurations.length === 0 && versions.length === 0)
    return { support: "unknown", detail: "the capability report has no declarative section" };

  if (configurations.length === 0)
    return {
      support: "unsupported",
      detail: "the client advertises no declarative configuration types",
    };

  const declarative = configurations.filter((type) =>
    type.startsWith(DECLARATIVE_CONFIGURATION_PREFIX),
  );

  if (declarative.length === 0)
    return {
      support: "unsupported",
      detail: `the client supports ${configurations.slice(0, 3).join(", ")} but no com.apple.configuration types`,
    };

  return {
    support: "supported",
    detail: `${declarative.length} declarative configuration type${declarative.length === 1 ? "" : "s"}`,
  };
};

const formatOs = (family: AppleOsFamily, version: string) => `${family} ${version}`;

/**
 * Decide the policy delivery path from the OS version and the client's
 * advertised capabilities.
 *
 * Missing evidence is not treated as "unsupported": a freshly enrolled device
 * has an OS version from `Authenticate` but may not have reported capabilities
 * yet, and flipping it to legacy would install profiles that are then replaced
 * by declarations. Only positive evidence of a missing capability or an OS
 * older than the declarative minimum selects the legacy path.
 */
export const decideAppleDelivery = (device: {
  readonly capabilities?: Schema.Json | null;
  readonly osEdition?: string | null;
  readonly osVersion?: string | null;
}): AppleDeliveryDecision => {
  const family = appleOsFamily(device.osEdition);
  const version = device.osVersion?.trim() || null;
  const capability = appleDeclarativeCapability(device.capabilities);

  if (capability.support === "unsupported")
    return {
      mode: "legacy",
      reason: `Legacy profile delivery: ${capability.detail}.`,
    };

  if (family && version) {
    const minimum = appleDeclarativeMinimumOs(family);

    if (minimum && compareOsVersion(version, minimum) < 0)
      return {
        mode: "legacy",
        reason: `Legacy profile delivery: ${formatOs(family, version)} is older than the declarative management minimum (${formatOs(family, minimum)}).`,
      };

    if (!minimum)
      return {
        mode: "legacy",
        reason: `Legacy profile delivery: Apple publishes no declarative management support for ${family}.`,
      };

    return {
      mode: "ddm",
      reason:
        capability.support === "supported"
          ? `Declarative management: ${formatOs(family, version)}, ${capability.detail}.`
          : `Declarative management: ${formatOs(family, version)} supports declarations; the capability report has not arrived yet.`,
    };
  }

  if (capability.support === "supported")
    return {
      mode: "ddm",
      reason: `Declarative management: ${capability.detail} (OS version not reported yet).`,
    };

  return {
    mode: "ddm",
    reason:
      "Declarative management: neither the OS version nor the client capability report is available yet; delivery keeps the declarative path until one reports.",
  };
};

/** Whether a mode transition needs to republish declarations or profiles. */
export const appleDeliveryModeChanged = (
  previous: { readonly mode?: string | null; readonly reason?: string | null } | undefined,
  next: AppleDeliveryDecision,
): boolean => previous?.mode !== next.mode || previous?.reason !== next.reason;
