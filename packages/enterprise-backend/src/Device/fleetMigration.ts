import { FleetMigrationId, MigrationEntryId } from "@mattrax/crypto";
import { Effect } from "effect";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { schema as s } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import {
  FLEET_MIGRATION_LIST_MAX,
  FLEET_MIGRATION_MAX_DEVICES,
  FLEET_MIGRATION_NAME_MAX_LENGTH,
  clampMigrationStuckDays,
  clampMigrationUnenrolBatch,
  fleetMigrationStatusLabel,
  migrationEnrolmentGuide,
  migrationEntryActions,
  migrationObservationChanges,
  migrationTransitionAllowed,
  migrationTransitionProblem,
  migrationUnenrolDeploymentHint,
  migrationUnenrolRecipe,
  normalizeMigrationSerial,
  normalizeMigrationSerials,
  observeMigrationEntry,
  platformLabel,
} from "@mattrax/enterprise-domain";
import type {
  CreateFleetMigrationRequest,
  CreateFleetMigrationResponse,
  FleetMigrationCounts,
  FleetMigrationDetail,
  FleetMigrationEntry,
  FleetMigrationEntryStatus,
  FleetMigrationPlatform,
  FleetMigrationSummary,
  FleetMigrationUnenrolResult,
  IssueFleetMigrationUnenrolRequest,
  IssueFleetMigrationUnenrolResponse,
} from "@mattrax/enterprise-domain";
import { queueScriptRun } from "../Policy/scripts.ts";
import { toCsv } from "./deviceSearch.ts";

/**
 * Fleet migration cohorts.
 *
 * The HTTP layer owns RBAC, step-up and audit; this module owns the tenant
 * scoped persistence, the reconciliation that turns observations into status
 * transitions, and the export. Everything is derived from what the server can
 * see (a script result, a device row with the cohort serial, a deadline) so a
 * stale cohort always explains itself and a read is idempotent.
 */

type MigrationRow = typeof s.fleetMigration.$inferSelect;

type EntryRow = typeof s.fleetMigrationDevice.$inferSelect;

type DeviceRow = typeof s.device.$inferSelect;

type ExecutionRow = typeof s.scriptExecution.$inferSelect;

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);


// SAFETY: both columns are SQL enums, so every stored value is one of the
// literals; the casts only restore the type the column enum erases.
const statusOf = (value: string): FleetMigrationEntryStatus => value as FleetMigrationEntryStatus;

// SAFETY: as above, the platform column only stores these three values.
const platformOf = (value: string): FleetMigrationPlatform => value as FleetMigrationPlatform;

/** Human-readable problem instead of a thrown error, like the script module. */
export type FleetMigrationProblem = { readonly problem: string };

const problem = (message: string): FleetMigrationProblem => ({ problem: message });

const migrationById = (db: EnterpriseDb, organizationId: string, migrationId: string) =>
  Effect.gen(function* () {
    const [row] = yield* db
      .select()
      .from(s.fleetMigration)
      .where(
        and(
          eq(s.fleetMigration.id, migrationId),
          eq(s.fleetMigration.organizationId, organizationId),
        ),
      )
      .limit(1);

    return row;
  });

const entriesFor = (db: EnterpriseDb, organizationId: string, migrationId: string) =>
  db
    .select()
    .from(s.fleetMigrationDevice)
    .where(
      and(
        eq(s.fleetMigrationDevice.organizationId, organizationId),
        eq(s.fleetMigrationDevice.migrationId, migrationId),
      ),
    )
    .orderBy(asc(s.fleetMigrationDevice.serial));

const emptyCounts = (): FleetMigrationCounts => ({
  total: 0,
  pending: 0,
  unenrolIssued: 0,
  awaitingEnrolment: 0,
  enrolled: 0,
  confirmed: 0,
  stuck: 0,
});

export const fleetMigrationCounts = (entries: ReadonlyArray<EntryRow>): FleetMigrationCounts => {
  // A mutable copy of the (readonly) wire shape so the loop can tally in place.
  const counts: { -readonly [K in keyof FleetMigrationCounts]: number } = emptyCounts();

  for (const entry of entries) {
    counts.total += 1;

    switch (entry.status) {
      case "pending":
        counts.pending += 1;
        break;
      case "unenrol-issued":
        counts.unenrolIssued += 1;
        break;
      case "awaiting-enrolment":
        counts.awaitingEnrolment += 1;
        break;
      case "enrolled":
        counts.enrolled += 1;
        break;
      case "confirmed":
        counts.confirmed += 1;
        break;
      case "stuck":
        counts.stuck += 1;
        break;
    }
  }

  return counts;
};

