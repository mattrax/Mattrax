/**
 * Tenant OS update policy and per-device compliance.
 *
 * The product already knows which macOS release Apple published (the SOFA feed
 * in `softwareUpdates.ts`). This module adds the operator's own rule: for each
 * platform family they may set a minimum version, whether that minimum is
 * merely reported (`warn`) or acted on (`enforce`), and a deferral window that
 * gives devices time to update before they are counted as non-compliant.
 *
 * Three properties drive the design:
 *
 * - **Version comparison is shared.** Both the minimum check and the SOFA
 *   comparison use `compareVersionStrings`, so `14.10` is newer than `14.9`
 *   everywhere in the product.
 * - **Unknown is never compliant.** A device with no reported version, an
 *   unparseable version, or a macOS device the feed could not evaluate is
 *   `unknown`. Only a positive comparison makes a device compliant.
 * - **Enforcement honesty.** Windows and Android have no MDM setting that
 *   enforces a minimum OS version. Their capabilities say so, and the
 *   compliance result distinguishes "meets the minimum we can check" from "we
 *   know this is the latest release". macOS update knowledge comes from SOFA;
 *   Windows and Android update knowledge is explicitly unknown.
 */

import { Schema } from "effect";
import { isMacOsDevice } from "./deviceHealth.js";
import { compareVersionStrings } from "./deviceQuery.js";
import {
  deriveSoftwareUpdate,
  SoftwareUpdateFeedInfo,
  type MacOsUpdateCatalog,
} from "./softwareUpdates.js";

/**
 * The platform families a tenant policy can target.
 *
 * Apple devices are split at the family boundary: iOS, iPadOS, tvOS, watchOS
 * and visionOS do not share macOS's version numbering or its update feed, so a
 * single "Apple minimum" would compare unrelated versions. Only macOS is
 * covered today.
 */
export const OS_POLICY_PLATFORMS = ["macos", "windows", "android"] as const;

export const OsPolicyPlatform = Schema.Literals(OS_POLICY_PLATFORMS);

export type OsPolicyPlatform = typeof OsPolicyPlatform.Type;

/**
 * `warn` reports non-compliance without changing any device. `enforce` also
 * applies the platform's remediation (see `OS_POLICY_CAPABILITIES`).
 */
export const OS_ENFORCEMENT_MODES = ["off", "warn", "enforce"] as const;

export const OsEnforcementMode = Schema.Literals(OS_ENFORCEMENT_MODES);

export type OsEnforcementMode = typeof OsEnforcementMode.Type;

export const OS_COMPLIANCE_STATUSES = [
  "compliant",
  "update-available",
  "below-minimum",
  "unknown",
] as const;

export const OsComplianceStatus = Schema.Literals(OS_COMPLIANCE_STATUSES);

export type OsComplianceStatus = typeof OsComplianceStatus.Type;

/**
 * Stable reason codes. The UI explains a status from these, so wording can
 * change without changing counts, filters or tests.
 */
export const OS_COMPLIANCE_REASONS = [
  "up_to_date",
  "up_to_date_minimum_only",
  "update_available",
  "below_minimum",
  "deferral_active",
  "policy_off",
  "policy_not_configured",
  "platform_not_covered",
  "version_unknown",
  "version_not_in_feed",
  "comparison_failed",
  "feed_unavailable",
  "feed_disabled",
] as const;

export const OsComplianceReason = Schema.Literals(OS_COMPLIANCE_REASONS);

export type OsComplianceReason = typeof OsComplianceReason.Type;

/** Longest version string accepted from an operator or a device. */
export const MAX_OS_VERSION_LENGTH = 64;

/** A platform minimum may not defer longer than a year. */
export const MAX_OS_DEFERRAL_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1_000;

/** The persisted rule for one platform. */
export type OsPolicyRule = {
  readonly platform: OsPolicyPlatform;
  /** `null` means no minimum is configured for this platform. */
  readonly minimumVersion: string | null;
  readonly enforcement: OsEnforcementMode;
  /** Grace period after the rule was last saved, in days. */
  readonly deferralDays: number;
  /** When the rule last changed; the anchor for the deferral window. */
  readonly updatedAt: Date;
};

