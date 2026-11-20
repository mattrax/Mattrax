import { Effect } from "effect";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import {
  deriveDeviceHealth,
  evaluateDeviceQuery,
  type DashboardQueryRequest,
  type DashboardQueryResponse,
  type DashboardUserFilter,
  type DeviceQuery,
} from "@mattrax/enterprise-domain";
import { schema as s, type EnterpriseDb } from "../schema.ts";
import { deviceBucket, softwareBucket, toBuckets } from "../Policy/dashboardQuery.ts";

/**
 * Dashboard widget evaluation.
 *
 * Shared by the request path (a dashboard render) and the scheduled report
 * renderer, so a report can never disagree with what the dashboard shows. The
 * evaluator works in application code on one tenant snapshot because derived
 * fields (health, enrollment age, installed apps) are not columns.
 *
 * MySQL can answer an unfiltered `COUNT(*)` directly, so a stat card over the
 * whole fleet skips the snapshot entirely.
 */

/**
 * Accept a Drizzle builder as an Effect.
 *
 * Drizzle's Effect driver returns Effects in production, while the in-memory
 * database used by unit tests exposes the same builders as iterators. Wrapping
 * each builder lets `Effect.all` keep the concurrency without either runtime
 * complaining.
 */
const queryEffect = <A, E, R>(builder: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    return yield* builder;
  });

const iso = (date: Date | number | null | undefined) => {
  if (date == null) return new Date(0).toISOString();

  return (date instanceof Date ? date : new Date(date)).toISOString();
};

const titleCase = (value: string) =>
  value.slice(0, 1).toUpperCase() + value.slice(1).replaceAll("_", " ");

/** Health for one device, derived from rows the caller already loaded. */
export const rowDeviceHealth = (
  device: Pick<
    typeof s.device.$inferSelect,
    | "status"
    | "lastSeenAt"
    | "diskTotal"
    | "diskUsed"
    | "proto"
    | "model"
    | "osEdition"
    | "fileVaultEnabled"
    | "batteryHealth"
    | "bitLockerEnabled"
    | "bitLockerStatus"
    | "tpmVersion"
    | "secureBootState"
    | "domainName"
    | "entraDeviceId"
    | "securityUpdatedAt"
  >,
  declarations: ReadonlyArray<{
    readonly identifier?: string;
    readonly declarationType?: string;
    readonly valid?: string | null;
    readonly active?: boolean;
    readonly reasons?: unknown;
  }>,
  awaitingConfiguration?: boolean | null,
) =>
  deriveDeviceHealth({
    status: device.status,
    awaitingConfiguration: awaitingConfiguration ?? null,
    lastSeenAt: device.lastSeenAt,
    declarations,
    diskTotal: device.diskTotal,
    diskUsed: device.diskUsed,
    proto: device.proto,
    model: device.model,
    osEdition: device.osEdition,
    fileVaultEnabled: device.fileVaultEnabled,
    batteryHealth: device.batteryHealth,
    bitLockerEnabled: device.bitLockerEnabled,
    bitLockerStatus: device.bitLockerStatus,
    tpmVersion: device.tpmVersion,
    secureBootState: device.secureBootState,
    domainName: device.domainName,
    entraDeviceId: device.entraDeviceId,
    windowsSecurityReported: device.securityUpdatedAt != null,
  });

export type DeviceDashboardSnapshot = {
  row: typeof s.device.$inferSelect;
  health: ReturnType<typeof rowDeviceHealth>;
  applications: ReadonlyArray<{ bundleId: string; name: string | null }>;
};

type DeviceApplicationRow = typeof s.deviceApplication.$inferSelect;

/**
 * Load every device in a tenant with the derived health and application
 * inventory the shared query evaluator needs.
 */
