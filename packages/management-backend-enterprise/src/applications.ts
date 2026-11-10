/**
 * `InstalledApplicationList` command-result parsing.
 *
 * The device reports a full inventory on every refresh. `undefined` means the
 * command result did not contain an inventory (for example a different
 * command); an empty array means the device reported that no applications are
 * installed, which is a legitimate result that must clear stale rows.
 */

export type InstalledApplicationReport = {
  readonly bundleId: string;
  readonly name?: string;
  readonly version?: string;
  readonly shortVersion?: string;
  readonly bundleSize?: number;
  readonly dynamicSize?: number;
  readonly hasUpdateAvailable: boolean;
  readonly isManaged: boolean;
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const text = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
};

const booleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 0 ? false : value === 1 ? true : undefined;
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    if (["true", "yes", "1", "on"].includes(normalised)) return true;
    if (["false", "no", "0", "off"].includes(normalised)) return false;
  }
  return undefined;
};

const byteCount = (value: unknown): number | undefined => {
  const raw = text(value);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const ITEM_LIST = (queryResponses: unknown): unknown => {
  const root = record(queryResponses);
  if (!root) return undefined;
  const value = root.InstalledApplicationList;
  if (Array.isArray(value)) return value;
  const nested = record(value);
  return nested?.InstalledApplicationListItem ?? undefined;
};

/**
 * Normalise every reported application, de-duplicating by bundle identifier.
 * Entries without an identifier cannot be addressed on the next refresh and
 * are skipped.
 */
export const parseInstalledApplications = (
  queryResponses: unknown,
): InstalledApplicationReport[] | undefined => {
  const items = ITEM_LIST(queryResponses);
  if (!Array.isArray(items)) return undefined;

  const applications = new Map<string, InstalledApplicationReport>();
  for (const item of items) {
    const entry = record(item);
    if (!entry) continue;
    const bundleId = text(entry.Identifier) ?? text(entry.BundleIdentifier);
    if (!bundleId) continue;
    const name = text(entry.Name);
    const version = text(entry.Version);
    const shortVersion = text(entry.ShortVersion);
    const bundleSize = byteCount(entry.BundleSize);
    const dynamicSize = byteCount(entry.DynamicSize);
    const managementFlags = byteCount(entry.ManagementFlags);
    applications.set(bundleId, {
      bundleId,
      ...(name !== undefined ? { name } : {}),
      ...(version !== undefined ? { version } : {}),
      ...(shortVersion !== undefined ? { shortVersion } : {}),
      ...(bundleSize !== undefined ? { bundleSize } : {}),
      ...(dynamicSize !== undefined ? { dynamicSize } : {}),
      hasUpdateAvailable: booleanValue(entry.HasUpdateAvailable) ?? false,
      isManaged:
        booleanValue(entry.IsManaged) ??
        booleanValue(entry.Managed) ??
        (managementFlags !== undefined && managementFlags > 0),
    });
  }
  return [...applications.values()];
};