export type OsPolicyRuleInput = {
  readonly platform: OsPolicyPlatform;
  readonly minimumVersion?: string | null;
  readonly enforcement?: OsEnforcementMode;
  readonly deferralDays?: number;
  readonly updatedAt: Date;
};

/**
 * Normalise an operator-entered minimum version.
 *
 * Accepts a dotted integer version, optionally labelled with its platform
 * ("macOS 14.6"). Marketing strings ("Sonoma") and partial versions are
 * rejected instead of guessed at: a guessed minimum would mark devices
 * compliant against a version the operator never chose.
 */
export const normalizeMinimumVersion = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;

  const trimmed = value.trim();

  if (trimmed.length === 0) return null;

  const withoutLabel = trimmed.replace(/^(macos|mac os|os x|windows|android)\s+/i, "");

  if (withoutLabel.length > MAX_OS_VERSION_LENGTH) return null;

  if (!/^\d+(?:\.\d+)*$/.test(withoutLabel)) return null;

  const major = Number.parseInt(withoutLabel, 10);

  return Number.isSafeInteger(major) && major > 0 ? withoutLabel : null;
};

const isValidVersion = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^\d+(?:\.\d+)*$/.test(value.trim());

const clampDeferralDays = (value: number): number => {
  if (!Number.isFinite(value)) return 0;

  return Math.min(Math.max(Math.trunc(value), 0), MAX_OS_DEFERRAL_DAYS);
};

/** The deferral deadline for a rule, or `null` when it does not defer. */
export const osPolicyDeferralEndsAt = (rule: OsPolicyRule): Date | null => {
  const days = clampDeferralDays(rule.deferralDays);

  // A window only exists while a minimum is applied; an `off` rule keeps its
  // last deferral value but has no deadline to show.
  if (
    days <= 0 ||
    rule.enforcement === "off" ||
    normalizeMinimumVersion(rule.minimumVersion) === null
  )
    return null;

  return new Date(rule.updatedAt.getTime() + days * DAY_MS);
};

export type OsPolicyDeviceInput = {
  readonly proto?: string | null;
  readonly osVersion?: string | null;
  readonly osEdition?: string | null;
  readonly model?: string | null;
};

/** The platform family a device belongs to, or `null` when none applies. */
export const osPolicyPlatformForDevice = (device: OsPolicyDeviceInput): OsPolicyPlatform | null => {
  switch (device.proto) {
    case "win":
      return "windows";
    case "android":
      return "android";
    case "apple":
      return isMacOsDevice(device) ? "macos" : null;
    default:
      return null;
  }
};

/** The rule that applies to a device, if its family is configured. */
export const osPolicyRuleForDevice = (
  rules: ReadonlyArray<OsPolicyRule>,
  device: OsPolicyDeviceInput,
): OsPolicyRule | null => {
  const platform = osPolicyPlatformForDevice(device);

  if (!platform) return null;

  return rules.find((rule) => rule.platform === platform) ?? null;
};

/** The effective minimum: enforcement `off` means no minimum is applied. */
export const effectiveOsMinimumVersion = (rule: OsPolicyRule | null | undefined): string | null => {
  if (!rule || rule.enforcement === "off") return null;

  return normalizeMinimumVersion(rule.minimumVersion);
};

export type OsPolicyCapability = {
  readonly platform: OsPolicyPlatform;
  /** The platform API can enforce a minimum version, not just report it. */
  readonly minimumVersionEnforced: boolean;
  /** A deferral/grace window is honoured by the platform. */
  readonly deferralEnforced: boolean;
  /** Remediation is applied without an operator pressing a button. */
  readonly automatic: boolean;
  /** Stable identifier of the mechanism, for the UI and audit trail. */
  readonly mechanism: "schedule-os-update" | "windows-update-ring" | "android-system-update";
  /** Human-readable description of what `enforce` actually does. */
  readonly description: string;
  /** What the platform cannot do, so the UI never promises it. */
  readonly limitation: string;
};

