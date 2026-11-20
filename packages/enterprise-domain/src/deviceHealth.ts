import { Option, Schema } from "effect";
import type {
  DeviceHealth,
  DeviceHealthCounts,
  DeviceHealthLevel,
  DeviceHealthReason,
} from "./enterprise.ts";
import { deriveDevicePresence } from "./devicePresence.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default age after which a device is considered stale. */
export const DEVICE_STALE_AFTER_DAYS = 7;

/**
 * Default age after which an enrolled device is MIA (missing in action).
 *
 * Timeline and precedence:
 *
 * - 7 days (`DEVICE_STALE_AFTER_DAYS`): stale. The device stays `attention`
 *   and gains a `stale` reason.
 * - 14 days (`DEVICE_MISSING_AFTER_DAYS`): MIA. An **enrolled** device that has
 *   not checked in gets the `missing` level, replacing the stale reason.
 * - `MAINTENANCE_STALE_DEVICE_DAYS` (30 days by default): daily maintenance
 *   unenrols it, which reads `critical` and is never MIA. Setting the
 *   maintenance window at or below the MIA threshold makes MIA unobservable.
 *
 * `unenrolled`/`unenrolling` always win over MIA, so a retired device never
 * looks missing. A `critical` reason (for example an unenrolled status or a
 * full disk) still outranks MIA; `missing` outranks every warning/attention
 * reason. A device that has never checked in stays `attention` rather than
 * MIA because there is no check-in age to measure.
 */
export const DEVICE_MISSING_AFTER_DAYS = 14;

/**
 * How long an escrow answer is trusted before the page warns that recovery-key
 * status may have moved. Apple re-wraps the key only when FileVault rotates it,
 * so this tracks the last confirmation, not the key's age.
 */
export const DEVICE_SECURITY_INFO_STALE_AFTER_DAYS = 90;

/**
 * One decoded entry of the opaque `Reasons` payload Apple attaches to a
 * declaration status report: either a rendered string or an object carrying
 * `code` and `description` alongside arbitrary JSON context.
 */
export type DeviceHealthDeclarationReason = string | Schema.JsonObject;

/** A declaration as ingested from Apple's DDM status report. */
export type DeviceHealthDeclaration = {
  readonly identifier?: string;
  readonly declarationType?: string;
  readonly valid?: string | null;
  readonly active?: boolean;
  readonly reasons?: unknown;
};

export type DeviceHealthInput = {
  readonly status?: string | null;
  /**
   * The device is an ADE device held in Setup Assistant. This is not a fault,
   * but it is not a finished enrolment either, so health is `attention` until
   * the server releases it with `DeviceConfigured`.
   */
  readonly awaitingConfiguration?: boolean | null;
  readonly lastSeenAt?: Date | string | null;
  readonly declarations?: ReadonlyArray<DeviceHealthDeclaration>;
  readonly diskTotal?: string | number | null;
  readonly diskUsed?: string | number | null;
  /** Device platform (`apple`, `win`, `android`) for platform-specific rules. */
  readonly proto?: string | null;
  readonly model?: string | null;
  readonly osEdition?: string | null;
  readonly fileVaultEnabled?: boolean | null;
  readonly batteryHealth?: string | null;
  /** Windows `DeviceStatus/Compliance/EncryptionCompliance`, null when unreported. */
  readonly bitLockerEnabled?: boolean | null;
  /** Windows `BitLocker/Status/DeviceEncryptionStatus` bitmask; bits 2 and 9 mean unprotected volumes. */
  readonly bitLockerStatus?: number | null;
  /** Windows `DeviceStatus/TPM/SpecificationVersion`; null means no TPM answered. */
  readonly tpmVersion?: string | null;
  /** Windows `DeviceStatus/SecureBootState`: 0 unsupported, 1 enabled, 2 disabled. */
  readonly secureBootState?: number | null;
  /** Windows `DeviceStatus/DomainName`; empty means the device is not domain joined. */
  readonly domainName?: string | null;
  /** Windows `AADDeviceID`, present when the device is Microsoft Entra joined. */
  readonly entraDeviceId?: string | null;
  /**
   * Whether the device has returned a Windows security snapshot. Absence
   * itself is not evidence of a missing TPM, so the security rules only run
   * after the first report.
   */
  readonly windowsSecurityReported?: boolean;
  /** `passcode.is-present`; null on macOS, which has no device passcode. */
  readonly passcodePresent?: boolean | null;
  /** `passcode.is-compliant`. */
  readonly passcodeCompliant?: boolean | null;
  /** `softwareupdate.install-state`. */
  readonly osUpdateInstallState?: string | null;
  /** `softwareupdate.pending-version.os-version`. */
  readonly osUpdatePendingVersion?: string | null;
  /** `softwareupdate.failure-reason.count`. */
  readonly osUpdateFailureCount?: number | null;
  /** `security.certificate.list` entries. */
  readonly managedCertificateCount?: number | null;
  /** `mdm.app` entries (at least the state health evaluates). */
  readonly managementApps?: ReadonlyArray<DeviceHealthManagementApp> | null;
  /** When the FileVault key was last escrowed; null when none is stored. */
  readonly recoveryKeyUpdatedAt?: Date | string | null;
  /** When the last `SecurityInfo` answer was persisted. */
  readonly securityInfoUpdatedAt?: Date | string | null;
  /** Injectable clock so the derivation stays pure and testable. */
  readonly now?: Date;
  readonly staleAfterDays?: number;
  /** Age at which a still-enrolled device becomes MIA. Defaults to 14 days. */
  readonly missingAfterDays?: number;
};

