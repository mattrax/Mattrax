import { Option, Schema } from "effect";
import {
  OsComplianceInfo,
  osComplianceLabel,
  osComplianceReasonText,
} from "@mattrax/enterprise-domain/client";
import type { OsComplianceStatus } from "@mattrax/enterprise-domain/client";

export { osComplianceLabel, osComplianceReasonText };

const decode = Schema.decodeUnknownOption(OsComplianceInfo);

/**
 * Device payloads carry compliance as an optional JSON value so the shared
 * DeviceRow schema stays small. Decode it once here.
 */
export const decodeOsCompliance = (value: Schema.Json | undefined): OsComplianceInfo | undefined =>
  Option.getOrUndefined(decode(value));

export type OsComplianceTone = {
  readonly variant: "success" | "warning" | "destructive" | "info" | "outline";
  readonly dot: "success" | "warning" | "destructive" | "info" | "neutral";
};

export const osComplianceTone = (status: OsComplianceStatus): OsComplianceTone => {
  switch (status) {
    case "compliant":
      return { variant: "success", dot: "success" };
    case "update-available":
      return { variant: "info", dot: "info" };
    case "below-minimum":
      return { variant: "warning", dot: "warning" };
    default:
      return { variant: "outline", dot: "neutral" };
  }
};

/** Why a device is in the "behind" list, for compact table copy. */
export const osComplianceShortReason = (info: OsComplianceInfo): string => {
  switch (info.reason) {
    case "below_minimum":
      return info.minimumVersion ? `Below ${info.minimumVersion}` : "Below the minimum";
    case "deferral_active":
      return "Deferred";
    case "update_available":
      return info.targetVersion ? `${info.targetVersion} available` : "Update available";
    case "up_to_date":
      return "Up to date";
    case "up_to_date_minimum_only":
      return "Meets minimum";
    case "version_unknown":
      return "No version reported";
    case "feed_unavailable":
    case "feed_disabled":
      return "Update feed unavailable";
    case "version_not_in_feed":
      return "Not in update feed";
    case "comparison_failed":
      return "Version not comparable";
    case "platform_not_covered":
      return "Platform not covered";
    case "policy_off":
      return "Policy off";
    case "policy_not_configured":
      return "No minimum set";
  }
};
