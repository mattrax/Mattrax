import { Effect, Option, Schema } from "effect";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { schema as s } from "@mattrax/enterprise-core";
import {
  SCRIPT_ACTIVE_STATUSES,
  SCRIPT_EXECUTION_LIST_DEFAULT,
  SCRIPT_EXECUTION_LIST_MAX,
  SCRIPT_EXECUTION_RETENTION_DAYS,
  SCRIPT_RUN_EXPIRY_MS,
  SCRIPT_TERMINAL_STATUSES,
  ScriptEnvironmentEntry,
  ScriptExecutionStatus,
  ScriptLanguage,
  ScriptRunAs,
  ScriptTriggerType,
  capScriptOutput,
  manualRunDedupeSource,
  normalizeScriptTrigger,
  resolveAssignedScriptIds,
  scriptExecutionIsExpired,
  scriptProblem,
  scriptSecretValues,
  type CreateScriptRequest,
  type PatchScriptAssignmentsRequest,
  type PatchScriptRequest,
  type RunScriptTarget,
  type ScriptAgentResultRequest,
  type ScriptAgentScript,
  type ScriptExecutionInfo,
  type ScriptInfo,
  type ScriptSettings,
} from "@mattrax/enterprise-domain";
import type { EnterpriseDb } from "../schema.ts";

/**
 * Script persistence and execution queue.
 *
 * The HTTP handlers own RBAC, step-up and audit context; this module owns the
 * tenant-scoped queries, the per-device queue and result ingestion. Every
 * query filters by `organization_id` because it is also the tenant boundary
 * for the agent result endpoint, which has no session.
 */

const day = 24 * 60 * 60 * 1000;

export const SCRIPT_EXECUTION_SWEEP_LIMIT = 5_000;

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const sha256Hex = async (value: string): Promise<string> =>
  hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));

const sha256Effect = (value: string) => Effect.promise(() => sha256Hex(value));

/** Digest of everything a device runs; a change re-runs `install` triggers. */
export const scriptDigest = async (script: {
  readonly id: string;
  readonly language: string;
  readonly body: string;
  readonly runAs: string;
  readonly timeoutSeconds: number;
  readonly environment: ReadonlyArray<ScriptEnvironmentEntry> | null;
  readonly triggerType: string;
  readonly intervalSeconds: number | null;
  readonly cronExpression: string | null;
}): Promise<string> =>
  sha256Hex(
    JSON.stringify([
      script.id,
      script.language,
      script.body,
      script.runAs,
      script.timeoutSeconds,
      script.environment ?? [],
      script.triggerType,
      script.intervalSeconds,
      script.cronExpression,
    ]),
  );

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

type ScriptRow = typeof s.script.$inferSelect;

type DeviceRow = typeof s.device.$inferSelect;

type ExecutionRow = typeof s.scriptExecution.$inferSelect;

const environmentOf = (row: ScriptRow): ReadonlyArray<ScriptEnvironmentEntry> => {
  const decoded = Schema.decodeUnknownOption(Schema.NullOr(Schema.Array(ScriptEnvironmentEntry)))(
    row.environment,
  );

  return Option.match(decoded, {
    onNone: () => [],
    onSome: (value) => value ?? [],
  });
};

const triggerOf = (row: ScriptRow) => ({
  type: Schema.decodeUnknownSync(ScriptTriggerType)(row.triggerType),
  intervalSeconds: row.intervalSeconds,
  cronExpression: row.cronExpression,
});