/** The `mdm.app` fields health uses: Apple's install state per app. */
export const DeviceHealthManagementApp = Schema.Struct({
  identifier: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.optional(Schema.NullOr(Schema.String)),
});

export type DeviceHealthManagementApp = typeof DeviceHealthManagementApp.Type;

export type DeviceHealthSummary = {
  readonly level: DeviceHealthLevel;
  readonly reasons: ReadonlyArray<DeviceHealthReason>;
  readonly lastSeenAt: string | null;
  readonly stale: boolean;
  /**
   * Check-in recency presence, derived from the same clock and row as
   * `lastSeenAt`/`stale` so a badge and the health reasons cannot disagree.
   */
  readonly online: boolean;
};

export const normalizeDeviceHealth = (health: DeviceHealthSummary): DeviceHealth => ({
  level: health.level,
  reasons: [...health.reasons],
  lastSeenAt: health.lastSeenAt,
  stale: health.stale,
  online: health.online,
});

const parseDate = (value: Date | string | null | undefined): Date | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  // `lastSeenAt` is non-null in the schema, but the API renders a missing value
  // as the epoch. Treat that as "never seen" rather than 1970 being stale.
  if (date.getTime() <= 0) return null;

  return date;
};

const labelFor = (value: DeviceHealthDeclarationReason): string => {
  if (Schema.is(Schema.String)(value)) return value;

  const parts = [value.code, value.description].flatMap((part) =>
    Schema.is(Schema.String)(part) && part.trim() !== "" ? [part.trim()] : [],
  );

  if (parts.length > 0) return parts.join(": ");

  return "";
};

/** The decoded shape of one entry in the opaque `Reasons` payload. */
const DeclarationReason = Schema.Union([Schema.String, Schema.JsonObject]);

/** Apple sends either one reason or a list of them. */
const DeclarationReasons = Schema.Union([DeclarationReason, Schema.Array(DeclarationReason)]);

/** Human-readable strings for the opaque `Reasons` payload Apple sends. */
export const declarationReasonLabels = <Reasons>(reasons: Reasons | null): string[] =>
  Option.match(Schema.decodeUnknownOption(DeclarationReasons)(reasons), {
    onNone: () => [],
    onSome: (decoded) => {
      const values = Schema.is(Schema.Array(DeclarationReason))(decoded) ? decoded : [decoded];

      return values.map((value) => labelFor(value).trim()).filter((label) => label.length > 0);
    },
  });