/**
 * What each platform can actually do.
 *
 * This table is the single source of truth for the enforcement copy in the UI
 * and for the remediation generators below. It exists because "enforce" means
 * something different on every platform, and on two of them it does not mean
 * "minimum version".
 */
export const OS_POLICY_CAPABILITIES: Readonly<Record<OsPolicyPlatform, OsPolicyCapability>> = {
  macos: {
    platform: "macos",
    minimumVersionEnforced: true,
    deferralEnforced: true,
    automatic: false,
    mechanism: "schedule-os-update",
    description:
      "Enforce queues Apple's ScheduleOSUpdate command, which installs the latest available macOS update. The deferral window sets how long a user may postpone it.",
    limitation:
      "Apple does not accept an absolute deadline in ScheduleOSUpdate, and the command is delivered on the device's next check-in. Mattrax does not queue it automatically; use Apply update on the OS versions page.",
  },
  windows: {
    platform: "windows",
    minimumVersionEnforced: false,
    deferralEnforced: true,
    automatic: true,
    mechanism: "windows-update-ring",
    description:
      "Enforce delivers Windows Update for Business settings: automatic updates on, a quality-update deferral and an install deadline derived from the grace window.",
    limitation:
      "Windows has no MDM setting that enforces a minimum OS version. The minimum remains a compliance check; only the update ring and deadline are applied.",
  },
  android: {
    platform: "android",
    minimumVersionEnforced: false,
    deferralEnforced: false,
    automatic: true,
    mechanism: "android-system-update",
    description:
      "Enforce sets the Android Management API systemUpdate policy to AUTO, so the device installs system updates automatically.",
    limitation:
      "Android has no minimum-version policy and its systemUpdate policy cannot express a deferral deadline. The minimum remains a compliance check.",
  },
};

export const osPolicyCapability = (platform: OsPolicyPlatform): OsPolicyCapability =>
  OS_POLICY_CAPABILITIES[platform];

export type OsUpdateKnowledge = "known" | "unknown";

/** One device's compliance result. */
export const OsComplianceInfo = Schema.Struct({
  status: OsComplianceStatus,
  reason: OsComplianceReason,
  platform: Schema.NullOr(OsPolicyPlatform),
  currentVersion: Schema.NullOr(Schema.String),
  /** The configured minimum, when the rule applies. */
  minimumVersion: Schema.NullOr(Schema.String),
  /** The version that would make this device compliant (or the available update). */
  targetVersion: Schema.NullOr(Schema.String),
  /** Newest release the feed knows about, independent of the minimum. */
  latestVersion: Schema.NullOr(Schema.String),
  enforcement: OsEnforcementMode,
  /** True when an active minimum rule is being applied by the platform. */
  enforced: Schema.Boolean,
  /** Whether newer-release knowledge is known for this platform. */
  updateKnowledge: Schema.Literals(["known", "unknown"]),
  /** ISO timestamp when an active deferral ends, otherwise null. */
  deferralEndsAt: Schema.NullOr(Schema.String),
});

export type OsComplianceInfo = typeof OsComplianceInfo.Type;

const unknown = (input: {
  readonly reason: OsComplianceReason;
  readonly platform?: OsPolicyPlatform | null;
  readonly currentVersion?: string | null;
  readonly minimumVersion?: string | null;
  readonly latestVersion?: string | null;
  readonly enforcement?: OsEnforcementMode;
  readonly deferralEndsAt?: string | null;
}): OsComplianceInfo => ({
  status: "unknown",
  reason: input.reason,
  platform: input.platform ?? null,
  currentVersion: input.currentVersion ?? null,
  minimumVersion: input.minimumVersion ?? null,
  targetVersion: null,
  latestVersion: input.latestVersion ?? null,
  enforcement: input.enforcement ?? "off",
  enforced: false,
  updateKnowledge: "unknown",
  deferralEndsAt: input.deferralEndsAt ?? null,
});

const isoOrNull = (value: Date | null): string | null => (value ? value.toISOString() : null);

