/**
 * Device identity and inventory freshness rules shared by every platform.
 *
 * A device reports two different kinds of name: the name an administrator
 * uses inside Mattrax (`device.name`) and the name the operating system
 * reports for itself (`device.physicalName`). Apple reports the latter through
 * `DeviceInformation`, Windows through `DevDetail/DeviceName` and Android
 * through the AMAPI device resource, so the precedence has to live in one
 * place rather than being re-implemented per protocol.
 */

import { NullableString } from "./Errors.js";
import { Schema } from "effect";

/** Collapse whitespace and treat blank values as absent. */
export const normalizeReportedName = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();

  return trimmed ? trimmed.replaceAll(/\s+/g, " ") : undefined;
};

export type ReportedDeviceNameInput = {
  /** The name currently stored on the device row. */
  readonly currentName?: string | null;
  /** The name the device just reported for itself. */
  readonly reportedName?: string | null;
  /**
   * Values the server derived the current name from when the device enrolled
   * (serial, model, UDID, previous reported name). A current name that still
   * equals one of these was never chosen by an administrator.
   */
  readonly placeholders?: ReadonlyArray<string | null | undefined>;
};

/**
 * Whether a reported device name should replace the stored management name.
 *
 * Precedence, highest first:
 *
 * 1. a name an administrator set in Mattrax (never overwritten),
 * 2. the name the device reports for itself (applied while the stored name is
 *    still empty or still one of the auto-derived placeholders, so an OS-level
 *    rename follows through and a deliberate rename does not),
 * 3. the enrolment placeholder (`serial ?? model ?? udid`).
 */
export const shouldApplyReportedName = (input: ReportedDeviceNameInput): boolean => {
  const reported = normalizeReportedName(input.reportedName);

  if (!reported) return false;

  const current = normalizeReportedName(input.currentName);

  if (!current) return true;

  if (current === reported) return false;

  return (input.placeholders ?? []).some(
    (placeholder) => normalizeReportedName(placeholder) === current,
  );
};

/** How long a per-platform application inventory stays fresh. */
export const APPLICATION_INVENTORY_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether the installed-application inventory on a device page is stale.
 *
 * Apple refreshes daily, Android reports on every status notification and
 * Windows on its six-hour inventory cadence, so anything older than a week (or
 * never reported) is worth flagging. An unparseable timestamp counts as stale:
 * the only way it is produced is a corrupted row.
 */
export const applicationsInventoryStale = (input: {
  readonly updatedAt?: Date | string | null;
  readonly now?: Date;
  readonly maxAgeMs?: number;
}): boolean => {
  if (!input.updatedAt) return true;

  const updatedAt = input.updatedAt instanceof Date ? input.updatedAt : new Date(input.updatedAt);

  if (!Number.isFinite(updatedAt.getTime())) return true;
  const now = input.now ?? new Date();

  return now.getTime() - updatedAt.getTime() > (input.maxAgeMs ?? APPLICATION_INVENTORY_STALE_MS);
};

/**
 * Normalised Windows activation state.
 *
 * Windows exposes activation through `SoftwareLicensingProduct.LicenseStatus`
 * (WMI), not through an OMA-DM CSP: the `WindowsLicensing` CSP only reports the
 * edition, edition-upgrade state and subscription licensing. The on-device
 * agent therefore samples WMI and reports the raw value to the server, which
 * keeps both the raw number and this stable enum.
 */
export const WindowsActivationStatus = Schema.Literals(["activated", "not-activated", "unknown"]);

export type WindowsActivationStatus = typeof WindowsActivationStatus.Type;

/**
 * Clamp a reported `LicenseStatus` to the documented 0-6 range.
 *
 * The value is persisted raw for support, so a fractional, negative, huge or
 * non-numeric value becomes `null` instead of reaching an `int` column (MySQL
 * rounds fractions and errors on out-of-range integers). `null` still maps to
 * `unknown`, never to "not activated".
 */
export const windowsLicenseStatusValue = (value: number | null | undefined): number | null => {
  if (value === null || value === undefined || !Number.isInteger(value)) return null;

  return value >= 0 && value <= 6 ? value : null;
};

/**
 * Map a raw `SoftwareLicensingProduct.LicenseStatus` to the stable enum.
 *
 * `1` (Licensed) is the only value Windows reports as activated. `0`
 * (Unlicensed), `2`/`3` (OOB/OOT grace), `4` (non-genuine grace), `5`
 * (Notification, i.e. grace exhausted) and `6` (Extended grace) are all
 * presented by Windows as "not activated", so administrators filtering for
 * unactivated devices expect them together. A missing, non-integer or
 * out-of-range value is `unknown`: only a real reading may claim a device is
 * not activated.
 */
export const windowsActivationStatusFromLicenseStatus = (
  raw: number | null | undefined,
): WindowsActivationStatus => {
  const value = windowsLicenseStatusValue(raw);

  if (value === null) return "unknown";

  return value === 1 ? "activated" : "not-activated";
};

/**
 * One activation reading posted by mattraxd.
 *
 * Every value is raw as reported by the device. `edition` comes from
 * `Win32_OperatingSystem.Caption` (or the licence product name) because an
 * edition upgrade and an activation change can disagree.
 */
export const WindowsActivationReportRequest = Schema.Struct({
  /** `SoftwareLicensingProduct.LicenseStatus`; 0-6, or null when unreadable. */
  licenseStatus: Schema.optional(Schema.NullOr(Schema.Number)),
  /** Licence product name, for example `Windows(R), Professional edition`. */
  licenseName: Schema.optional(NullableString),
  /** `ProductKeyChannel`, for example `Retail` or `Volume:MAK`. */
  productKeyChannel: Schema.optional(NullableString),
  /** Edition from WMI, for example `Microsoft Windows 11 Pro`. */
  edition: Schema.optional(NullableString),
  /** When the agent sampled WMI; defaults to the ingest time. */
  sampledAt: Schema.optional(NullableString),
});

export type WindowsActivationReportRequest = typeof WindowsActivationReportRequest.Type;

export const WindowsActivationReportResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  /** False when a newer sample (or a concurrent write) was already stored. */
  applied: Schema.Boolean,
  /** State stored after the report: the new one, or the existing one if stale. */
  activation: WindowsActivationStatus,
});

export type WindowsActivationReportResponse = typeof WindowsActivationReportResponse.Type;