const toScriptInfo = (
  row: ScriptRow,
  counts: {
    readonly deviceCount: number;
    readonly groupCount: number;
    readonly assignedDeviceCount: number;
    readonly lastRunAt: Date | null;
    readonly lastRunStatus: string | null;
  },
): ScriptInfo => ({
  id: row.id,
  name: row.name,
  description: row.description,
  language: row.language,
  runAs: row.runAs,
  timeoutSeconds: row.timeoutSeconds,
  environment: [...environmentOf(row)],
  trigger: triggerOf(row),
  enabled: row.enabled,
  deviceCount: counts.deviceCount,
  groupCount: counts.groupCount,
  assignedDeviceCount: counts.assignedDeviceCount,
  lastRunAt: iso(counts.lastRunAt),
  lastRunStatus: Option.getOrNull(
    Schema.decodeUnknownOption(ScriptExecutionStatus)(counts.lastRunStatus),
  ),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const scriptById = (db: EnterpriseDb, organizationId: string, scriptId: string) =>
  db.query.script.findFirst({ where: { id: scriptId, organizationId } });

/** Device ids a script resolves to, using one query per assignment source. */
export const scriptAssignedDeviceIds = (
  db: EnterpriseDb,
  organizationId: string,
  scriptId: string,
) =>
  Effect.gen(function* () {
    const assignments = yield* db
      .select({
        targetType: s.scriptAssignment.targetType,
        targetId: s.scriptAssignment.targetId,
      })
      .from(s.scriptAssignment)
      .where(
        and(
          eq(s.scriptAssignment.organizationId, organizationId),
          eq(s.scriptAssignment.scriptId, scriptId),
        ),
      );

    const groupIds = assignments
      .filter((row) => row.targetType === "group")
      .map((row) => row.targetId);

    const directIds = assignments
      .filter((row) => row.targetType === "device")
      .map((row) => row.targetId);

    const memberIds =
      groupIds.length > 0
        ? (yield* db
            .select({ deviceId: s.groupDevice.deviceId })
            .from(s.groupDevice)
            .where(inArray(s.groupDevice.groupId, groupIds))).map((row) => row.deviceId)
        : [];

    const ids = [...new Set([...directIds, ...memberIds])];

    if (ids.length === 0) return [];

    return yield* db
      .select()
      .from(s.device)
      .where(and(eq(s.device.organizationId, organizationId), inArray(s.device.id, ids)));
  });

/** Counts and last-run summary for a page of scripts without N+1 queries. */
const scriptSummaries = (
  db: EnterpriseDb,
  organizationId: string,
  rows: ReadonlyArray<ScriptRow>,
) =>
  Effect.gen(function* () {
    if (rows.length === 0) return [];

    const scriptIds = rows.map((row) => row.id);

    const assignments = yield* db
      .select()
      .from(s.scriptAssignment)
      .where(
        and(
          eq(s.scriptAssignment.organizationId, organizationId),
          inArray(s.scriptAssignment.scriptId, scriptIds),
        ),
      );

    const groupIds = [
      ...new Set(
        assignments.filter((row) => row.targetType === "group").map((row) => row.targetId),
      ),
    ];

    const members =
      groupIds.length > 0
        ? yield* db
            .select({ groupId: s.groupDevice.groupId, deviceId: s.groupDevice.deviceId })
            .from(s.groupDevice)
            .where(inArray(s.groupDevice.groupId, groupIds))
        : [];

    const devices = yield* db
      .select({ id: s.device.id })
      .from(s.device)
      .where(eq(s.device.organizationId, organizationId));

    const tenantDeviceIds = new Set(devices.map((row) => row.id));

    // One bounded lookup per script. The previous tenant-wide 1,000-row
    // window made an old script look "never run" once a busy script had more.
    const lastRuns = yield* Effect.forEach(
      scriptIds,
      (scriptId) =>
        Effect.gen(function* () {
          return yield* db
            .select({
              status: s.scriptExecution.status,
              createdAt: s.scriptExecution.createdAt,
            })
            .from(s.scriptExecution)
            .where(
              and(
                eq(s.scriptExecution.organizationId, organizationId),
                eq(s.scriptExecution.scriptId, scriptId),
              ),
            )
            .orderBy(desc(s.scriptExecution.createdAt))
            .limit(1);
        }),
      { concurrency: 10 },
    );

    const lastRun = new Map<string, { status: string; at: Date }>();

    scriptIds.forEach((scriptId, index) => {
      const run = lastRuns[index]?.[0];

      if (run) lastRun.set(scriptId, { status: run.status, at: run.createdAt });
    });

    return rows.map((row) => {
      const own = assignments.filter((assignment) => assignment.scriptId === row.id);
      const assigned = new Set<string>();

      for (const assignment of own) {
        if (assignment.targetType === "device" && tenantDeviceIds.has(assignment.targetId))
          assigned.add(assignment.targetId);

        if (assignment.targetType === "group")
          for (const member of members)
            if (member.groupId === assignment.targetId && tenantDeviceIds.has(member.deviceId))
              assigned.add(member.deviceId);
      }

      const run = lastRun.get(row.id);

      return toScriptInfo(row, {
        deviceCount: own.filter((assignment) => assignment.targetType === "device").length,
        groupCount: own.filter((assignment) => assignment.targetType === "group").length,
        assignedDeviceCount: assigned.size,
        lastRunAt: run?.at ?? null,
        lastRunStatus: run?.status ?? null,
      });
    });
  });

export const listScripts = (
  db: EnterpriseDb,
  organization: { readonly id: string; readonly scriptsEnabled: boolean },
  permissions: ReadonlySet<string> | ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const rows = yield* db
      .select()
      .from(s.script)
      .where(eq(s.script.organizationId, organization.id))
      .orderBy(asc(s.script.name))
      .limit(500);

    return {
      scripts: [...(yield* scriptSummaries(db, organization.id, rows))],
      enabled: organization.scriptsEnabled,
      canRun: [...permissions].includes("scripts.write"),
    };
  });

export const getScriptDetail = (db: EnterpriseDb, organizationId: string, scriptId: string) =>
  Effect.gen(function* () {
    const row = yield* scriptById(db, organizationId, scriptId);

    if (!row) return null;

    const [info] = yield* scriptSummaries(db, organizationId, [row]);

    return { script: info!, body: row.body };
  });

type ScriptDraftInput = {
  readonly name: string;
  readonly description?: string | null;
  readonly language: string;
  readonly body: string;
  readonly runAs: string;
  readonly timeoutSeconds: number;
  readonly environment?: ReadonlyArray<ScriptEnvironmentEntry> | null;
  readonly trigger: {
    readonly type: ScriptTriggerType;
    readonly intervalSeconds?: number | null;
    readonly cronExpression?: string | null;
  };
  readonly enabled: boolean;
};

/** Normalised insert values, or the operator-facing validation problem. */
const draftValues = (draft: ScriptDraftInput) => {
  const problem = scriptProblem({
    name: draft.name,
    description: draft.description,
    language: draft.language,
    body: draft.body,
    runAs: draft.runAs,
    timeoutSeconds: draft.timeoutSeconds,
    environment: draft.environment,
    trigger: draft.trigger,
  });

  if (problem) return { problem } as const;

  const trigger = normalizeScriptTrigger(draft.trigger);

  return {
    values: {
      name: draft.name.trim(),
      description: draft.description?.trim() || null,
      language: Schema.decodeUnknownSync(ScriptLanguage)(draft.language),
      body: draft.body,
      runAs: Schema.decodeUnknownSync(ScriptRunAs)(draft.runAs),
      timeoutSeconds: Math.trunc(draft.timeoutSeconds),
      environment: draft.environment ? [...draft.environment] : null,
      triggerType: trigger.type,
      intervalSeconds: trigger.intervalSeconds,
      cronExpression: trigger.cronExpression,
      enabled: draft.enabled,
    },
  } as const;
};

export const createScript = (
  db: EnterpriseDb,
  organizationId: string,
  userId: string,
  input: CreateScriptRequest,
  now: Date,
) =>
  Effect.gen(function* () {
    const built = draftValues({
      ...input,
      trigger: input.trigger,
      enabled: input.enabled ?? true,
    });

    if ("problem" in built) return built;

    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 24);

    yield* db.insert(s.script).values({
      id,
      organizationId,
      ...built.values,
      createdByAccountId: userId,
      createdAt: now,
      updatedAt: now,
    });

    return { id };
  });