export type DeriveOsComplianceOptions = {
  /** Injectable clock so deferral boundaries are testable. */
  readonly now?: Date;
  /** macOS support window used by the SOFA comparison. */
  readonly supportedMajorCount?: number;
};

/**
 * Derive one device's OS compliance.
 *
 * Order matters:
 *
 * 1. A device whose family is not covered is `unknown`, never compliant.
 * 2. A missing or unparseable version is `unknown`.
 * 3. The configured minimum is checked first. A device inside an active
 *    deferral window is `update-available` (deferred), not `below-minimum`.
 * 4. macOS then consults SOFA for newer security releases and major upgrades.
 *    Windows and Android have no feed, so meeting their minimum is
 *    `compliant` with `updateKnowledge: "unknown"`.
 */
export const deriveOsCompliance = (
  device: OsPolicyDeviceInput,
  rules: ReadonlyArray<OsPolicyRule>,
  catalog: MacOsUpdateCatalog | null | undefined,
  options: DeriveOsComplianceOptions = {},
): OsComplianceInfo => {
  const platform = osPolicyPlatformForDevice(device);
  const rule = platform ? (rules.find((entry) => entry.platform === platform) ?? null) : null;

  if (!platform)
    return unknown({
      reason: "platform_not_covered",
      currentVersion: device.osVersion?.trim() || null,
    });

  const enforcement = rule?.enforcement ?? "off";
  const minimum = effectiveOsMinimumVersion(rule);
  const reported = device.osVersion?.trim() || null;
  const now = options.now ?? new Date();

  if (!reported)
    return unknown({
      reason: "version_unknown",
      platform,
      minimumVersion: minimum,
      enforcement,
    });

  const currentVersion = reported;

  if (!isValidVersion(currentVersion))
    return unknown({
      reason: "version_unknown",
      platform,
      currentVersion: reported,
      minimumVersion: minimum,
      enforcement,
    });

  const deferralEndsAt = rule ? osPolicyDeferralEndsAt(rule) : null;
  const deferred = deferralEndsAt !== null && now.getTime() < deferralEndsAt.getTime();
  const deferralIso = isoOrNull(deferralEndsAt);

  if (minimum) {
    const comparison = compareVersionStrings(currentVersion, minimum);

    if (comparison === null)
      return unknown({
        reason: "comparison_failed",
        platform,
        currentVersion,
        minimumVersion: minimum,
        enforcement,
        deferralEndsAt: deferralIso,
      });

    if (comparison < 0) {
      // A deferral only softens the result: the device is still behind, but
      // the operator gave it time. Once the window closes the same comparison
      // reports below-minimum, so there is no hidden state to expire.
      if (deferred)
        return {
          status: "update-available",
          reason: "deferral_active",
          platform,
          currentVersion,
          minimumVersion: minimum,
          targetVersion: minimum,
          latestVersion: null,
          enforcement,
          enforced: false,
          updateKnowledge: "unknown",
          deferralEndsAt: deferralIso,
        };

      return {
        status: "below-minimum",
        reason: "below_minimum",
        platform,
        currentVersion,
        minimumVersion: minimum,
        targetVersion: minimum,
        latestVersion: null,
        enforcement,
        enforced: enforcement === "enforce",
        updateKnowledge: "unknown",
        deferralEndsAt: deferralIso,
      };
    }
  }

  if (platform !== "macos") {
    // No feed exists for Windows or Android. The minimum is the only fact we
    // can check, so the result says exactly that.
    if (!minimum)
      return unknown({
        reason: rule ? "policy_off" : "policy_not_configured",
        platform,
        currentVersion,
        minimumVersion: null,
        enforcement,
        deferralEndsAt: deferralIso,
      });

    return {
      status: "compliant",
      reason: "up_to_date_minimum_only",
      platform,
      currentVersion,
      minimumVersion: minimum,
      targetVersion: minimum,
      latestVersion: null,
      enforcement,
      enforced: false,
      updateKnowledge: "unknown",
      deferralEndsAt: deferralIso,
    };
  }

  const update = deriveSoftwareUpdate(
    device,
    catalog,
    options.supportedMajorCount === undefined
      ? {}
      : { supportedMajorCount: options.supportedMajorCount },
  );

  if (update.status === "unknown") {
    const map: Partial<Record<typeof update.code, OsComplianceReason>> = {
      version_unknown: "version_unknown",
      version_not_in_feed: "version_not_in_feed",
      comparison_failed: "comparison_failed",
      feed_unavailable: "feed_unavailable",
      feed_disabled: "feed_disabled",
    };

    return unknown({
      reason: map[update.code] ?? "feed_unavailable",
      platform,
      currentVersion,
      minimumVersion: minimum,
      latestVersion: update.latestVersion,
      enforcement,
      deferralEndsAt: deferralIso,
    });
  }

  if (update.status === "up_to_date")
    return {
      status: "compliant",
      reason: "up_to_date",
      platform,
      currentVersion,
      minimumVersion: minimum,
      targetVersion: update.latestVersion ?? null,
      latestVersion: update.latestVersion,
      enforcement,
      enforced: false,
      updateKnowledge: "known",
      deferralEndsAt: deferralIso,
    };

  // `security_update_required` and `update_available` both mean the device
  // should move to a newer release; the UI explains which one from the target.
  return {
    status: "update-available",
    reason: "update_available",
    platform,
    currentVersion,
    minimumVersion: minimum,
    targetVersion: update.latestVersion ?? update.requiredMinimumVersion ?? null,
    latestVersion: update.latestVersion,
    enforcement,
    enforced: false,
    updateKnowledge: "known",
    deferralEndsAt: deferralIso,
  };
};