/** Parse the byte counts stored in `device.diskTotal` / `device.diskUsed`. */
export const parseStorageBytes = (value: string | number | null | undefined): number | null => {
  if (value == null) return null;

  if (Schema.is(Schema.Number)(value)) return Number.isFinite(value) && value >= 0 ? value : null;
  const text = value.trim();

  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);

  return Number.isFinite(parsed) ? parsed : null;
};

const reason = (
  code: string,
  label: string,
  severity: DeviceHealthReason["severity"],
): DeviceHealthReason => ({ code, label, severity });

const declarationName = (declaration: DeviceHealthDeclaration) =>
  declaration.identifier?.trim() || declaration.declarationType || "Declaration";

const ACTIVE_DECLARATION_TYPES = new Set(["configurations", "activations"]);

const KNOWN_STATUSES = new Set(["enrolling", "enrolled", "unenrolling", "unenrolled"]);

const NON_MAC_OS = /(ios|ipados|tvos|watchos|visionos|android|windows)/i;

/**
 * FileVault is a macOS feature. Only macOS reports the DDM FileVault status
 * item, so a non-null value is already a strong signal, but the OS/model check
 * keeps the rule honest if a client ever reports a default `false`.
 */
export const isMacOsDevice = (input: {
  readonly proto?: string | null;
  readonly model?: string | null;
  readonly osEdition?: string | null;
}): boolean => {
  const edition = input.osEdition?.trim() ?? "";

  if (/macos/i.test(edition)) return true;

  if (NON_MAC_OS.test(edition)) return false;
  const model = input.model?.trim() ?? "";

  if (model) return /mac/i.test(model);

  return input.proto === "apple";
};

/** Battery conditions that mean the battery needs service or replacement. */
export const needsBatteryService = (batteryHealth: string | null | undefined): boolean => {
  if (!batteryHealth) return false;

  return /(service|replace|poor)/i.test(batteryHealth);
};

/**
 * Windows is the only platform that reports BitLocker, TPM, Secure Boot and
 * join state through OMA-DM inventory. The OS edition is checked as well so a
 * mislabelled row cannot apply a Windows rule to a Mac.
 */
export const isWindowsDevice = (input: {
  readonly proto?: string | null;
  readonly osEdition?: string | null;
}): boolean => {
  if (input.proto === "win") return true;
  const edition = input.osEdition?.trim() ?? "";

  return edition !== "" && /windows/i.test(edition);
};

/**
 * TPM 2.0 is the minimum for Windows 11 and for the security features
 * (BitLocker with a TPM protector, Credential Guard) this rule is about. A
 * version such as `2.0` parses to its major number; an unparseable value is
 * treated as unknown rather than old.
 */
const tpmMajorVersion = (value: string | null | undefined): number | null => {
  const match = /^\s*(\d+)/.exec(value ?? "");

  if (!match) return null;
  const major = Number(match[1]);

  return Number.isFinite(major) ? major : null;
};

const joinedValue = (value: string | null | undefined): boolean => (value?.trim().length ?? 0) > 0;

/**
 * Count `mdm.app` entries Apple reports as `failed`. The payload is stored as
 * JSON, so anything unrecognised is ignored rather than guessed at.
 */
const managementAppFailures = (
  apps: ReadonlyArray<DeviceHealthManagementApp> | null | undefined,
): number => (apps ?? []).filter((app) => (app.state ?? "").toLowerCase() === "failed").length;

/**
 * Derive a device's compliance/health rollup.
 *
 * Deliberately pure: callers pass a clock and already-loaded rows, so the
 * severity rules can be unit tested without a database.
 */