export const updateScript = (
  db: EnterpriseDb,
  organizationId: string,
  scriptId: string,
  input: PatchScriptRequest,
  now: Date,
) =>
  Effect.gen(function* () {
    const existing = yield* scriptById(db, organizationId, scriptId);

    if (!existing) return { notFound: true as const };

    const built = draftValues({
      name: input.name ?? existing.name,
      description: input.description === undefined ? existing.description : input.description,
      language: input.language ?? existing.language,
      body: input.body ?? existing.body,
      runAs: input.runAs ?? existing.runAs,
      timeoutSeconds: input.timeoutSeconds ?? existing.timeoutSeconds,
      environment: input.environment === undefined ? environmentOf(existing) : input.environment,
      trigger: input.trigger ?? triggerOf(existing),
      enabled: input.enabled ?? existing.enabled,
    });

    if ("problem" in built) return built;

    yield* db
      .update(s.script)
      .set({ ...built.values, updatedAt: now })
      .where(and(eq(s.script.id, scriptId), eq(s.script.organizationId, organizationId)));

    return { status: "ok" as const };
  });

export const deleteScript = (db: EnterpriseDb, organizationId: string, scriptId: string) =>
  Effect.gen(function* () {
    const existing = yield* scriptById(db, organizationId, scriptId);

    if (!existing) return { deleted: false };

    // Assignments and executions cascade with the script row.
    yield* db
      .delete(s.script)
      .where(and(eq(s.script.id, scriptId), eq(s.script.organizationId, organizationId)));

    return { deleted: true };
  });