export type OsComplianceCounts = {
  readonly total: number;
  readonly compliant: number;
  readonly updateAvailable: number;
  readonly belowMinimum: number;
  readonly deferred: number;
  readonly unknown: number;
  /** Devices below an enforced minimum. */
  readonly enforcedBelowMinimum: number;
};

export const countOsCompliance = (infos: ReadonlyArray<OsComplianceInfo>): OsComplianceCounts => {
  let compliant = 0;
  let updateAvailable = 0;
  let belowMinimum = 0;
  let deferred = 0;
  let unknown = 0;
  let enforcedBelowMinimum = 0;

  for (const info of infos) {
    switch (info.status) {
      case "compliant":
        compliant += 1;
        break;
      case "update-available":
        updateAvailable += 1;

        if (info.reason === "deferral_active") deferred += 1;

        break;
      case "below-minimum":
        belowMinimum += 1;

        if (info.enforced) enforcedBelowMinimum += 1;

        break;
      case "unknown":
        unknown += 1;
        break;
    }
  }

  return {
    total: infos.length,
    compliant,
    updateAvailable,
    belowMinimum,
    deferred,
    unknown,
    enforcedBelowMinimum,
  };
};

/** Worst-first ordering for the "who is behind" list. */
const STATUS_RANK: Record<OsComplianceStatus, number> = {
  "below-minimum": 0,
  "update-available": 1,
  unknown: 2,
  compliant: 3,
};

export const osComplianceRank = (status: OsComplianceStatus): number => STATUS_RANK[status];

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  count === 1 ? singular : pluralForm;

/** Human-readable explanation used by badges, tooltips and the fleet table. */
export const osComplianceReasonText = (info: OsComplianceInfo): string => {
  switch (info.reason) {
    case "up_to_date":
      return info.latestVersion
        ? `Up to date with ${info.latestVersion}.`
        : "Up to date with the published release.";
    case "up_to_date_minimum_only":
      return info.minimumVersion
        ? `Meets the ${info.minimumVersion} minimum. Newer releases cannot be checked on this platform.`
        : "Meets the configured minimum. Newer releases cannot be checked on this platform.";
    case "update_available":
      return info.targetVersion
        ? `Version ${info.targetVersion} is available.`
        : "A newer release is available.";
    case "below_minimum":
      return info.minimumVersion
        ? `Below the ${info.minimumVersion} minimum.`
        : "Below the configured minimum version.";
    case "deferral_active":
      return info.deferralEndsAt
        ? `Below the minimum, but the deferral window runs until ${info.deferralEndsAt}.`
        : "Below the minimum, but still inside the deferral window.";
    case "policy_off":
      return "OS version policy is switched off for this platform.";
    case "policy_not_configured":
      return "No minimum version is configured for this platform.";
    case "platform_not_covered":
      return "OS version compliance covers macOS, Windows and Android only.";
    case "version_unknown":
      return "The device has not reported a comparable OS version.";
    case "version_not_in_feed":
      return "This macOS version is not in the update feed yet.";
    case "comparison_failed":
      return "The reported OS version could not be compared with the minimum.";
    case "feed_disabled":
      return "The macOS update feed is disabled on this deployment.";
    case "feed_unavailable":
      return "The macOS update feed is unavailable, so newer releases are unknown.";
  }
};