export const deriveDeviceHealth = (input: DeviceHealthInput): DeviceHealthSummary => {
  const now = input.now ?? new Date();

  const staleAfterDays =
    input.staleAfterDays === undefined ? DEVICE_STALE_AFTER_DAYS : input.staleAfterDays;

  const missingAfterDays =
    input.missingAfterDays === undefined ? DEVICE_MISSING_AFTER_DAYS : input.missingAfterDays;

  const lastSeen = parseDate(input.lastSeenAt);
  const lastSeenAt = lastSeen ? lastSeen.toISOString() : null;
  const age = lastSeen ? now.getTime() - lastSeen.getTime() : null;
  const stale = age !== null && age > staleAfterDays * MS_PER_DAY;
  const reasons: DeviceHealthReason[] = [];
  const status = input.status?.trim();

  // One presence rule for the API, the table badge and health: a device is
  // online based on its newest check-in, and never before its first one.
  const presence = deriveDevicePresence({
    status: input.status,
    lastSeenAt: input.lastSeenAt,
    now,
  });

  // Only an enrolled device can be MIA. Once maintenance retires it the
  // `unenrolled` status and its critical reason take precedence. MIA also
  // requires the device to be stale: a custom stale threshold must not produce
  // `level: missing` with `stale: false`.
  const missing =
    age !== null && stale && age > missingAfterDays * MS_PER_DAY && status === "enrolled";

  if (!status) {
    reasons.push(reason("status_unknown", "Enrollment status is unknown", "info"));
  } else if (status === "unenrolled") {
    reasons.push(reason("enrollment_unenrolled", "Device is unenrolled", "critical"));
  } else if (status === "unenrolling") {
    reasons.push(reason("enrollment_unenrolling", "Device is being unenrolled", "warning"));
  } else if (status === "enrolling" && input.awaitingConfiguration === true) {
    reasons.push(
      reason(
        "awaiting_configuration",
        "Device is held in Setup Assistant until its setup payload is applied",
        "warning",
      ),
    );
  } else if (status === "enrolling") {
    reasons.push(reason("enrollment_enrolling", "Enrollment is still in progress", "warning"));
  } else if (status !== "enrolled") {
    reasons.push(reason("status_unknown", `Unknown enrollment status: ${status}`, "info"));
  }

  if (!lastSeen) {
    reasons.push(reason("never_seen", "Device has never checked in", "warning"));
  } else if (missing) {
    // One reason, not stale plus missing: the badge and fleet grouping should
    // say MIA once rather than counting the device twice.
    reasons.push(
      reason(
        "missing",
        `Device has not checked in for more than ${missingAfterDays} days and is still enrolled`,
        "warning",
      ),
    );
  } else if (stale && status !== "unenrolled" && status !== "unenrolling") {
    reasons.push(
      reason(
        "stale",
        `Device has not checked in for more than ${staleAfterDays} day${staleAfterDays === 1 ? "" : "s"}`,
        "warning",
      ),
    );
  }

  const invalid: string[] = [];
  const inactive: string[] = [];

  for (const declaration of input.declarations ?? []) {
    const validity = (declaration.valid ?? "").trim().toLowerCase();

    if (validity === "invalid") invalid.push(declarationName(declaration));
    else if (
      validity === "unknown" &&
      declaration.active !== true &&
      ACTIVE_DECLARATION_TYPES.has(declaration.declarationType ?? "")
    )
      inactive.push(declarationName(declaration));
    else if (
      declaration.active === false &&
      ACTIVE_DECLARATION_TYPES.has(declaration.declarationType ?? "")
    )
      inactive.push(declarationName(declaration));
  }

  if (invalid.length > 0) {
    reasons.push(
      reason(
        "declaration_invalid",
        invalid.length === 1
          ? `Declaration ${invalid[0]} is invalid`
          : `${invalid.length} declarations are invalid`,
        "warning",
      ),
    );
  }

  if (inactive.length > 0) {
    reasons.push(
      reason(
        "declaration_inactive",
        inactive.length === 1
          ? `Declaration ${inactive[0]} is not active on the device`
          : `${inactive.length} declarations are not active on the device`,
        "warning",
      ),
    );
  }

  const total = parseStorageBytes(input.diskTotal);
  const used = parseStorageBytes(input.diskUsed);

  if (total !== null && used !== null && total > 0) {
    const ratio = used / total;
    const percent = Math.round(ratio * 100);

    if (ratio >= 0.97)
      reasons.push(
        reason("disk_critical", `Storage is almost full (${percent}% used)`, "critical"),
      );
    else if (ratio >= 0.9)
      reasons.push(reason("disk_low", `Storage is running low (${percent}% used)`, "warning"));
  }

  if (input.fileVaultEnabled === false && isMacOsDevice(input)) {
    reasons.push(
      reason("filevault_disabled", "FileVault disk encryption is turned off", "warning"),
    );
  }

  if (isWindowsDevice(input) && input.windowsSecurityReported === true) {
    // Bit 2 is an unprotected OS volume and bit 9 an unprotected fixed drive
    // in the BitLocker CSP `DeviceEncryptionStatus` bitmask.
    const unprotectedVolumes =
      input.bitLockerStatus != null && (input.bitLockerStatus & ((1 << 2) | (1 << 9))) !== 0;

    if (input.bitLockerEnabled === false || unprotectedVolumes) {
      reasons.push(
        reason("bitlocker_disabled", "BitLocker disk encryption is turned off", "warning"),
      );
    }

    const tpm = tpmMajorVersion(input.tpmVersion);

    if (!joinedValue(input.tpmVersion)) {
      reasons.push(reason("tpm_absent", "The device has no Trusted Platform Module", "warning"));
    } else if (tpm !== null && tpm < 2) {
      reasons.push(
        reason(
          "tpm_outdated",
          `TPM ${input.tpmVersion?.trim()} is below the required 2.0`,
          "warning",
        ),
      );
    }

    if (input.secureBootState === 2) {
      reasons.push(reason("secure_boot_disabled", "Secure Boot is disabled", "warning"));
    }

    if (!joinedValue(input.domainName) && !joinedValue(input.entraDeviceId)) {
      reasons.push(
        reason(
          "not_joined",
          "Device is neither domain joined nor Microsoft Entra joined",
          "warning",
        ),
      );
    }
  }

  if (input.passcodePresent === false && !isMacOsDevice(input)) {
    reasons.push(reason("passcode_missing", "No device passcode is set", "warning"));
  }

  if (input.passcodeCompliant === false) {
    reasons.push(
      reason(
        "passcode_noncompliant",
        "The device passcode does not meet policy requirements",
        "warning",
      ),
    );
  }

  const installState = input.osUpdateInstallState?.trim().toLowerCase();
  const failureCount = input.osUpdateFailureCount ?? 0;

  if (installState === "failed" || failureCount > 0) {
    reasons.push(
      reason(
        "os_update_failed",
        failureCount > 1
          ? `The last software update failed ${failureCount} times`
          : "The last software update failed",
        "warning",
      ),
    );
  } else if (
    installState === "downloading" ||
    installState === "prepared" ||
    installState === "installing" ||
    (input.osUpdatePendingVersion ?? "").trim() !== ""
  ) {
    const version = input.osUpdatePendingVersion?.trim();

    reasons.push(
      reason(
        "os_update_pending",
        version ? `Software update ${version} is pending` : "A software update is pending",
        "info",
      ),
    );
  }

  const failedApps = managementAppFailures(input.managementApps);

  if (failedApps > 0) {
    reasons.push(
      reason(
        "management_app_failed",
        failedApps === 1
          ? "1 management app failed to install"
          : `${failedApps} management apps failed to install`,
        "warning",
      ),
    );
  }

  // A Mac with FileVault on and no escrowed key cannot be unlocked by Mattrax.
  // The page shows the escrow age separately; health only flags the gap.
  if (input.fileVaultEnabled === true && isMacOsDevice(input) && !input.recoveryKeyUpdatedAt) {
    reasons.push(
      // Informational: a tenant that has not configured FileVault escrow is
      // not unhealthy, but the device page must show that no key was received.
      reason("filevault_key_missing", "FileVault is on but no recovery key is escrowed", "info"),
    );
  }

  const securityInfoAt = parseDate(input.securityInfoUpdatedAt);

  if (
    input.recoveryKeyUpdatedAt &&
    securityInfoAt &&
    now.getTime() - securityInfoAt.getTime() > DEVICE_SECURITY_INFO_STALE_AFTER_DAYS * MS_PER_DAY
  ) {
    reasons.push(
      reason(
        "security_info_stale",
        `Security information has not been confirmed for more than ${DEVICE_SECURITY_INFO_STALE_AFTER_DAYS} days`,
        "info",
      ),
    );
  }

  if (needsBatteryService(input.batteryHealth)) {
    reasons.push(
      reason(
        "battery_service",
        `Battery health needs attention: ${input.batteryHealth}`,
        "warning",
      ),
    );
  }

  return {
    level: healthLevel(status, reasons, missing),
    reasons,
    lastSeenAt,
    stale,
    online: presence.online,
  };
};