export const loadDeviceSnapshots = (
  db: EnterpriseDb,
  organizationId: string,
  candidates?: ReadonlyArray<typeof s.device.$inferSelect>,
  options: { readonly includeApplications?: boolean } = {},
): Effect.Effect<DeviceDashboardSnapshot[], unknown> =>
  Effect.gen(function* () {
    const rows = candidates
      ? [...candidates]
      : yield* db
          .select()
          .from(s.device)
          .where(eq(s.device.organizationId, organizationId))
          .orderBy(asc(s.device.name), asc(s.device.id));

    const ids = rows.map((row) => row.id);

    if (ids.length === 0) return [];

    /** Row shape used when the caller asked to skip the application scan. */
    const noApplications: Array<{ deviceId: string; bundleId: string; name: string | null }> = [];

    // Declarations, installed applications and ADE state are independent
    // reads over the same id set; one wave instead of three sequential ones.
    const [declarations, applications, awaiting] = yield* Effect.all(
      [
        queryEffect(
          db
            .select()
            .from(s.deviceDeclaration)
            .where(inArray(s.deviceDeclaration.deviceId, ids)),
        ),
        // Count-only device stats do not render rows, so the application
        // inventory scan is skipped unless the query actually references apps.
        options.includeApplications === false
          ? Effect.succeed(noApplications)
          : queryEffect(
              db
                .select({
                  deviceId: s.deviceApplication.deviceId,
                  bundleId: s.deviceApplication.bundleId,
                  name: s.deviceApplication.name,
                })
                .from(s.deviceApplication)
                .where(
                  and(
                    eq(s.deviceApplication.organizationId, organizationId),
                    inArray(s.deviceApplication.deviceId, ids),
                  ),
                ),
            ),
        queryEffect(
          db
            .select({
              deviceId: s.deviceApple.deviceId,
              awaitingConfiguration: s.deviceApple.awaitingConfiguration,
            })
            .from(s.deviceApple)
            .where(inArray(s.deviceApple.deviceId, ids)),
        ),
      ],
      { concurrency: "unbounded" },
    );

    const awaitingByDevice = new Map(
      awaiting.map((row) => [row.deviceId, row.awaitingConfiguration]),
    );

    const declarationsByDevice = new Map<string, Array<(typeof declarations)[number]>>();

    for (const declaration of declarations) {
      const list = declarationsByDevice.get(declaration.deviceId) ?? [];
      list.push(declaration);
      declarationsByDevice.set(declaration.deviceId, list);
    }

    const applicationsByDevice = new Map<
      string,
      Array<{ bundleId: string; name: string | null }>
    >();

    for (const application of applications) {
      const list = applicationsByDevice.get(application.deviceId) ?? [];
      list.push({ bundleId: application.bundleId, name: application.name });
      applicationsByDevice.set(application.deviceId, list);
    }

    return rows.map((row) => ({
      row,
      health: rowDeviceHealth(
        row,
        declarationsByDevice.get(row.id) ?? [],
        awaitingByDevice.get(row.id) ?? null,
      ),
      applications: applicationsByDevice.get(row.id) ?? [],
    }));
  });

const groupBucketOrder = (groupBy: string | undefined): ReadonlyArray<string> | undefined => {
  switch (groupBy) {
    case "health":
      return ["Healthy", "Attention", "Missing", "Critical", "Unknown"];
    case "platform":
      return ["Apple", "Windows", "Android", "Unknown"];
    case "status":
      return ["Active", "Disabled"];
    case "source":
      return ["Entra", "Scim", "Manual"];
    default:
      return undefined;
  }
};

/** Whether any clause of a dashboard query needs installed-application data. */
const deviceQueryNeedsApplications = (query: DeviceQuery): boolean =>
  (query.all ?? [])
    .concat(query.any ?? [], query.none ?? [])
    .some((condition) => condition.field === "application");

const isUnfilteredDeviceQuery = (query: DeviceQuery): boolean =>
  (query.all?.length ?? 0) === 0 &&
  (query.any?.length ?? 0) === 0 &&
  (query.none?.length ?? 0) === 0;

/** A stat card renders only `total`. */
const dashboardCountOnly = (payload: DashboardQueryRequest): boolean =>
  payload.countOnly === true && !payload.groupBy;

const needsDeviceSnapshot = (payload: DashboardQueryRequest): boolean =>
  payload.dataset !== "users" &&
  (payload.dataset === "software" ||
    !(dashboardCountOnly(payload) && isUnfilteredDeviceQuery(payload.query)));

const needsApplicationInventory = (payload: DashboardQueryRequest): boolean =>
  payload.dataset === "devices" && deviceQueryNeedsApplications(payload.query);

const matchingSnapshots = (
  snapshots: ReadonlyArray<DeviceDashboardSnapshot>,
  payload: DashboardQueryRequest,
  timestamp: Date,
) =>
  snapshots.filter((snapshot) =>
    evaluateDeviceQuery(
      payload.query,
      {
        ...snapshot.row,
        health: snapshot.health,
        applications: snapshot.applications,
      },
      { now: timestamp },
    ),
  );

const projectDeviceDashboardQuery = (
  payload: DashboardQueryRequest,
  matches: ReadonlyArray<DeviceDashboardSnapshot>,
  timestamp: Date,
) => {
  const limit = Math.min(Math.max(Math.trunc(Number(payload.limit ?? 100)) || 100, 1), 500);

  if (dashboardCountOnly(payload)) return { total: matches.length, buckets: [], rows: [] };

  const buckets = payload.groupBy
    ? toBuckets(
        matches.map((snapshot) =>
          deviceBucket(snapshot.row, payload.groupBy!, snapshot.health, timestamp),
        ),
        groupBucketOrder(payload.groupBy),
      )
    : [];

  return {
    total: matches.length,
    buckets,
    rows: matches.slice(0, limit).map((snapshot) => ({
      id: snapshot.row.id,
      name: snapshot.row.name,
      platform: snapshot.row.proto,
      osVersion: snapshot.row.osVersion,
      model: snapshot.row.model,
      serial: snapshot.row.serial,
      status: snapshot.row.status,
      health: snapshot.health.level,
      lastSeenAt: iso(snapshot.row.lastSeenAt),
      enrolledAt: iso(snapshot.row.enrolledAt),
    })),
  };
};