export const getScriptAssignments = (db: EnterpriseDb, organizationId: string, scriptId: string) =>
  Effect.gen(function* () {
    const script = yield* scriptById(db, organizationId, scriptId);

    if (!script) return null;

    const rows = yield* db
      .select()
      .from(s.scriptAssignment)
      .where(
        and(
          eq(s.scriptAssignment.organizationId, organizationId),
          eq(s.scriptAssignment.scriptId, scriptId),
        ),
      );

    const deviceIds = rows.filter((row) => row.targetType === "device").map((row) => row.targetId);
    const groupIds = rows.filter((row) => row.targetType === "group").map((row) => row.targetId);

    const devices =
      deviceIds.length > 0
        ? yield* db
            .select({ id: s.device.id, name: s.device.name })
            .from(s.device)
            .where(
              and(eq(s.device.organizationId, organizationId), inArray(s.device.id, deviceIds)),
            )
        : [];

    const groups =
      groupIds.length > 0
        ? yield* db
            .select({ id: s.enterpriseGroup.id, name: s.enterpriseGroup.name })
            .from(s.enterpriseGroup)
            .where(
              and(
                eq(s.enterpriseGroup.organizationId, organizationId),
                inArray(s.enterpriseGroup.id, groupIds),
              ),
            )
        : [];

    return { devices, groups };
  });

export type AssignmentPatchResult =
  | { readonly status: "ok" }
  | { readonly notFound: true }
  | { readonly problem: string };

export const patchScriptAssignments = (
  db: EnterpriseDb,
  organizationId: string,
  scriptId: string,
  input: PatchScriptAssignmentsRequest,
  now: Date,
) =>
  Effect.gen(function* () {
    const script = yield* scriptById(db, organizationId, scriptId);

    if (!script) return { notFound: true as const };

    const deviceIds = [...(input.assign?.devices ?? []), ...(input.unassign?.devices ?? [])];
    const groupIds = [...(input.assign?.groups ?? []), ...(input.unassign?.groups ?? [])];

    if (deviceIds.length > 0) {
      const found = yield* db
        .select({ id: s.device.id })
        .from(s.device)
        .where(and(eq(s.device.organizationId, organizationId), inArray(s.device.id, deviceIds)));

      if (found.length !== new Set(deviceIds).size)
        return { problem: "One or more devices do not belong to this tenant" };
    }

    if (groupIds.length > 0) {
      const found = yield* db
        .select({ id: s.enterpriseGroup.id })
        .from(s.enterpriseGroup)
        .where(
          and(
            eq(s.enterpriseGroup.organizationId, organizationId),
            inArray(s.enterpriseGroup.id, groupIds),
          ),
        );

      if (found.length !== new Set(groupIds).size)
        return { problem: "One or more groups do not belong to this tenant" };
    }

    if (input.assign?.devices?.length)
      yield* db
        .insert(s.scriptAssignment)
        .ignore()
        .values(
          input.assign.devices.map((targetId) => ({
            scriptId,
            organizationId,
            targetType: "device" as const,
            targetId,
            createdAt: now,
          })),
        );

    if (input.assign?.groups?.length)
      yield* db
        .insert(s.scriptAssignment)
        .ignore()
        .values(
          input.assign.groups.map((targetId) => ({
            scriptId,
            organizationId,
            targetType: "group" as const,
            targetId,
            createdAt: now,
          })),
        );

    if (input.unassign?.devices?.length)
      yield* db
        .delete(s.scriptAssignment)
        .where(
          and(
            eq(s.scriptAssignment.organizationId, organizationId),
            eq(s.scriptAssignment.scriptId, scriptId),
            eq(s.scriptAssignment.targetType, "device"),
            inArray(s.scriptAssignment.targetId, input.unassign.devices),
          ),
        );

    if (input.unassign?.groups?.length)
      yield* db
        .delete(s.scriptAssignment)
        .where(
          and(
            eq(s.scriptAssignment.organizationId, organizationId),
            eq(s.scriptAssignment.scriptId, scriptId),
            eq(s.scriptAssignment.targetType, "group"),
            inArray(s.scriptAssignment.targetId, input.unassign.groups),
          ),
        );

    return { status: "ok" as const };
  });

/**
 * Expire queued runs whose deadline passed. Called before queueing and by
 * maintenance, so a stale row can never block a fresh run through the unique
 * `(device, script, dedupe_key)` index.
 */
