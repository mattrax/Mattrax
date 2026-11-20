import { Option, Schema } from "effect";
import { SoftwareUpdateInfo, type SoftwareUpdateStatus } from "@mattrax/enterprise-domain/client";

export { softwareUpdateReason } from "@mattrax/enterprise-domain/client";

const decodeSoftwareUpdateInfo = Schema.decodeUnknownOption(SoftwareUpdateInfo);

/**
 * Device payloads carry the update status as an opaque JSON value so the
 * shared `DeviceRow` schema stays small enough for the generated API client.
 * Decode it once here instead of teaching every caller the field shape.
 */
export const decodeSoftwareUpdate = (
  value: Schema.Json | undefined,
): SoftwareUpdateInfo | undefined => Option.getOrUndefined(decodeSoftwareUpdateInfo(value));

/** Short label for a badge; unknown/uncovered platforms return `null`. */
export const softwareUpdateLabel = (info: SoftwareUpdateInfo | null | undefined): string | null => {
  switch (info?.status) {
    case "security_update_required":
      return "Security update";
    case "update_available":
      return "Update available";
    case "up_to_date":
      return "Up to date";
    case "unknown":
      return info.code === "platform_unsupported" ? null : "Unknown";
    default:
      return null;
  }
};

/** True when the row is a macOS device the feed tried to evaluate. */
export const isMacOsUpdateTracked = (info: SoftwareUpdateInfo | null | undefined): boolean =>
  Boolean(info && info.code !== "platform_unsupported");

export type { SoftwareUpdateInfo, SoftwareUpdateStatus };