const summary = (
  row: MigrationRow,
  entries: ReadonlyArray<EntryRow>,
  groupName: string | null,
): FleetMigrationSummary => ({
  id: row.id,
  name: row.name,
  sourceMdm: row.sourceMdm,
  platforms: row.platforms.map(platformOf),
  groupId: row.groupId,
  groupName,
  stuckAfterDays: row.stuckAfterDays,
  counts: fleetMigrationCounts(entries),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const entryInfo = (row: EntryRow, device: DeviceRow | undefined): FleetMigrationEntry => {
  const status = statusOf(row.status);

  return {
    id: row.id,
    migrationId: row.migrationId,
    serial: row.serial,
    platform: platformOf(row.platform),
    status,
    deviceId: row.deviceId,
    deviceName: device?.name ?? null,
    executionId: row.executionId,
    unenrolIssuedAt: iso(row.unenrolIssuedAt),
    awaitingEnrolmentAt: iso(row.awaitingEnrolmentAt),
    enrolledAt: iso(row.enrolledAt),
    confirmedAt: iso(row.confirmedAt),
    stuckAt: iso(row.stuckAt),
    lastEvidence: row.lastEvidence,
    actions: [...migrationEntryActions(status)],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
};

const devicesBySerial = (
  db: EnterpriseDb,
  organizationId: string,
  serials: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    if (serials.length === 0) return new Map<string, DeviceRow>();

    // The cohort stores canonical uppercase serials. The comparison is served by
    // the serial column's collation (MySQL's default is case-insensitive), and
    // the map is keyed by the normalised value either way.
    const rows = yield* db
      .select()
      .from(s.device)
      .where(
        and(
          eq(s.device.organizationId, organizationId),
          inArray(s.device.serial, [...new Set(serials)]),
        ),
      );

    return new Map(
      rows.flatMap((row) =>
        row.serial ? [[normalizeMigrationSerial(row.serial), row] as const] : [],
      ),
    );
  });

const executionsById = (db: EnterpriseDb, organizationId: string, ids: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (ids.length === 0) return new Map<string, ExecutionRow>();

    const rows = yield* db
      .select()
      .from(s.scriptExecution)
      .where(
        and(
          eq(s.scriptExecution.organizationId, organizationId),
          inArray(s.scriptExecution.id, [...new Set(ids)]),
        ),
      );

    return new Map(rows.map((row) => [row.id, row]));
  });

/**
 * Bring one cohort's stored state in line with the observations.
 *
 * Return matching is by serial because the cohort exists before the device
 * does: a device row for the serial is the evidence that the handoff worked.
 * Updates are conditional on the status the reconciliation read, so a
 * concurrent operator action is never overwritten.
 */
export const reconcileFleetMigration = (db: EnterpriseDb, migration: MigrationRow, now: Date) =>
  Effect.gen(function* () {
    const entries = yield* entriesFor(db, migration.organizationId, migration.id);

    if (entries.length === 0) return { updated: 0, enrolled: 0, stuck: 0 };

    const [devices, executions] = yield* Effect.all(
      [
        devicesBySerial(
          db,
          migration.organizationId,
          entries.map((entry) => entry.serial),
        ),
        executionsById(
          db,
          migration.organizationId,
          entries.flatMap((entry) => (entry.executionId ? [entry.executionId] : [])),
        ),
      ],
      { concurrency: "unbounded" },
    );

    let updated = 0;
    let enrolled = 0;
    let stuck = 0;

    for (const entry of entries) {
      const status = statusOf(entry.status);
      const device = devices.get(normalizeMigrationSerial(entry.serial));
      const execution = entry.executionId ? (executions.get(entry.executionId) ?? null) : null;

      const observation = observeMigrationEntry(
        {
          status,
          platform: platformOf(entry.platform),
          serial: entry.serial,
          deviceId: entry.deviceId,
          unenrolIssuedAt: entry.unenrolIssuedAt,
          stuckAfterDays: migration.stuckAfterDays,
          now,
        },
        device
          ? {
              id: device.id,
              name: device.name,
              serial: device.serial,
              status: device.status,
              enrolledAt: device.enrolledAt ?? null,
            }
          : null,
        execution
          ? {
              id: execution.id,
              status: execution.status,
              exitCode: execution.exitCode,
              detail: execution.resultDetail,
            }
          : null,
      );

      if (!migrationObservationChanges(entry, observation)) continue;

      const change = observation!;

      yield* db
        .update(s.fleetMigrationDevice)
        .set({
          status: change.status,
          lastEvidence: change.lastEvidence,
          deviceId: change.deviceId === undefined ? entry.deviceId : change.deviceId,
          awaitingEnrolmentAt: change.awaitingEnrolmentAt ?? entry.awaitingEnrolmentAt,
          enrolledAt: change.enrolledAt ?? entry.enrolledAt,
          stuckAt: change.stuckAt ?? entry.stuckAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(s.fleetMigrationDevice.id, entry.id),
            eq(s.fleetMigrationDevice.organizationId, migration.organizationId),
            eq(s.fleetMigrationDevice.status, entry.status),
          ),
        );

      updated += 1;

      if (change.status === "enrolled") enrolled += 1;

      if (change.status === "stuck") stuck += 1;
    }

    return { updated, enrolled, stuck };
  });

/** Daily maintenance: reconcile every cohort, bounded per run. */
export const sweepFleetMigrations = (db: EnterpriseDb, input: { readonly now: Date }) =>
  Effect.gen(function* () {
    const migrations = yield* db
      .select()
      .from(s.fleetMigration)
      .orderBy(asc(s.fleetMigration.updatedAt))
      .limit(FLEET_MIGRATION_LIST_MAX);

    let enrolled = 0;
    let stuck = 0;

    for (const migration of migrations) {
      const result = yield* reconcileFleetMigration(db, migration, input.now);

      enrolled += result.enrolled;
      stuck += result.stuck;
    }

    return { migrations: migrations.length, enrolled, stuck };
  });

const groupNames = (db: EnterpriseDb, organizationId: string) =>
  Effect.gen(function* () {
    const groups = yield* db
      .select({ id: s.enterpriseGroup.id, name: s.enterpriseGroup.name })
      .from(s.enterpriseGroup)
      .where(eq(s.enterpriseGroup.organizationId, organizationId));

    return new Map(groups.map((group) => [group.id, group.name]));
  });

export const listFleetMigrations = (db: EnterpriseDb, organizationId: string, now: Date) =>
  Effect.gen(function* () {
    const migrations = yield* db
      .select()
      .from(s.fleetMigration)
      .where(eq(s.fleetMigration.organizationId, organizationId))
      .orderBy(desc(s.fleetMigration.createdAt))
      .limit(FLEET_MIGRATION_LIST_MAX);

    const names = yield* groupNames(db, organizationId);

    const rows: FleetMigrationSummary[] = [];

    for (const migration of migrations) {
      yield* reconcileFleetMigration(db, migration, now);

      const entries = yield* entriesFor(db, organizationId, migration.id);

      rows.push(
        summary(
          migration,
          entries,
          migration.groupId ? (names.get(migration.groupId) ?? null) : null,
        ),
      );
    }

    return { migrations: rows };
  });

export const getFleetMigration = (
  db: EnterpriseDb,
  organizationId: string,
  migrationId: string,
  origin: string,
  now: Date,
) =>
  Effect.gen(function* () {
    const migration = yield* migrationById(db, organizationId, migrationId);

    if (!migration) return null;

    yield* reconcileFleetMigration(db, migration, now);

    const entries = yield* entriesFor(db, organizationId, migration.id);

    const devices = yield* devicesBySerial(
      db,
      organizationId,
      entries.map((entry) => entry.serial),
    );

    const names = yield* groupNames(db, organizationId);

    const enrollment = {
      url: migrationEnrolmentGuide({
        platform: migration.platforms[0] ?? "apple",
        origin,
        organizationId,
      }).enrollmentUrl,
      guides: migration.platforms.flatMap((platform) => {
        const guide = migrationEnrolmentGuide({ platform, origin, organizationId });

        return [
          {
            platform: guide.platform,
            enrollmentUrl: guide.enrollmentUrl,
            label: guide.label,
            steps: [...guide.steps],
            profileUrl: guide.profileUrl,
            note: guide.note,
          },
        ];
      }),
      unenrol: migration.platforms.map((platform) => {
        const recipe = migrationUnenrolRecipe(platform);

        return {
          platform,
          delivery: recipe.delivery,
          instructions: recipe.instructions,
          script: recipe.script?.body ?? null,
        };
      }),
      deploymentHint: migrationUnenrolDeploymentHint(migration.sourceMdm),
    };

    return {
      migration: summary(
        migration,
        entries,
        migration.groupId ? (names.get(migration.groupId) ?? null) : null,
      ),
      entries: entries.map((entry) =>
        entryInfo(entry, devices.get(normalizeMigrationSerial(entry.serial))),
      ),
      enrollment,
    } satisfies FleetMigrationDetail;
  });

const migrationNameProblem = (name: string): string | null => {
  const trimmed = name.trim();

  if (!trimmed) return "Name is required";

  if (trimmed.length > FLEET_MIGRATION_NAME_MAX_LENGTH)
    return "Name must be at most " + FLEET_MIGRATION_NAME_MAX_LENGTH + " characters";

  return null;
};

export const createFleetMigration = (
  db: EnterpriseDb,
  organizationId: string,
  userId: string,
  input: CreateFleetMigrationRequest,
  now: Date,
) =>
  Effect.gen(function* () {
    const nameProblem = migrationNameProblem(input.name);

    if (nameProblem) return problem(nameProblem);

    if (input.platforms.length === 0)
      return problem("Choose at least one target platform for the cohort");

    const platforms = [...new Set(input.platforms)];

    if (platforms.length !== input.platforms.length)
      return problem("Each target platform may only appear once");

    // A group seeds the cohort with its current devices. The group itself is
    // not linked to the cohort beyond that (membership changes are not a
    // migration signal), which is why the serials are copied below.
    let groupId: string | null = null;
    let groupSerials: string[] = [];

    if (input.groupId) {
      const [group] = yield* db
        .select({ id: s.enterpriseGroup.id })
        .from(s.enterpriseGroup)
        .where(
          and(
            eq(s.enterpriseGroup.id, input.groupId),
            eq(s.enterpriseGroup.organizationId, organizationId),
          ),
        )
        .limit(1);

      if (!group) return problem("The selected group does not belong to this tenant");

      groupId = group.id;

      const members = yield* db
        .select({ serial: s.device.serial })
        .from(s.groupDevice)
        .innerJoin(s.device, eq(s.device.id, s.groupDevice.deviceId))
        .where(
          and(eq(s.groupDevice.groupId, group.id), eq(s.device.organizationId, organizationId)),
        );

      groupSerials = members.flatMap((member) => (member.serial ? [member.serial] : []));
    }

    const { serials, duplicates, invalid } = normalizeMigrationSerials([
      ...(input.serials ?? []),
      ...groupSerials,
    ]);

    if (serials.length === 0 && invalid.length === 0)
      return problem("Add at least one device serial, or seed the cohort from a group");

    if (serials.length > FLEET_MIGRATION_MAX_DEVICES)
      return problem("A cohort may contain at most " + FLEET_MIGRATION_MAX_DEVICES + " devices");

    const existingDevices = yield* devicesBySerial(db, organizationId, serials);

    const skipped: Array<{ serial: string; reason: string }> = invalid.map((row) => ({
      serial: row.serial,
      reason: row.problem,
    }));

    const rows: Array<typeof s.fleetMigrationDevice.$inferInsert> = [];

    for (const serial of serials) {
      const device = existingDevices.get(serial);

      // A device Mattrax already manages is not migrating: there is nothing to
      // unenrol from an incumbent, and unenrolling it would remove our own only
      // managed copy.
      if (device && device.status === "enrolled") {
        skipped.push({
          serial,
          reason: "A device with this serial is already enrolled in Mattrax",
        });
        continue;
      }

      // SAFETY: the device proto column is the same SQL enum as the cohort.
      const devicePlatform = device?.proto;

      if (device && devicePlatform && !platforms.includes(devicePlatform)) {
        skipped.push({
          serial,
          reason:
            "The device is " +
            platformLabel(devicePlatform) +
            ", which is not a target platform of this cohort",
        });
        continue;
      }

      rows.push({
        id: MigrationEntryId.make(),
        organizationId,
        migrationId: "", // filled once the migration row has an id
        serial,
        // SAFETY: the branch above rejected a device whose proto is not a cohort
        // platform, and the platform list is non-empty (validated above).
        platform: device ? device.proto : platforms[0],
        status: "pending",
        deviceId: device?.id ?? null,
        executionId: null,
        unenrolIssuedAt: null,
        awaitingEnrolmentAt: null,
        enrolledAt: null,
        confirmedAt: null,
        stuckAt: null,
        confirmedByAccountId: null,
        lastEvidence: device
          ? "A device with this serial exists in Mattrax but is not enrolled."
          : null,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (rows.length === 0)
      return { problem: "No serials in this selection can be migrated", skipped };

    const migrationId = FleetMigrationId.make();

    yield* db.insert(s.fleetMigration).values({
      id: migrationId,
      organizationId,
      name: input.name.trim(),
      sourceMdm: input.sourceMdm,
      platforms,
      groupId,
      stuckAfterDays: clampMigrationStuckDays(input.stuckAfterDays),
      createdByAccountId: userId,
      createdAt: now,
      updatedAt: now,
    });

    yield* db
      .insert(s.fleetMigrationDevice)
      .values(rows.map((row) => ({ ...row, migrationId })))
      .onDuplicateKeyUpdate({ set: { updatedAt: now } });

    return {
      id: migrationId,
      added: rows.length,
      duplicates: [...duplicates],
      skipped,
    } satisfies CreateFleetMigrationResponse;
  });

export const deleteFleetMigration = (
  db: EnterpriseDb,
  organizationId: string,
  migrationId: string,
) =>
  Effect.gen(function* () {
    const migration = yield* migrationById(db, organizationId, migrationId);

    if (!migration) return { deleted: false };

    // Declared ON DELETE CASCADE in production; deleted explicitly so the
    // behaviour does not depend on foreign-key rules on an imported database.
    yield* db
      .delete(s.fleetMigrationDevice)
      .where(
        and(
          eq(s.fleetMigrationDevice.migrationId, migration.id),
          eq(s.fleetMigrationDevice.organizationId, organizationId),
        ),
      );

    yield* db
      .delete(s.fleetMigration)
      .where(
        and(
          eq(s.fleetMigration.id, migration.id),
          eq(s.fleetMigration.organizationId, organizationId),
        ),
      );

    return { deleted: true };
  });

/**
 * The unenrol script for one cohort/platform.
 *
 * The id is deterministic ("mig-<migration>-<platform>") so a retry reuses the
 * existing script instead of creating a second one, and the row is a real
 * script: it appears in the Scripts page, keeps its execution history, and can
 * be run or edited like any other. Deleting the cohort keeps it as history.
 */
const ensureUnenrolScript = (
  db: EnterpriseDb,
  migration: MigrationRow,
  platform: FleetMigrationPlatform,
  userId: string,
  now: Date,
) =>
  Effect.gen(function* () {
    const recipe = migrationUnenrolRecipe(platform);

    if (!recipe.script) return null;

    const scriptId = "mig-" + migration.id + "-" + platform;

    const [existing] = yield* db
      .select()
      .from(s.script)
      .where(and(eq(s.script.id, scriptId), eq(s.script.organizationId, migration.organizationId)))
      .limit(1);

    if (existing) return existing;

    const name = ("Migration unenrol · " + migration.name + " · " + platformLabel(platform)).slice(
      0,
      120,
    );

    yield* db
      .insert(s.script)
      .values({
        id: scriptId,
        organizationId: migration.organizationId,
        name,
        description:
          "Created by a fleet migration cohort. Removes the incumbent MDM profile before the device re-enrols in Mattrax.",
        language: recipe.script.language,
        body: recipe.script.body,
        runAs: recipe.script.runAs,
        timeoutSeconds: recipe.script.timeoutSeconds,
        environment: null,
        triggerType: "manual",
        intervalSeconds: null,
        cronExpression: null,
        enabled: true,
        createdByAccountId: userId,
        createdAt: now,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({ set: { updatedAt: now } });

    const [created] = yield* db
      .select()
      .from(s.script)
      .where(and(eq(s.script.id, scriptId), eq(s.script.organizationId, migration.organizationId)))
      .limit(1);

    return created ?? null;
  });

/**
 * Issue (or re-issue) the unenrol handoff for a bounded batch.
 *
 * Delivery follows what is possible: a device Mattrax manages gets the script
 * queued through the normal script queue and its exit result becomes the
 * cohort's evidence; a device only the incumbent can reach gets the same script
 * back in the response for the operator to deploy there, with the manual
 * equivalent when no script exists (Windows, Android).
 */
export const issueFleetMigrationUnenrol = (
  db: EnterpriseDb,
  organizationId: string,
  migrationId: string,
  userId: string,
  input: IssueFleetMigrationUnenrolRequest,
  now: Date,
) =>
  Effect.gen(function* () {
    const migration = yield* migrationById(db, organizationId, migrationId);

    if (!migration) return null;

    // Script delivery is what makes an automatic handoff possible; with scripts
    // disabled the agent is never offered one, so every device is a manual step.
    const organization = yield* db.query.organization.findFirst({
      where: { id: organizationId },
    });

    const scriptsEnabled = organization?.scriptsEnabled === true;

    yield* reconcileFleetMigration(db, migration, now);

    const entries = yield* entriesFor(db, organizationId, migration.id);

    const requested = input.entryIds ? new Set(input.entryIds) : null;

    const candidates = entries
      .filter((entry) => !requested || requested.has(entry.id))
      // A default batch only picks up work that has not been handed off yet.
      // Re-issuing a device that is already `unenrol-issued` is explicit: the
      // operator selects the stragglers (or a stuck device, which is eligible).
      .filter(
        (entry) =>
          requested !== null ||
          (statusOf(entry.status) !== "unenrol-issued" &&
            statusOf(entry.status) !== "awaiting-enrolment"),
      )
      .filter((entry) => migrationTransitionAllowed(statusOf(entry.status), "unenrol-issued"))
      // Retry the oldest handoff first so a cohort drains in order.
      .sort((left, right) => {
        const leftAt = left.unenrolIssuedAt?.getTime() ?? 0;
        const rightAt = right.unenrolIssuedAt?.getTime() ?? 0;

        return leftAt - rightAt || left.serial.localeCompare(right.serial);
      });

    const limit = clampMigrationUnenrolBatch(input.limit);
    const batch = candidates.slice(0, limit);

    const devices = yield* devicesBySerial(
      db,
      organizationId,
      batch.map((entry) => entry.serial),
    );

    // Unenrolling a device that is Mattrax's only managed copy removes the only
    // way to reach it until it re-enrols. That needs an explicit confirmation.
    const soleCopies = batch.flatMap((entry) => {
      const device = devices.get(normalizeMigrationSerial(entry.serial));

      return device?.status === "enrolled" ? [entry.serial] : [];
    });

    if (soleCopies.length > 0 && input.confirmSoleCopy !== true)
      return {
        problem:
          soleCopies.length +
          " device(s) in this batch are still enrolled in Mattrax. Removing the incumbent profile also removes Mattrax's only managed copy, so re-send the request with confirmSoleCopy to continue.",
        soleCopies,
      };

    const results: FleetMigrationUnenrolResult[] = [];

    for (const entry of batch) {
      const platform = platformOf(entry.platform);
      const device = devices.get(normalizeMigrationSerial(entry.serial));
      const recipe = migrationUnenrolRecipe(platform);

      // A device Mattrax can reach and that supports a script gets the handoff
      // through the existing script queue; everything else is the operator's
      // documented manual step in the incumbent MDM.
      const script =
        scriptsEnabled && recipe.script && device && device.status === "enrolled"
          ? yield* ensureUnenrolScript(db, migration, platform, userId, now)
          : null;

      if (script) {
        // The agent only receives scripts assigned to it, so queueing an
        // execution is not enough: the cohort script is also assigned to the
        // device. The assignment is idempotent and shared by later runs.
        const [assignment] = yield* db
          .select({ scriptId: s.scriptAssignment.scriptId })
          .from(s.scriptAssignment)
          .where(
            and(
              eq(s.scriptAssignment.organizationId, organizationId),
              eq(s.scriptAssignment.scriptId, script.id),
              eq(s.scriptAssignment.targetType, "device"),
              eq(s.scriptAssignment.targetId, device!.id),
            ),
          )
          .limit(1);

        if (!assignment)
          yield* db.insert(s.scriptAssignment).values({
            scriptId: script.id,
            organizationId,
            targetType: "device",
            targetId: device!.id,
            createdAt: now,
          });

        const queued = yield* queueScriptRun(db, organizationId, script, device!, userId, now);

        if (queued.target.skippedReason) {
          results.push({
            entryId: entry.id,
            serial: entry.serial,
            platform,
            status: statusOf(entry.status),
            delivery: "script",
            executionId: null,
            instructions: recipe.instructions,
            skippedReason: queued.target.skippedReason,
          });
          continue;
        }

        const evidence =
          'Unenrol script queued for "' +
          device!.name +
          '" (execution ' +
          queued.target.executionId +
          ").";

        yield* db
          .update(s.fleetMigrationDevice)
          .set({
            status: "unenrol-issued",
            deviceId: device!.id,
            executionId: queued.target.executionId,
            unenrolIssuedAt: now,
            stuckAt: null,
            lastEvidence: evidence,
            updatedAt: now,
          })
          .where(
            and(
              eq(s.fleetMigrationDevice.id, entry.id),
              eq(s.fleetMigrationDevice.organizationId, organizationId),
              eq(s.fleetMigrationDevice.status, entry.status),
            ),
          );

        results.push({
          entryId: entry.id,
          serial: entry.serial,
          platform,
          status: "unenrol-issued",
          delivery: "script",
          executionId: queued.target.executionId,
          instructions: recipe.instructions,
          skippedReason: null,
        });
        continue;
      }

      const evidence =
        recipe.delivery === "script"
          ? "Unenrol handoff issued; deploy the cohort script through the incumbent MDM (" +
            migrationUnenrolDeploymentHint(migration.sourceMdm) +
            ")."
          : "Manual unenrol required in the incumbent MDM: " + recipe.instructions;

      yield* db
        .update(s.fleetMigrationDevice)
        .set({
          status: "unenrol-issued",
          executionId: null,
          unenrolIssuedAt: now,
          stuckAt: null,
          lastEvidence: evidence,
          updatedAt: now,
        })
        .where(
          and(
            eq(s.fleetMigrationDevice.id, entry.id),
            eq(s.fleetMigrationDevice.organizationId, organizationId),
            eq(s.fleetMigrationDevice.status, entry.status),
          ),
        );

      results.push({
        entryId: entry.id,
        serial: entry.serial,
        platform,
        status: "unenrol-issued",
        delivery: recipe.delivery,
        executionId: null,
        instructions: recipe.instructions,
        skippedReason: null,
      });
    }

    const remaining = candidates.length - batch.length;

    return {
      issued: results.filter((result) => !result.skippedReason).length,
      skipped: results.filter((result) => result.skippedReason).length,
      results,
      remaining: Math.max(remaining, 0),
      soleCopies,
    } satisfies IssueFleetMigrationUnenrolResponse;
  });

const updateEntry = (
  db: EnterpriseDb,
  organizationId: string,
  entry: EntryRow,
  patch: Partial<typeof s.fleetMigrationDevice.$inferInsert>,
  now: Date,
) =>
  db
    .update(s.fleetMigrationDevice)
    .set({ ...patch, updatedAt: now })
    .where(
      and(
        eq(s.fleetMigrationDevice.id, entry.id),
        eq(s.fleetMigrationDevice.organizationId, organizationId),
      ),
    );

const entryById = (
  db: EnterpriseDb,
  organizationId: string,
  migrationId: string,
  entryId: string,
) =>
  Effect.gen(function* () {
    const [entry] = yield* db
      .select()
      .from(s.fleetMigrationDevice)
      .where(
        and(
          eq(s.fleetMigrationDevice.id, entryId),
          eq(s.fleetMigrationDevice.organizationId, organizationId),
          eq(s.fleetMigrationDevice.migrationId, migrationId),
        ),
      )
      .limit(1);

    return entry;
  });

/** The operator's confirmation that the incumbent unenrol actually happened. */
export const markFleetMigrationUnenrolled = (
  db: EnterpriseDb,
  organizationId: string,
  migrationId: string,
  entryId: string,
  now: Date,
) =>
  Effect.gen(function* () {
    const entry = yield* entryById(db, organizationId, migrationId, entryId);

    if (!entry) return null;

    const transition = migrationTransitionProblem(statusOf(entry.status), "awaiting-enrolment");

    if (transition) return problem(transition);

    const evidence = "Operator confirmed the incumbent unenrol was completed.";

    yield* updateEntry(
      db,
      organizationId,
      entry,
      {
        status: "awaiting-enrolment",
        awaitingEnrolmentAt: now,
        stuckAt: null,
        lastEvidence: evidence,
      },
      now,
    );

    return { status: "awaiting-enrolment" as const, lastEvidence: evidence };
  });

/** The operator's confirmation that the user accepted the Mattrax profile. */
export const confirmFleetMigrationEntry = (
  db: EnterpriseDb,
  organizationId: string,
  migrationId: string,
  entryId: string,
  userId: string,
  now: Date,
) =>
  Effect.gen(function* () {
    const entry = yield* entryById(db, organizationId, migrationId, entryId);

    if (!entry) return null;

    const transition = migrationTransitionProblem(statusOf(entry.status), "confirmed");

    if (transition) return problem(transition);

    const evidence = "Operator confirmed the device is enrolled and the user accepted the profile.";

    yield* updateEntry(
      db,
      organizationId,
      entry,
      {
        status: "confirmed",
        confirmedAt: now,
        confirmedByAccountId: userId,
        lastEvidence: evidence,
      },
      now,
    );

    return { status: "confirmed" as const, lastEvidence: evidence };
  });

// --- Export ----------------------------------------------------------------

export type FleetMigrationExportRow = {
  readonly serial: string;
  readonly platform: FleetMigrationPlatform;
  readonly status: FleetMigrationEntryStatus;
  readonly deviceName: string;
  readonly deviceId: string;
  readonly unenrolIssuedAt: string;
  readonly enrolledAt: string;
  readonly confirmedAt: string;
  readonly stuckAt: string;
  readonly lastEvidence: string;
  readonly sourceMdm: string;
  readonly enrollmentUrl: string;
  readonly instructions: string;
};

/**
 * One export row per device: the cohort state plus everything another MDM needs
 * to re-enrol it (URL and per-platform instructions). Built as data so the JSON
 * and CSV exports cannot drift.
 */
export const fleetMigrationExportRows = (input: {
  readonly migration: MigrationRow;
  readonly entries: ReadonlyArray<EntryRow>;
  readonly devices: ReadonlyMap<string, DeviceRow>;
  readonly origin: string;
}): ReadonlyArray<FleetMigrationExportRow> => {
  const migration = input.migration;

  return input.entries.map((entry) => {
    const platform = platformOf(entry.platform);

    const guide = migrationEnrolmentGuide({
      platform,
      origin: input.origin,
      organizationId: migration.organizationId,
    });

    const device = input.devices.get(normalizeMigrationSerial(entry.serial));

    return {
      serial: entry.serial,
      platform,
      status: statusOf(entry.status),
      deviceName: device?.name ?? "",
      deviceId: device?.id ?? "",
      unenrolIssuedAt: iso(entry.unenrolIssuedAt) ?? "",
      enrolledAt: iso(entry.enrolledAt) ?? "",
      confirmedAt: iso(entry.confirmedAt) ?? "",
      stuckAt: iso(entry.stuckAt) ?? "",
      lastEvidence: entry.lastEvidence ?? "",
      sourceMdm: migration.sourceMdm,
      enrollmentUrl: guide.enrollmentUrl,
      instructions: [...guide.steps, guide.note].join(" "),
    };
  });
};

export const fleetMigrationExportCsv = (rows: ReadonlyArray<FleetMigrationExportRow>) =>
  toCsv(
    [
      "Serial",
      "Platform",
      "Status",
      "Device",
      "Unenrol issued",
      "Enrolled",
      "Confirmed",
      "Stuck",
      "Last evidence",
      "Source MDM",
      "Enrolment URL",
      "Instructions",
    ],
    rows.map((row) => [
      row.serial,
      row.platform,
      fleetMigrationStatusLabel(row.status),
      row.deviceName,
      row.unenrolIssuedAt,
      row.enrolledAt,
      row.confirmedAt,
      row.stuckAt,
      row.lastEvidence,
      row.sourceMdm,
      row.enrollmentUrl,
      row.instructions,
    ]),
  );

export const fleetMigrationExportJson = (input: {
  readonly migration: MigrationRow;
  readonly rows: ReadonlyArray<FleetMigrationExportRow>;
}) =>
  JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString(),
      migration: {
        id: input.migration.id,
        name: input.migration.name,
        sourceMdm: input.migration.sourceMdm,
        platforms: input.migration.platforms,
        stuckAfterDays: input.migration.stuckAfterDays,
      },
      devices: input.rows,
    },
    null,
    2,
  );

export const exportFleetMigration = (
  db: EnterpriseDb,
  organizationId: string,
  migrationId: string,
  format: "csv" | "json",
  origin: string,
  now: Date,
) =>
  Effect.gen(function* () {
    const migration = yield* migrationById(db, organizationId, migrationId);

    if (!migration) return null;

    yield* reconcileFleetMigration(db, migration, now);

    const entries = yield* entriesFor(db, organizationId, migration.id);

    const devices = yield* devicesBySerial(
      db,
      organizationId,
      entries.map((entry) => entry.serial),
    );

    const rows = fleetMigrationExportRows({ migration, entries, devices, origin });

    return {
      format,
      body:
        format === "json"
          ? fleetMigrationExportJson({ migration, rows })
          : fleetMigrationExportCsv(rows),
      truncated: false,
      rowCount: rows.length,
    };
  });