export const expireScriptExecutions = (
  db: EnterpriseDb,
  options: { readonly now: Date; readonly scriptId?: string; readonly deviceId?: string },
) =>
  Effect.gen(function* () {
    const conditions = [
      inArray(s.scriptExecution.status, [...SCRIPT_ACTIVE_STATUSES]),
      lt(s.scriptExecution.expiresAt, options.now),
    ];

    if (options.scriptId) conditions.push(eq(s.scriptExecution.scriptId, options.scriptId));

    if (options.deviceId) conditions.push(eq(s.scriptExecution.deviceId, options.deviceId));

    const expired = yield* db
      .select({ id: s.scriptExecution.id })
      .from(s.scriptExecution)
      .where(and(...conditions))
      .limit(SCRIPT_EXECUTION_SWEEP_LIMIT);

    if (expired.length === 0) return 0;

    yield* db
      .update(s.scriptExecution)
      .set({
        status: "expired",
        dedupeKey: null,
        resultDetail: "The device did not collect this run before its deadline.",
        updatedAt: options.now,
      })
      .where(
        inArray(
          s.scriptExecution.id,
          expired.map((row) => row.id),
        ),
      );

    return expired.length;
  });

const manualDedupeKey = (scriptId: string) => sha256Effect(manualRunDedupeSource(scriptId));

/**
 * Queue a manual run on one device. Returns the existing queued execution when
 * one is already waiting, so the unique index and this lookup agree.
 */