/**
 * One installed-application read for every software widget in a batch.
 *
 * Software widgets bucket the same rows by bundle id, so loading them once
 * avoids one whole-fleet inventory scan per widget.
 */
const loadApplicationsByDevice = (db: EnterpriseDb, organizationId: string, deviceIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const byDevice = new Map<string, DeviceApplicationRow[]>();

    if (deviceIds.length === 0) return byDevice;

    const rows = yield* db
      .select()
      .from(s.deviceApplication)
      .where(
        and(
          eq(s.deviceApplication.organizationId, organizationId),
          inArray(s.deviceApplication.deviceId, [...deviceIds]),
        ),
      );

    for (const row of rows) {
      const list = byDevice.get(row.deviceId);

      if (list) list.push(row);
      else byDevice.set(row.deviceId, [row]);
    }

    return byDevice;
  });

const projectSoftwareDashboardQuery = (
  db: EnterpriseDb,
  organizationId: string,
  payload: DashboardQueryRequest,
  matches: ReadonlyArray<DeviceDashboardSnapshot>,
  sharedApplications?: ReadonlyMap<string, ReadonlyArray<DeviceApplicationRow>>,
): Effect.Effect<DashboardQueryResponse, unknown> =>
  Effect.gen(function* () {
    const limit = Math.min(Math.max(Math.trunc(Number(payload.limit ?? 100)) || 100, 1), 500);
    const matchingIds = matches.map((snapshot) => snapshot.row.id);

    const applications = sharedApplications
      ? matchingIds.flatMap((id) => sharedApplications.get(id) ?? [])
      : matchingIds.length
        ? yield* db
            .select()
            .from(s.deviceApplication)
            .where(
              and(
                eq(s.deviceApplication.organizationId, organizationId),
                inArray(s.deviceApplication.deviceId, matchingIds),
              ),
            )
        : [];

    type SoftwareGroup = {
      bundleId: string;
      name: string | null;
      version: string | null;
      isManaged: boolean;
      hasUpdateAvailable: boolean;
      devices: Set<string>;
    };

    const groups = new Map<string, SoftwareGroup>();

    for (const application of applications) {
      const group = groups.get(application.bundleId) ?? {
        bundleId: application.bundleId,
        name: application.name,
        version: application.version,
        isManaged: false,
        hasUpdateAvailable: false,
        devices: new Set<string>(),
      };

      group.name ??= application.name;
      group.version ??= application.version;
      group.isManaged ||= application.isManaged;
      group.hasUpdateAvailable ||= application.hasUpdateAvailable;
      group.devices.add(application.deviceId);
      groups.set(application.bundleId, group);
    }

    const software = [...groups.values()].sort((left, right) =>
      (left.name ?? left.bundleId).localeCompare(right.name ?? right.bundleId),
    );

    const buckets = payload.groupBy
      ? toBuckets(
          software.map((application) =>
            payload.groupBy === "name"
              ? (application.name ?? application.bundleId)
              : softwareBucket(application, payload.groupBy!),
          ),
          payload.groupBy === "managed"
            ? ["Managed", "Unmanaged"]
            : payload.groupBy === "updates" || payload.groupBy === "hasUpdate"
              ? ["Update available", "Up to date"]
              : undefined,
        )
      : [];

    return {
      total: software.length,
      buckets,
      rows: software.slice(0, limit).map((application) => ({
        id: application.bundleId,
        name: application.name ?? application.bundleId,
        bundleId: application.bundleId,
        version: application.version,
        managed: application.isManaged,
        deviceCount: application.devices.size,
      })),
    };
  });

const userBucket = (
  user: { readonly disabled: boolean; readonly source: string },
  dimension: string,
): string => {
  switch (dimension) {
    case "status":
      return user.disabled ? "Disabled" : "Active";
    case "source":
      return titleCase(user.source);
    default:
      return "Unknown";
  }
};

const userMatches = (
  user: { readonly disabled: boolean; readonly source: string },
  filter: DashboardUserFilter | undefined,
) => {
  if (!filter) return true;

  if (filter.status === "active" && user.disabled) return false;

  if (filter.status === "disabled" && !user.disabled) return false;

  if (filter.source && user.source !== filter.source) return false;

  return true;
};