/**
 * Severity of the worst reason, with unknown device status dominating.
 *
 * Precedence: unknown status, then critical (including an unenrolled status),
 * then MIA, then warnings/attention, then healthy. MIA therefore reads
 * differently from both a merely stale device and a retired one.
 */
const healthLevel = (
  status: string | undefined,
  reasons: ReadonlyArray<DeviceHealthReason>,
  missing: boolean,
): DeviceHealthLevel => {
  if (!status || !KNOWN_STATUSES.has(status)) return "unknown";

  if (reasons.some((item) => item.severity === "critical")) return "critical";

  if (missing) return "missing";

  if (reasons.some((item) => item.severity === "warning")) return "attention";

  return "healthy";
};

/** Aggregate tenant counts from already-derived summaries. */
export const countDeviceHealth = (
  summaries: ReadonlyArray<DeviceHealthSummary>,
): DeviceHealthCounts => {
  const counts = {
    total: summaries.length,
    healthy: 0,
    attention: 0,
    critical: 0,
    missing: 0,
    stale: 0,
    unknown: 0,
  };

  for (const summary of summaries) {
    counts[summary.level] += 1;

    if (summary.stale) counts.stale += 1;
  }

  return counts;
};

/** Stable, human wording for a reason code, so grouped attention stays high level. */
const REASON_GROUP_LABELS = new Map<string, string>([
  ["status_unknown", "Enrollment status unknown"],
  ["enrollment_unenrolled", "Unenrolled"],
  ["enrollment_unenrolling", "Unenrolling"],
  ["enrollment_enrolling", "Enrollment incomplete"],
  ["awaiting_configuration", "Awaiting setup"],
  ["never_seen", "Never checked in"],
  ["stale", "Not checking in"],
  ["missing", "MIA"],
  ["declaration_invalid", "Policy not applied"],
  ["declaration_inactive", "Policy inactive"],
  ["disk_critical", "Storage full"],
  ["disk_low", "Storage low"],
  ["filevault_disabled", "FileVault off"],
  ["bitlocker_disabled", "BitLocker off"],
  ["tpm_absent", "No TPM"],
  ["tpm_outdated", "TPM below 2.0"],
  ["secure_boot_disabled", "Secure Boot off"],
  ["not_joined", "Not domain or Entra joined"],
  ["battery_service", "Battery service"],
]);

