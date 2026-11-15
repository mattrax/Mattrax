/**
 * Installed-application inventory writes, shared by Apple, Android and Windows.
 *
 * A device reports its complete installed-application list, so each refresh
 * replaces the previous rows: applications that disappeared are deleted rather
 * than left to look installed forever. Every platform normalises its own wire
 * format into {@link DeviceApplicationRecord} and hands the list here, which
 * keeps one set of delete/insert bounds for the whole fleet.
 */

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import type { EnterpriseDb } from "./db.ts";
import { device, deviceApplication } from "./schema.ts";

/** Largest inventory accepted from one device; larger reports are truncated. */
export const MAX_DEVICE_APPLICATIONS = 2_000;

/** Rows per `INSERT` / `DELETE`, comfortably under MySQL's packet limit. */
const WRITE_CHUNK_SIZE = 200;

/**
 * One normalised application. `bundleId` is the Apple bundle identifier, the
 * Android package name, or the Windows MSI product code / registry key.
 */
export type DeviceApplicationRecord = {
  readonly bundleId: string;
  readonly name?: string | null;
  readonly version?: string | null;
  readonly shortVersion?: string | null;
  readonly publisher?: string | null;
  readonly bundleSize?: number | null;
  readonly dynamicSize?: number | null;
  readonly hasUpdateAvailable?: boolean;
  readonly isManaged?: boolean;
};

const TEXT_LIMIT = 255;

/** MySQL rejects oversized strings; a pathological vendor string is clipped. */
const text = (value: string | null | undefined): string | null => {
  if (value == null) return null;

  const trimmed = value.trim();

  if (!trimmed) return null;

  return trimmed.length > TEXT_LIMIT ? trimmed.slice(0, TEXT_LIMIT) : trimmed;
};

/** Non-negative byte counts only; a negative or NaN size is not a size. */
const bytes = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : null;

const chunks = <A>(values: ReadonlyArray<A>, size: number): A[][] => {
  const result: A[][] = [];

  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));

  return result;
};

/** Normalised row values, used both to write and to detect a no-op report. */
const rowValues = (application: DeviceApplicationRecord) => ({
  name: text(application.name),
  version: text(application.version),
  shortVersion: text(application.shortVersion),
  publisher: text(application.publisher),
  bundleSize: bytes(application.bundleSize),
  dynamicSize: bytes(application.dynamicSize),
  hasUpdateAvailable: application.hasUpdateAvailable ?? false,
  isManaged: application.isManaged ?? false,
});

/**
 * Replace a device's installed-application inventory.
 *
 * De-duplicates by `bundleId` (last report wins), drops entries without an
 * identifier and caps the list at {@link MAX_DEVICE_APPLICATIONS}. Android
 * reports on every status notification, so an unchanged list only moves
 * `applicationsUpdatedAt`; a changed list replaces the rows inside one
 * transaction, which keeps a failed insert from leaving the device with an
 * empty inventory.
 */
export const replaceDeviceApplications = (
  db: EnterpriseDb,
  input: {
    readonly deviceId: string;
    readonly organizationId: string;
    readonly applications: ReadonlyArray<DeviceApplicationRecord>;
    readonly reportedAt: Date;
  },
): Effect.Effect<number, unknown> =>
  db.transaction((tx) =>
    Effect.gen(function* () {
      const normalized = new Map<string, DeviceApplicationRecord>();

      for (const application of input.applications) {
        const bundleId = text(application.bundleId);

        if (!bundleId) continue;
        normalized.set(bundleId, { ...application, bundleId });
      }

      const applications = [...normalized.values()]
        .sort((left, right) => left.bundleId.localeCompare(right.bundleId))
        .slice(0, MAX_DEVICE_APPLICATIONS);

      const existing = yield* tx
        .select()
        .from(deviceApplication)
        .where(
          and(
            eq(deviceApplication.deviceId, input.deviceId),
            eq(deviceApplication.organizationId, input.organizationId),
          ),
        );

      const existingById = new Map(existing.map((row) => [row.bundleId, row]));

      const unchanged =
        existing.length === applications.length &&
        applications.every((application) => {
          const row = existingById.get(application.bundleId);

          if (!row) return false;
          const values = rowValues(application);

          return (
            row.name === values.name &&
            row.version === values.version &&
            row.shortVersion === values.shortVersion &&
            row.publisher === values.publisher &&
            row.bundleSize === values.bundleSize &&
            row.dynamicSize === values.dynamicSize &&
            row.hasUpdateAvailable === values.hasUpdateAvailable &&
            row.isManaged === values.isManaged
          );
        });

      if (unchanged)
        yield* tx
          .update(deviceApplication)
          .set({ lastReportedAt: input.reportedAt })
          .where(
            and(
              eq(deviceApplication.deviceId, input.deviceId),
              eq(deviceApplication.organizationId, input.organizationId),
            ),
          );
      else {
        yield* tx
          .delete(deviceApplication)
          .where(
            and(
              eq(deviceApplication.deviceId, input.deviceId),
              eq(deviceApplication.organizationId, input.organizationId),
            ),
          );

        for (const chunk of chunks(applications, WRITE_CHUNK_SIZE))
          yield* tx.insert(deviceApplication).values(
            chunk.map((application) => ({
              deviceId: input.deviceId,
              organizationId: input.organizationId,
              bundleId: text(application.bundleId)!,
              ...rowValues(application),
              lastReportedAt: input.reportedAt,
            })),
          );
      }

      yield* tx
        .update(device)
        .set({ applicationsUpdatedAt: input.reportedAt })
        .where(and(eq(device.id, input.deviceId), eq(device.organizationId, input.organizationId)));

      return applications.length;
    }),
  );

/**
 * Remove every inventoried application for a device (for example when it
 * unenrolls), leaving `applicationsUpdatedAt` untouched so the page still shows
 * when the last report arrived.
 */
export const clearDeviceApplications = (
  db: EnterpriseDb,
  input: { readonly deviceId: string; readonly organizationId: string },
): Effect.Effect<void, unknown> =>
  db
    .delete(deviceApplication)
    .where(
      and(
        eq(deviceApplication.deviceId, input.deviceId),
        eq(deviceApplication.organizationId, input.organizationId),
      ),
    );

/** Bundle ids already stored for a device, used by tests and diff reporting. */
export const deviceApplicationIds = (
  db: EnterpriseDb,
  input: { readonly deviceId: string; readonly organizationId: string },
): Effect.Effect<ReadonlyArray<string>, unknown> =>
  Effect.map(
    db
      .select({ bundleId: deviceApplication.bundleId })
      .from(deviceApplication)
      .where(
        and(
          eq(deviceApplication.deviceId, input.deviceId),
          eq(deviceApplication.organizationId, input.organizationId),
        ),
      ),
    (rows) => rows.map((row) => row.bundleId),
  );