/**
 * User inventory.
 *
 * This is the tenant directory (`user`), not account memberships: it answers
 * "who is in the org and are they active?" and is the same list the Users page
 * shows. A report therefore includes disabled people, which is what makes the
 * active/inactive split meaningful.
 */
const projectUserDashboardQuery = (
  db: EnterpriseDb,
  organizationId: string,
  payload: DashboardQueryRequest,
): Effect.Effect<DashboardQueryResponse, unknown> =>
  Effect.gen(function* () {
    const rows = yield* db
      .select()
      .from(s.user)
      .where(eq(s.user.organizationId, organizationId))
      .orderBy(asc(s.user.name), asc(s.user.id));

    const matches = rows.filter((row) => userMatches(row, payload.userFilter));

    if (dashboardCountOnly(payload)) return { total: matches.length, buckets: [], rows: [] };

    const buckets = payload.groupBy
      ? toBuckets(
          matches.map((row) => userBucket(row, payload.groupBy!)),
          groupBucketOrder(payload.groupBy),
        )
      : [];

    const limit = Math.min(Math.max(Math.trunc(Number(payload.limit ?? 100)) || 100, 1), 500);

    return {
      total: matches.length,
      buckets,
      rows: matches.slice(0, limit).map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        status: row.disabled ? "Disabled" : "Active",
        source: titleCase(row.source),
      })),
    };
  });

const evaluateDashboardQuery = (
  db: EnterpriseDb,
  organizationId: string,
  payload: DashboardQueryRequest,
  snapshots: ReadonlyArray<DeviceDashboardSnapshot> | null,
  timestamp: Date,
  sharedApplications?: ReadonlyMap<string, ReadonlyArray<DeviceApplicationRow>>,
): Effect.Effect<DashboardQueryResponse, unknown> =>
  Effect.gen(function* () {
    if (payload.dataset === "users")
      return yield* projectUserDashboardQuery(db, organizationId, payload);

    if (
      payload.dataset === "devices" &&
      snapshots === null &&
      dashboardCountOnly(payload) &&
      isUnfilteredDeviceQuery(payload.query)
    ) {
      const [row] = yield* db
        .select({ value: count() })
        .from(s.device)
        .where(eq(s.device.organizationId, organizationId));

      return { total: Number(row?.value ?? 0), buckets: [], rows: [] };
    }

    const matches = matchingSnapshots(snapshots ?? [], payload, timestamp);

    return payload.dataset === "devices"
      ? projectDeviceDashboardQuery(payload, matches, timestamp)
      : yield* projectSoftwareDashboardQuery(
          db,
          organizationId,
          payload,
          matches,
          sharedApplications,
        );
  });

export const runDashboardQuery = (
  db: EnterpriseDb,
  organizationId: string,
  payload: DashboardQueryRequest,
): Effect.Effect<DashboardQueryResponse, unknown> =>
  Effect.gen(function* () {
    const timestamp = new Date();

    const snapshots = needsDeviceSnapshot(payload)
      ? yield* loadDeviceSnapshots(db, organizationId, undefined, {
          includeApplications: needsApplicationInventory(payload),
        })
      : null;

    return yield* evaluateDashboardQuery(db, organizationId, payload, snapshots, timestamp);
  });

/**
 * Evaluate every widget of a dashboard against one tenant snapshot.
 *
 * Each widget used to be its own request and its own whole-fleet read, so a
 * default overview paid for the device table (and health/declaration reads)
 * five times. Queries share the snapshot here and are evaluated in memory;
 * only unfiltered stat cards still need their own `COUNT(*)`.
 */
export const runDashboardQueryBatch = (
  db: EnterpriseDb,
  organizationId: string,
  payloads: ReadonlyArray<DashboardQueryRequest>,
): Effect.Effect<{ results: DashboardQueryResponse[] }, unknown> =>
  Effect.gen(function* () {
    if (payloads.length === 0) return { results: [] };

    const timestamp = new Date();

    const snapshots = payloads.some(needsDeviceSnapshot)
      ? yield* loadDeviceSnapshots(db, organizationId, undefined, {
          includeApplications: payloads.some(needsApplicationInventory),
        })
      : null;

    // Several software widgets bucket the same inventory, so read it once.
    const sharedApplications =
      snapshots && payloads.filter((payload) => payload.dataset === "software").length > 1
        ? yield* loadApplicationsByDevice(
            db,
            organizationId,
            snapshots.map((snapshot) => snapshot.row.id),
          )
        : undefined;

    const results = yield* Effect.all(
      payloads.map((payload) =>
        evaluateDashboardQuery(
          db,
          organizationId,
          payload,
          snapshots,
          timestamp,
          sharedApplications,
        ),
      ),
      { concurrency: "unbounded" },
    );

    return { results };
  });