const SEVERITY_RANK: Record<DeviceHealthReason["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * Collapse per-device rules into a small set of fleet-level signals. A device
 * can be unhealthy for several reasons and the exact label may include a
 * percentage, so groupings use the stable reason code.
 */
export const groupDeviceHealthReasons = (
  summaries: ReadonlyArray<DeviceHealthSummary>,
): ReadonlyArray<{
  code: string;
  label: string;
  severity: DeviceHealthReason["severity"];
  count: number;
}> => {
  const groups = new Map<
    string,
    { label: string; severity: DeviceHealthReason["severity"]; count: number }
  >();

  for (const summary of summaries) {
    if (summary.level === "healthy") continue;

    for (const item of summary.reasons) {
      const existing = groups.get(item.code);

      if (!existing) {
        groups.set(item.code, {
          label: REASON_GROUP_LABELS.get(item.code) ?? item.label,
          severity: item.severity,
          count: 1,
        });
        continue;
      }

      existing.count += 1;

      if (SEVERITY_RANK[item.severity] < SEVERITY_RANK[existing.severity])
        existing.severity = item.severity;
    }
  }

  return [...groups.entries()]
    .map(([code, group]) => ({ code, ...group }))
    .sort((left, right) => {
      const severity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];

      if (severity !== 0) return severity;

      if (left.count !== right.count) return right.count - left.count;

      return left.label.localeCompare(right.label);
    });
};
