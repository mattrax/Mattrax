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
import {
  DEVICE_COMMAND_RECONCILED_RESULT_STATUS,
  planApplicationUninstallReconciliation,
} from "@mattrax/enterprise-domain";
import type {
  ApplicationUninstallTransition,
  InstalledApplicationSnapshot,
} from "@mattrax/enterprise-domain";
import type { EnterpriseDb } from "./db.ts";
import {
  applicationInstall,
  applicationUninstall,
  device,
  deviceApplication,
  deviceCommand,
} from "./schema.ts";
import { reconcileRestrictedSoftwareForDevice } from "./restrictedSoftware.ts";

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
 * Record that Mattrax delivered a catalogue app to a device.
 *
 * Uninstall must only remove apps the tenant installed, and command history is
 * both pruned and windowed, so the provenance is persisted separately. The
 * row is replaced when another installer or version is delivered.
 */
export const recordApplicationInstall = (
  db: EnterpriseDb,
  input: {
    readonly organizationId: string;
    readonly deviceId: string;
    readonly applicationId: string;
    readonly installerId?: string | null;
    readonly platform: "apple" | "win" | "android";
    readonly bundleId: string;
    readonly at: Date;
  },
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const [existing] = yield* db
      .select({ id: applicationInstall.id })
      .from(applicationInstall)
      .where(
        and(
          eq(applicationInstall.deviceId, input.deviceId),
          eq(applicationInstall.applicationId, input.applicationId),
        ),
      )
      .limit(1);

    const values = {
      organizationId: input.organizationId,
      deviceId: input.deviceId,
      applicationId: input.applicationId,
      installerId: input.installerId ?? null,
      platform: input.platform,
      bundleId: input.bundleId,
      updatedAt: input.at,
    };

    if (existing)
      yield* db
        .update(applicationInstall)
        .set(values)
        .where(eq(applicationInstall.id, existing.id));
    else
      yield* db
        .insert(applicationInstall)
        .values({ id: crypto.randomUUID(), createdAt: input.at, ...values });
  });

/**
 * Resolve outstanding catalogue-app uninstalls against a fresh inventory.
 *
 * `succeeded` rows release the app's VPP licence when the caller supplies one
 * (see the Apple backend), because the licence must only return once the app
 * is provably gone. A row still present after its deadline becomes `failed`
 * and records the version the device kept. The queued command, when there is
 * one, is closed with the same outcome so command history and the device
 * timeline agree with the uninstall state.
 */
export const reconcileApplicationUninstalls = (
  db: EnterpriseDb,
  input: {
    readonly deviceId: string;
    readonly organizationId: string;
    readonly applications: ReadonlyArray<InstalledApplicationSnapshot>;
    readonly at: Date;
  },
): Effect.Effect<ReadonlyArray<ApplicationUninstallTransition>, unknown> =>
  Effect.gen(function* () {
    const rows = yield* db
      .select()
      .from(applicationUninstall)
      .where(
        and(
          eq(applicationUninstall.deviceId, input.deviceId),
          eq(applicationUninstall.organizationId, input.organizationId),
          eq(applicationUninstall.status, "queued"),
        ),
      );

    if (rows.length === 0) return [];

    const transitions = planApplicationUninstallReconciliation(rows, input.applications, input.at);
    const claimed: ApplicationUninstallTransition[] = [];

    for (const transition of transitions) {
      // Two concurrent check-ins can read the same queued row. Only the update
      // that still sees it queued wins, so a VPP seat cannot be released twice.
      const result = yield* db
        .update(applicationUninstall)
        .set({
          status: transition.status,
          observedVersion: transition.observedVersion ?? null,
          resultDetail: transition.resultDetail,
          updatedAt: input.at,
        })
        .where(
          and(
            eq(applicationUninstall.id, transition.id),
            eq(applicationUninstall.deviceId, input.deviceId),
            eq(applicationUninstall.status, "queued"),
          ),
        );

      if (result.affectedRows === 0) continue;

      claimed.push(transition);

      // Provenance describes a current install. Once removal is confirmed,
      // keeping it would let a later user-installed copy be claimed as
      // Mattrax's and removed.
      if (transition.status === "succeeded")
        yield* db
          .delete(applicationInstall)
          .where(
            and(
              eq(applicationInstall.deviceId, input.deviceId),
              eq(applicationInstall.applicationId, transition.applicationId),
            ),
          );

      if (!transition.commandId) continue;

      yield* db
        .update(deviceCommand)
        .set({
          status: transition.status,
          dedupeKey: null,
          resultStatus: DEVICE_COMMAND_RECONCILED_RESULT_STATUS,
          resultDetail: transition.resultDetail,
          updatedAt: input.at,
        })
        .where(
          and(
            eq(deviceCommand.id, transition.commandId),
            eq(deviceCommand.deviceId, input.deviceId),
          ),
        );
    }

    return claimed;
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
  db
    .transaction((tx) =>
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
          .where(
            and(eq(device.id, input.deviceId), eq(device.organizationId, input.organizationId)),
          );

        return applications;
      }),
    )
    .pipe(
      Effect.flatMap((applications) =>
        Effect.as(
          reconcileApplicationUninstalls(db, {
            deviceId: input.deviceId,
            organizationId: input.organizationId,
            applications,
            at: input.reportedAt,
          }),
          applications.length,
        ),
      ),
      // A fresh inventory is the moment a banned app becomes known. Running
      // detection here means every platform that replaces inventory through
      // this helper (Android and Windows today) gets violation recording
      // without a second delivery path.
      Effect.tap((count) =>
        reconcileRestrictedSoftwareForDevice(db, {
          deviceId: input.deviceId,
          organizationId: input.organizationId,
          at: input.reportedAt,
        }).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
          Effect.as(count),
        ),
      ),
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