export const queueScriptRun = (
  db: EnterpriseDb,
  organizationId: string,
  script: ScriptRow,
  device: DeviceRow,
  userId: string,
  now: Date,
) =>
  Effect.gen(function* () {
    const skip = (reason: string) => ({
      queued: false as const,
      target: {
        executionId: "",
        deviceId: device.id,
        deviceName: device.name,
        skippedReason: reason,
      },
    });

    if (device.status !== "enrolled")
      return skip("The device is not enrolled, so it cannot run a script.");

    if (device.proto === "android")
      return skip(
        "Android Management API has no arbitrary-script command. Android scripts are unsupported.",
      );

    yield* expireScriptExecutions(db, { now, scriptId: script.id, deviceId: device.id });

    const existing = yield* db
      .select({ id: s.scriptExecution.id })
      .from(s.scriptExecution)
      .where(
        and(
          eq(s.scriptExecution.organizationId, organizationId),
          eq(s.scriptExecution.scriptId, script.id),
          eq(s.scriptExecution.deviceId, device.id),
          eq(s.scriptExecution.status, "queued"),
        ),
      )
      .limit(1);

    if (existing.length > 0)
      return {
        queued: true as const,
        target: {
          executionId: existing[0]!.id,
          deviceId: device.id,
          deviceName: device.name,
          skippedReason: null,
        },
      };

    const executionId = crypto.randomUUID().replaceAll("-", "").slice(0, 24);

    yield* db
      .insert(s.scriptExecution)
      .values({
        id: executionId,
        organizationId,
        scriptId: script.id,
        deviceId: device.id,
        triggerType: "manual",
        status: "queued",
        dedupeKey: yield* manualDedupeKey(script.id),
        requestedByAccountId: userId,
        exitCode: null,
        stdout: null,
        stderr: null,
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: null,
        resultDetail: null,
        startedAt: null,
        finishedAt: null,
        expiresAt: new Date(now.getTime() + SCRIPT_RUN_EXPIRY_MS),
        createdAt: now,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({ set: { updatedAt: now } });

    // A concurrent click may have won the insert; return the row that exists so
    // both callers address the same execution.
    const [stored] = yield* db
      .select({ id: s.scriptExecution.id })
      .from(s.scriptExecution)
      .where(
        and(
          eq(s.scriptExecution.organizationId, organizationId),
          eq(s.scriptExecution.scriptId, script.id),
          eq(s.scriptExecution.deviceId, device.id),
          eq(s.scriptExecution.status, "queued"),
        ),
      )
      .orderBy(asc(s.scriptExecution.createdAt))
      .limit(1);

    return {
      queued: true as const,
      target: {
        executionId: stored?.id ?? executionId,
        deviceId: device.id,
        deviceName: device.name,
        skippedReason: null,
      },
    };
  });

/**
 * Resolve run targets and queue one execution per device. Explicit devices and
 * groups narrow the target set; without them every assigned device is used.
 * Devices the script is not assigned to are reported rather than silently run.
 */
export const runScript = (
  db: EnterpriseDb,
  organizationId: string,
  script: ScriptRow,
  input: { readonly devices?: ReadonlyArray<string>; readonly groups?: ReadonlyArray<string> },
  userId: string,
  now: Date,
) =>
  Effect.gen(function* () {
    const assigned = yield* scriptAssignedDeviceIds(db, organizationId, script.id);
    const assignedById = new Map(assigned.map((device) => [device.id, device]));

    let candidates = assigned;

    const explicit = [...(input.devices ?? []), ...(input.groups ?? [])].length > 0;

    if (explicit) {
      const groupMembers =
        input.groups && input.groups.length > 0
          ? yield* db
              .select({ deviceId: s.groupDevice.deviceId })
              .from(s.groupDevice)
              .where(inArray(s.groupDevice.groupId, [...input.groups]))
          : [];

      const requested = [
        ...new Set([...(input.devices ?? []), ...groupMembers.map((row) => row.deviceId)]),
      ];

      candidates = requested.flatMap((deviceId) => {
        const device = assignedById.get(deviceId);

        return device ? [device] : [];
      });
    }

    const targets: RunScriptTarget[] = [];

    for (const device of candidates) {
      const result = yield* queueScriptRun(db, organizationId, script, device, userId, now);

      targets.push(result.target);
    }

    const queued = targets.filter((target) => !target.skippedReason).length;

    return { queued, skipped: targets.length - queued, targets };
  });

const executionInfo = (
  row: ExecutionRow,
  names: { readonly scriptName: string; readonly deviceName: string },
): ScriptExecutionInfo => ({
  id: row.id,
  scriptId: row.scriptId,
  scriptName: names.scriptName,
  deviceId: row.deviceId,
  deviceName: names.deviceName,
  trigger: Schema.decodeUnknownSync(ScriptTriggerType)(row.triggerType),
  status: Schema.decodeUnknownSync(ScriptExecutionStatus)(row.status),
  exitCode: row.exitCode,
  stdout: row.stdout ?? "",
  stderr: row.stderr ?? "",
  stdoutTruncated: row.stdoutTruncated,
  stderrTruncated: row.stderrTruncated,
  durationMs: row.durationMs,
  detail: row.resultDetail,
  startedAt: iso(row.startedAt),
  finishedAt: iso(row.finishedAt),
  createdAt: row.createdAt.toISOString(),
  expiresAt: iso(row.expiresAt),
});

export const listScriptExecutions = (
  db: EnterpriseDb,
  organizationId: string,
  scriptId: string,
  query: { readonly deviceId?: string; readonly limit?: number },
) =>
  Effect.gen(function* () {
    const limit = Math.min(
      Math.max(Math.trunc(query.limit ?? SCRIPT_EXECUTION_LIST_DEFAULT), 1),
      SCRIPT_EXECUTION_LIST_MAX,
    );

    const script = yield* scriptById(db, organizationId, scriptId);

    if (!script) return { executions: [], hasMore: false };

    const conditions = [
      eq(s.scriptExecution.organizationId, organizationId),
      eq(s.scriptExecution.scriptId, scriptId),
    ];

    if (query.deviceId) conditions.push(eq(s.scriptExecution.deviceId, query.deviceId));

    const rows = yield* db
      .select()
      .from(s.scriptExecution)
      .where(and(...conditions))
      .orderBy(desc(s.scriptExecution.createdAt))
      .limit(limit + 1);

    const deviceIds = [...new Set(rows.map((row) => row.deviceId))];

    const devices =
      deviceIds.length > 0
        ? yield* db
            .select({ id: s.device.id, name: s.device.name })
            .from(s.device)
            .where(
              and(eq(s.device.organizationId, organizationId), inArray(s.device.id, deviceIds)),
            )
        : [];

    const names = new Map(devices.map((device) => [device.id, device.name]));

    return {
      executions: rows.slice(0, limit).map((row) =>
        executionInfo(row, {
          scriptName: script.name,
          deviceName: names.get(row.deviceId) ?? "Unknown device",
        }),
      ),
      hasMore: rows.length > limit,
    };
  });

/**
 * Scripts and pending manual runs for one device. This is the poll endpoint the
 * agent uses for manual runs, and the only script channel on Windows (MDM has
 * no arbitrary-script CSP; Microsoft's own answer is an agent).
 */
export const scriptAgentSync = (
  db: EnterpriseDb,
  organizationId: string,
  deviceId: string,
  now: Date,
) =>
  Effect.gen(function* () {
    const organization = yield* db.query.organization.findFirst({
      where: { id: organizationId },
    });

    if (!organization?.scriptsEnabled) return { scripts: [] };

    const scripts = yield* db
      .select()
      .from(s.script)
      .where(and(eq(s.script.organizationId, organizationId), eq(s.script.enabled, true)))
      .orderBy(asc(s.script.name))
      .limit(SCRIPT_EXECUTION_LIST_MAX);

    if (scripts.length === 0) return { scripts: [] };

    const assignments = yield* db
      .select()
      .from(s.scriptAssignment)
      .where(eq(s.scriptAssignment.organizationId, organizationId));

    const memberships = yield* db
      .select({ groupId: s.groupDevice.groupId })
      .from(s.groupDevice)
      .where(eq(s.groupDevice.deviceId, deviceId));

    const assigned = resolveAssignedScriptIds(assignments, {
      deviceId,
      groupIds: new Set(memberships.map((row) => row.groupId)),
    });

    const candidates = scripts.filter((script) => assigned.has(script.id));

    if (candidates.length === 0) return { scripts: [] };

    yield* expireScriptExecutions(db, { now, deviceId });

    const pending = yield* db
      .select({
        id: s.scriptExecution.id,
        scriptId: s.scriptExecution.scriptId,
        expiresAt: s.scriptExecution.expiresAt,
      })
      .from(s.scriptExecution)
      .where(
        and(
          eq(s.scriptExecution.organizationId, organizationId),
          eq(s.scriptExecution.deviceId, deviceId),
          eq(s.scriptExecution.status, "queued"),
        ),
      )
      .orderBy(asc(s.scriptExecution.createdAt))
      .limit(SCRIPT_EXECUTION_LIST_MAX);

    const runByScript = new Map<string, { id: string; expiresAt: Date | null }>();

    for (const run of pending)
      if (!runByScript.has(run.scriptId)) runByScript.set(run.scriptId, run);

    const agentScripts: ScriptAgentScript[] = [];

    for (const script of candidates) {
      const run = runByScript.get(script.id);

      agentScripts.push({
        id: script.id,
        name: script.name,
        language: script.language,
        body: script.body,
        runAs: script.runAs,
        timeoutSeconds: script.timeoutSeconds,
        environment: [...environmentOf(script)],
        trigger: triggerOf(script),
        digest: yield* Effect.promise(() => scriptDigest(script)),
        runId: run?.id ?? null,
        runExpiresAt: iso(run?.expiresAt ?? null),
      });
    }

    return { scripts: agentScripts };
  });

export type ScriptResultIngestion = {
  readonly executionId: string;
  readonly duplicate: boolean;
  readonly status: "succeeded" | "failed";
  readonly scriptId: string;
};

const parseDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Store one agent result.
 *
 * Identity has already been proven (signed device token) and the device row is
 * tenant-scoped by the caller. Output is re-capped and redacted here even
 * though the agent redacts too: the API is reachable by a compromised device
 * and must not trust the size or content of what it posts.
 */
export const recordScriptAgentResult = (
  db: EnterpriseDb,
  device: { readonly id: string; readonly organizationId: string },
  input: ScriptAgentResultRequest,
  now: Date,
) =>
  Effect.gen(function* () {
    const script = yield* scriptById(db, device.organizationId, input.scriptId);

    if (!script) return { problem: "Script not found" };

    const organization = yield* db.query.organization.findFirst({
      where: { id: device.organizationId },
    });

    if (!organization?.scriptsEnabled) return { problem: "Scripts are disabled for this tenant" };

    if (!input.runId.trim() || input.runId.length > 200)
      return { problem: "runId is required and must be at most 200 characters" };

    const secrets = scriptSecretValues(environmentOf(script));
    const stdout = capScriptOutput(input.stdout ?? "", secrets);
    const stderr = capScriptOutput(input.stderr ?? "", secrets);

    const detail =
      input.detail === undefined || input.detail === null
        ? null
        : capScriptOutput(input.detail, secrets, 2_000).text;

    const durationMs =
      input.durationMs !== undefined && input.durationMs !== null
        ? Math.max(0, Math.min(Math.trunc(input.durationMs), 24 * 60 * 60 * 1000))
        : null;

    const failed = input.timedOut === true || (input.exitCode ?? 0) !== 0;
    const status = failed ? ("failed" as const) : ("succeeded" as const);
    const dedupeKey = yield* sha256Effect(`agent\u0000${input.runId}`);

    const existing = yield* db
      .select({ id: s.scriptExecution.id, status: s.scriptExecution.status })
      .from(s.scriptExecution)
      .where(
        and(
          eq(s.scriptExecution.organizationId, device.organizationId),
          eq(s.scriptExecution.scriptId, script.id),
          eq(s.scriptExecution.deviceId, device.id),
          eq(s.scriptExecution.dedupeKey, dedupeKey),
        ),
      )
      .limit(1);

    if (existing.length > 0)
      return {
        executionId: existing[0]!.id,
        duplicate: true,
        status:
          existing[0]!.status === "succeeded" || existing[0]!.status === "failed"
            ? existing[0]!.status
            : status,
        scriptId: script.id,
      };

    // A manual run carries the server execution id as its run id. Claim the
    // row, write the result and the device timeline entry in one transaction,
    // so a crash cannot leave a run `running` with no result.
    const executionId = yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const claimed = yield* tx
          .update(s.scriptExecution)
          .set({ status: "running", dedupeKey, updatedAt: now })
          .where(
            and(
              eq(s.scriptExecution.id, input.runId),
              eq(s.scriptExecution.organizationId, device.organizationId),
              eq(s.scriptExecution.scriptId, script.id),
              eq(s.scriptExecution.deviceId, device.id),
              inArray(s.scriptExecution.status, ["queued", "sent", "running"]),
            ),
          );

        const claimedRow = claimed.affectedRows === 1;

        const executionId = claimedRow
          ? input.runId
          : crypto.randomUUID().replaceAll("-", "").slice(0, 24);

        const values = {
          status,
          exitCode: input.exitCode ?? null,
          stdout: stdout.text,
          stderr: stderr.text,
          stdoutTruncated: stdout.truncated,
          stderrTruncated: stderr.truncated,
          durationMs,
          resultDetail: input.timedOut
            ? "The script exceeded its timeout and was stopped."
            : detail,
          startedAt: parseDate(input.startedAt),
          finishedAt: parseDate(input.finishedAt) ?? now,
          dedupeKey,
          updatedAt: now,
        } as const;

        if (claimedRow)
          yield* tx
            .update(s.scriptExecution)
            .set(values)
            .where(
              and(
                eq(s.scriptExecution.id, input.runId),
                eq(s.scriptExecution.organizationId, device.organizationId),
              ),
            );
        else
          yield* tx
            .insert(s.scriptExecution)
            .values({
              id: executionId,
              organizationId: device.organizationId,
              scriptId: script.id,
              deviceId: device.id,
              triggerType: input.trigger,
              requestedByAccountId: null,
              expiresAt: null,
              createdAt: now,
              ...values,
            })
            .onDuplicateKeyUpdate({ set: { updatedAt: now } });

        // One timeline entry per terminal run. Metadata is secret-free: no
        // output, no environment, no run identity.
        yield* tx.insert(s.auditLog).values({
          id: `sys_${crypto.randomUUID().replaceAll("-", "").slice(0, 21)}`,
          organizationId: device.organizationId,
          actorAccountId: null,
          actorEmail: "system",
          action: failed ? "script.run_failed" : "script.run_completed",
          targetType: "device",
          targetId: device.id,
          metadata: {
            scriptId: script.id,
            scriptName: script.name,
            trigger: input.trigger,
            status,
            exitCode: input.exitCode ?? null,
            durationMs,
            timedOut: input.timedOut === true,
          },
          createdAt: now,
        });

        return executionId;
      }),
    );

    return { executionId, duplicate: false, status, scriptId: script.id };
  });