/** Compact badge label; null means the row has no OS status to show. */
export const osComplianceLabel = (info: OsComplianceInfo | null | undefined): string | null => {
  switch (info?.status) {
    case "below-minimum":
      return "Below minimum";
    case "update-available":
      return info.reason === "deferral_active" ? "Update deferred" : "Update available";
    case "compliant":
      return "Compliant";
    case "unknown":
      return info.reason === "platform_not_covered" ? null : "Unknown";
    default:
      return null;
  }
};

export const osComplianceSummaryText = (counts: OsComplianceCounts): string => {
  const parts = [
    counts.belowMinimum > 0
      ? `${counts.belowMinimum} ${plural(counts.belowMinimum, "device")} below minimum`
      : null,
    counts.updateAvailable > 0
      ? `${counts.updateAvailable} ${plural(counts.updateAvailable, "device")} with updates`
      : null,
    counts.unknown > 0 ? `${counts.unknown} ${plural(counts.unknown, "device")} unknown` : null,
  ].filter((value): value is string => value !== null);

  if (parts.length === 0) return "Every evaluated device is compliant.";

  return parts.join(" · ");
};

export const osPolicyRuleFromRow = (row: {
  readonly platform: string;
  readonly minimumVersion: string | null;
  readonly enforcement: string;
  readonly deferralDays: number;
  readonly updatedAt: Date;
}): OsPolicyRule => ({
  platform: OS_POLICY_PLATFORMS.find((platform) => platform === row.platform) ?? "macos",
  minimumVersion: row.minimumVersion,
  enforcement: OS_ENFORCEMENT_MODES.find((enforcement) => enforcement === row.enforcement) ?? "off",
  deferralDays: clampDeferralDays(row.deferralDays),
  updatedAt: row.updatedAt,
});

/** Every platform, with the stored rule or an in-memory default. */
export const completeOsPolicy = (rules: ReadonlyArray<OsPolicyRule>): ReadonlyArray<OsPolicyRule> =>
  OS_POLICY_PLATFORMS.map(
    (platform) =>
      rules.find((rule) => rule.platform === platform) ?? {
        platform,
        minimumVersion: null,
        enforcement: "off",
        deferralDays: 0,
        updatedAt: new Date(0),
      },
  );

/**
 * Windows Update for Business settings generated from a rule.
 *
 * This is an update ring, not a minimum-version enforcement: Windows has no
 * CSP that refuses to run an OS older than a chosen build. The node list says
 * what is actually delivered.
 */
export type WindowsOsUpdateNode = {
  readonly omaUri: string;
  readonly value: string;
  readonly format: "int" | "chr";
};

