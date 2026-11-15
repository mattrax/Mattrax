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

/** Collapse whitespace and treat blank values as absent. */
export const normalizeReportedName = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();

  return trimmed ? trimmed.replace(/\s+/g, " ") : undefined;
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