export const getScriptSettings = (organization: {
  readonly scriptsEnabled: boolean;
}): ScriptSettings => ({ enabled: organization.scriptsEnabled });

/** Terminal execution retention used by maintenance. */
export const scriptExecutionRetentionCutoff = (
  now: Date,
  retentionDays = SCRIPT_EXECUTION_RETENTION_DAYS,
): Date | null => (retentionDays > 0 ? new Date(now.getTime() - retentionDays * day) : null);

export type ScriptSweepResult = {
  readonly expired: number;
  readonly pruned: number;
};

/** Expire stale queued runs, then prune terminal history past retention. */
export const sweepScriptExecutions = (
  db: EnterpriseDb,
  options: { readonly now: Date; readonly retentionDays?: number },
) =>
  Effect.gen(function* () {
    const expired = yield* expireScriptExecutions(db, { now: options.now });
    const cutoff = scriptExecutionRetentionCutoff(options.now, options.retentionDays);

    if (!cutoff) return { expired, pruned: 0 };

    const prunable = yield* db
      .select({ id: s.scriptExecution.id })
      .from(s.scriptExecution)
      .where(
        and(
          lt(s.scriptExecution.updatedAt, cutoff),
          inArray(s.scriptExecution.status, [...SCRIPT_TERMINAL_STATUSES]),
        ),
      )
      .limit(SCRIPT_EXECUTION_SWEEP_LIMIT);

    if (prunable.length === 0) return { expired, pruned: 0 };

    yield* db.delete(s.scriptExecution).where(
      inArray(
        s.scriptExecution.id,
        prunable.map((row) => row.id),
      ),
    );

    return { expired, pruned: prunable.length };
  });

/** Whether a queued row is still deliverable. */
export const scriptExecutionIsDeliverable = (
  row: { readonly status: string; readonly expiresAt: Date | null },
  now: Date,
) => row.status === "queued" && !scriptExecutionIsExpired(row, now);