export const windowsOsUpdatePolicyNodes = (
  rule: OsPolicyRule | null | undefined,
): ReadonlyArray<WindowsOsUpdateNode> => {
  if (!rule || rule.enforcement !== "enforce") return [];

  const deferralDays = clampDeferralDays(rule.deferralDays);

  const nodes: WindowsOsUpdateNode[] = [
    // 2 = auto install and schedule restart. Without this the deferral and
    // deadline below have nothing to apply to.
    {
      omaUri: "./Device/Vendor/MSFT/Policy/Config/Update/AllowAutoUpdate",
      value: "2",
      format: "int",
    },
  ];

  if (deferralDays > 0) {
    nodes.push(
      {
        omaUri: "./Device/Vendor/MSFT/Policy/Config/Update/DeferQualityUpdatesPeriodInDays",
        value: String(Math.min(deferralDays, 30)),
        format: "int",
      },
      {
        omaUri: "./Device/Vendor/MSFT/Policy/Config/Update/DeferFeatureUpdatesPeriodInDays",
        value: String(Math.min(deferralDays, 365)),
        format: "int",
      },
      {
        omaUri: "./Device/Vendor/MSFT/Policy/Config/Update/ConfigureDeadlineForQualityUpdates",
        value: String(Math.min(deferralDays, 30)),
        format: "int",
      },
      {
        omaUri: "./Device/Vendor/MSFT/Policy/Config/Update/ConfigureDeadlineGracePeriod",
        value: String(Math.min(deferralDays, 7)),
        format: "int",
      },
    );
  }

  return nodes;
};

/**
 * Android Management API `systemUpdate` policy generated from a rule.
 *
 * Google's policy supports AUTO, WINDOWED and POSTPONE. Only AUTO is an honest
 * representation of "install updates automatically"; POSTPONE would suppress
 * updates indefinitely and WINDOWED needs a daily maintenance window the tenant
 * policy does not collect.
 */
export const androidSystemUpdatePolicy = (
  rule: OsPolicyRule | null | undefined,
): { readonly type: "AUTO" } | null => (rule?.enforcement === "enforce" ? { type: "AUTO" } : null);

/** Stable configuration kind used when the Android policy is compiled. */
export const ANDROID_OS_UPDATE_CONFIGURATION_KIND = "mttx.android.policy.osUpdate";

/** Apple `ScheduleOSUpdate` install actions, in the order the UI lists them. */
export const APPLE_OS_UPDATE_INSTALL_ACTIONS = [
  "Default",
  "InstallASAP",
  "InstallLater",
  "NotifyOnly",
  "InstallForceRestart",
] as const;

export const AppleOsUpdateInstallAction = Schema.Literals(APPLE_OS_UPDATE_INSTALL_ACTIONS);

export type AppleOsUpdateInstallAction = typeof AppleOsUpdateInstallAction.Type;

/**
 * Build the payload for Apple's `ScheduleOSUpdate` command.
 *
 * Apple has no absolute-deadline key: `InstallLater` plus `MaxUserDeferrals`
 * is the closest supported shape. A deadline is therefore converted into a
 * bounded deferral count, and the UI states that the command runs on the next
 * check-in rather than at the exact timestamp.
 */
export type AppleOsUpdateEntry = {
  InstallAction: AppleOsUpdateInstallAction;
  ProductKey?: string;
  MaxUserDeferrals?: number;
};

export type AppleScheduleOsUpdatePayload = {
  readonly Updates: ReadonlyArray<AppleOsUpdateEntry>;
};

export const appleScheduleOsUpdatePayload = (input: {
  readonly installAction?: AppleOsUpdateInstallAction;
  readonly productKey?: string | null;
  /** Absolute deadline; converted into at most one deferral per day. */
  readonly deadline?: Date | null;
  readonly now?: Date;
}): AppleScheduleOsUpdatePayload => {
  const installAction = input.installAction ?? "InstallASAP";
  const productKey = input.productKey?.trim();

  const entry: AppleOsUpdateEntry = { InstallAction: installAction };

  if (productKey) entry.ProductKey = productKey;

  if (installAction === "InstallLater" && input.deadline) {
    const now = input.now ?? new Date();
    const remainingMs = input.deadline.getTime() - now.getTime();

    // Apple treats MaxUserDeferrals as a count of user postponements. One per
    // day is the closest correspondence to a deadline; clamp to Apple's range.
    const days = Math.ceil(remainingMs / DAY_MS);
    const deferrals = Number.isFinite(days) ? Math.min(Math.max(days, 1), 100) : 1;

    entry.MaxUserDeferrals = deferrals;
  }

  return { Updates: [entry] };
};

