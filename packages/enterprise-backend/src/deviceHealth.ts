import type {
  DeviceHealth,
  DeviceHealthCounts,
  DeviceHealthLevel,
  DeviceHealthReason,
} from "@mattrax/enterprise-domain";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default age after which a device is considered stale. */
export const DEVICE_STALE_AFTER_DAYS = 7;

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
  /** Injectable clock so the derivation stays pure and testable. */
  readonly now?: Date;
  readonly staleAfterDays?: number;
};

export type DeviceHealthSummary = {
  readonly level: DeviceHealthLevel;
  readonly reasons: ReadonlyArray<DeviceHealthReason>;
  readonly lastSeenAt: string | null;
  readonly stale: boolean;
};

export const normalizeDeviceHealth = (health: DeviceHealthSummary): DeviceHealth => ({
  level: health.level,
  reasons: [...health.reasons],
  lastSeenAt: health.lastSeenAt,
  stale: health.stale,
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

const labelFor = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const parts = [record.code, record.description]
      .filter((part): part is string => typeof part === "string" && part.trim() !== "")
      .map((part) => part.trim());
    if (parts.length > 0) return parts.join(": ");
  }
  return "";
};

/** Human-readable strings for the opaque `Reasons` payload Apple sends. */
export const declarationReasonLabels = (reasons: unknown): string[] => {
  if (reasons == null) return [];
  const values = Array.isArray(reasons) ? reasons : [reasons];
  return values
    .map(labelFor)
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
};

/** Parse the byte counts stored in `device.diskTotal` / `device.diskUsed`. */
export const parseStorageBytes = (value: string | number | null | undefined): number | null => {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
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
 * Derive a device's compliance/health rollup.
 *
 * Deliberately pure: callers pass a clock and already-loaded rows, so the
 * severity rules can be unit tested without a database.
 */
export const deriveDeviceHealth = (input: DeviceHealthInput): DeviceHealthSummary => {
  const now = input.now ?? new Date();
  const staleAfterDays =
    input.staleAfterDays === undefined ? DEVICE_STALE_AFTER_DAYS : input.staleAfterDays;
  const lastSeen = parseDate(input.lastSeenAt);
  const lastSeenAt = lastSeen ? lastSeen.toISOString() : null;
  const stale = lastSeen ? now.getTime() - lastSeen.getTime() > staleAfterDays * MS_PER_DAY : false;
  const reasons: DeviceHealthReason[] = [];
  const status = input.status?.trim();

  if (!status) {
    reasons.push(reason("status_unknown", "Enrollment status is unknown", "info"));
  } else if (status === "unenrolled") {
    reasons.push(reason("enrollment_unenrolled", "Device is unenrolled", "critical"));
  } else if (status === "unenrolling") {
    reasons.push(reason("enrollment_unenrolling", "Device is being unenrolled", "warning"));
  } else if (status === "enrolling") {
    reasons.push(reason("enrollment_enrolling", "Enrollment is still in progress", "warning"));
  } else if (status !== "enrolled") {
    reasons.push(reason("status_unknown", `Unknown enrollment status: ${status}`, "info"));
  }

  if (!lastSeen) {
    reasons.push(reason("never_seen", "Device has never checked in", "warning"));
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

  if (needsBatteryService(input.batteryHealth)) {
    reasons.push(
      reason(
        "battery_service",
        `Battery health needs attention: ${input.batteryHealth}`,
        "warning",
      ),
    );
  }

  const level: DeviceHealthLevel =
    !status || !KNOWN_STATUSES.has(status)
      ? "unknown"
      : reasons.some((item) => item.severity === "critical")
        ? "critical"
        : reasons.some((item) => item.severity === "warning")
          ? "attention"
          : "healthy";

  return { level, reasons, lastSeenAt, stale };
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
    stale: 0,
    unknown: 0,
  };
  for (const summary of summaries) {
    counts[summary.level] += 1;
    if (summary.stale) counts.stale += 1;
  }
  return counts;
};