/** The capability table in the shape the API returns. */
export const OsPolicyCapabilitySchema = Schema.Struct({
  platform: OsPolicyPlatform,
  minimumVersionEnforced: Schema.Boolean,
  deferralEnforced: Schema.Boolean,
  automatic: Schema.Boolean,
  mechanism: Schema.Literals([
    "schedule-os-update",
    "windows-update-ring",
    "android-system-update",
  ]),
  description: Schema.String,
  limitation: Schema.String,
});

/** One platform's saved rule plus what the platform can actually enforce. */
export const TenantOsPolicyPlatform = Schema.Struct({
  platform: OsPolicyPlatform,
  minimumVersion: Schema.NullOr(Schema.String),
  enforcement: OsEnforcementMode,
  deferralDays: Schema.Finite,
  /** Null when the platform has never been configured. */
  updatedAt: Schema.NullOr(Schema.String),
  deferralEndsAt: Schema.NullOr(Schema.String),
  capability: OsPolicyCapabilitySchema,
});

export type TenantOsPolicyPlatform = typeof TenantOsPolicyPlatform.Type;

export const TenantOsPolicyResponse = Schema.Struct({
  platforms: Schema.Array(TenantOsPolicyPlatform),
});

export type TenantOsPolicyResponse = typeof TenantOsPolicyResponse.Type;

/** A partial update: omitted fields keep their stored value. */
export const UpdateTenantOsPolicyEntry = Schema.Struct({
  platform: OsPolicyPlatform,
  minimumVersion: Schema.optional(Schema.NullOr(Schema.String)),
  enforcement: Schema.optional(OsEnforcementMode),
  deferralDays: Schema.optional(Schema.Finite),
});

export type UpdateTenantOsPolicyEntry = typeof UpdateTenantOsPolicyEntry.Type;

export const UpdateTenantOsPolicyRequest = Schema.Struct({
  platforms: Schema.Array(UpdateTenantOsPolicyEntry),
});

export type UpdateTenantOsPolicyRequest = typeof UpdateTenantOsPolicyRequest.Type;

export const OsVersionBucket = Schema.Struct({
  /** Null is the bucket for devices that have not reported a version. */
  version: Schema.NullOr(Schema.String),
  count: Schema.Finite,
  status: OsComplianceStatus,
  reason: OsComplianceReason,
});

export type OsVersionBucket = typeof OsVersionBucket.Type;

export const OsComplianceCountsSchema = Schema.Struct({
  total: Schema.Finite,
  compliant: Schema.Finite,
  updateAvailable: Schema.Finite,
  belowMinimum: Schema.Finite,
  deferred: Schema.Finite,
  unknown: Schema.Finite,
  enforcedBelowMinimum: Schema.Finite,
});

/** One device in the bounded "who is behind" list. */
export const OsBehindDevice = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: OsComplianceStatus,
  reason: OsComplianceReason,
  currentVersion: Schema.NullOr(Schema.String),
  targetVersion: Schema.NullOr(Schema.String),
  deferralEndsAt: Schema.NullOr(Schema.String),
  lastSeenAt: Schema.NullOr(Schema.String),
});

export type OsBehindDevice = typeof OsBehindDevice.Type;

export const OsFleetPlatform = Schema.Struct({
  platform: OsPolicyPlatform,
  minimumVersion: Schema.NullOr(Schema.String),
  enforcement: OsEnforcementMode,
  deferralEndsAt: Schema.NullOr(Schema.String),
  capability: OsPolicyCapabilitySchema,
  counts: OsComplianceCountsSchema,
  /** Distribution by reported version, newest first. */
  versions: Schema.Array(OsVersionBucket),
  /** Worst-first, bounded; `behindTruncated` says whether more exist. */
  behind: Schema.Array(OsBehindDevice),
  behindTruncated: Schema.Boolean,
});

export type OsFleetPlatform = typeof OsFleetPlatform.Type;

export const OsFleetResponse = Schema.Struct({
  generatedAt: Schema.String,
  feed: SoftwareUpdateFeedInfo,
  totals: OsComplianceCountsSchema,
  platforms: Schema.Array(OsFleetPlatform),
});

export type OsFleetResponse = typeof OsFleetResponse.Type;
