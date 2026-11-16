import { Schema } from "effect";

/**
 * Script management.
 *
 * A script is arbitrary code, so every limit in this module is deliberate and
 * enforced on both sides of the API: the dashboard validates a draft before it
 * is submitted, and the backend re-validates because the API is public. The
 * helpers are pure so delivery, queueing and ingestion share one definition of
 * a valid script, an expired run and a redacted result.
 */

export const SCRIPT_LANGUAGES = ["bash", "zsh", "sh", "pwsh"] as const;
export const ScriptLanguage = Schema.Literals(SCRIPT_LANGUAGES);

export type ScriptLanguage = typeof ScriptLanguage.Type;

export const SCRIPT_RUN_AS = ["root", "user"] as const;
export const ScriptRunAs = Schema.Literals(SCRIPT_RUN_AS);

export type ScriptRunAs = typeof ScriptRunAs.Type;

export const SCRIPT_TRIGGER_TYPES = [
  "manual",
  "cron",
  "interval",
  "login",
  "logout",
  "network-change",
  "install",
] as const;

export const ScriptTriggerType = Schema.Literals(SCRIPT_TRIGGER_TYPES);

export type ScriptTriggerType = typeof ScriptTriggerType.Type;

export const SCRIPT_STATUSES = [
  "queued",
  "sent",
  "running",
  "succeeded",
  "failed",
  "expired",
  "cancelled",
] as const;

export const ScriptExecutionStatus = Schema.Literals(SCRIPT_STATUSES);

export type ScriptExecutionStatus = typeof ScriptExecutionStatus.Type;

/** Terminal statuses; active work is never pruned by retention. */
export const SCRIPT_TERMINAL_STATUSES: ReadonlySet<ScriptExecutionStatus> = new Set([
  "succeeded",
  "failed",
  "expired",
  "cancelled",
]);

export const SCRIPT_ACTIVE_STATUSES: ReadonlyArray<ScriptExecutionStatus> = [
  "queued",
  "sent",
  "running",
];

/** 32 KiB is a generous script and small enough for a single SQL statement. */
export const SCRIPT_BODY_MAX_BYTES = 32 * 1024;
export const SCRIPT_NAME_MAX_LENGTH = 120;
export const SCRIPT_DESCRIPTION_MAX_LENGTH = 2_000;
export const SCRIPT_ENVIRONMENT_MAX_ENTRIES = 32;
export const SCRIPT_ENVIRONMENT_VALUE_MAX_BYTES = 4 * 1024;
export const SCRIPT_TIMEOUT_DEFAULT_SECONDS = 300;
export const SCRIPT_TIMEOUT_MAX_SECONDS = 86_400;
export const SCRIPT_TIMEOUT_MIN_SECONDS = 1;
export const SCRIPT_INTERVAL_MIN_SECONDS = 60;
export const SCRIPT_INTERVAL_MAX_SECONDS = 30 * 24 * 60 * 60;

/** Captured output kept per stream. The rest is dropped with a marker. */
export const SCRIPT_OUTPUT_MAX_BYTES = 64 * 1024;
export const SCRIPT_OUTPUT_TRUNCATED_MARKER = "\n[mattrax: output truncated]";

/** A manual run that no device has collected by this point is expired. */
export const SCRIPT_RUN_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Terminal execution history is pruned after this many days. */
export const SCRIPT_EXECUTION_RETENTION_DAYS = 30;

/** Bounded list pages. */
export const SCRIPT_LIST_MAX = 200;
export const SCRIPT_EXECUTION_LIST_DEFAULT = 50;
export const SCRIPT_EXECUTION_LIST_MAX = 200;

/** Request types used by the management layer for script delivery. */
export const SCRIPT_PROFILE_REQUEST_TYPE = "InstallProfile";

export const ScriptEnvironmentEntry = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  /** Redacted from captured stdout/stderr before it is stored. */
  secret: Schema.Boolean,
});

export type ScriptEnvironmentEntry = typeof ScriptEnvironmentEntry.Type;

export const ScriptTrigger = Schema.Struct({
  type: ScriptTriggerType,
  /** Required for `interval`; validated by `scriptProblem`. */
  intervalSeconds: Schema.optional(Schema.NullOr(Schema.Number)),
  /** Required for `cron`; validated by `scriptProblem`. */
  cronExpression: Schema.optional(Schema.NullOr(Schema.String)),
});

export type ScriptTrigger = typeof ScriptTrigger.Type;

const triggerTypeOf = (value: string): ScriptTriggerType | undefined =>
  SCRIPT_TRIGGER_TYPES.find((type) => type === value);

const utf8Length = (value: string): number => new TextEncoder().encode(value).length;

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CRON_FIELD = /^[\d*/,-]+$/;

/**
 * Validate one cron field. The agent evaluates five-field POSIX cron, so a
 * field with names (`MON`), seconds or an unsupported character is rejected
 * instead of silently never running.
 */
const cronFieldProblem = (field: string, min: number, max: number, label: string) => {
  if (!field || !CRON_FIELD.test(field)) return `${label} must contain only digits and * / , -`;

  for (const part of field.split(",")) {
    const [range, step] = part.split("/");

    if (step !== undefined) {
      const value = Number(step);

      if (!Number.isInteger(value) || value <= 0) return `${label} has an invalid step`;
    }

    if (range === "*") continue;

    const bounds = range!.split("-").map(Number);

    if (bounds.some((value) => !Number.isInteger(value))) return `${label} has an invalid value`;

    for (const value of bounds)
      if (value < min || value > max) return `${label} must be between ${min} and ${max}`;
  }

  return undefined;
};

/** Human-readable problem with a five-field cron expression, if any. */
export const cronExpressionProblem = (expression: string): string | undefined => {
  const fields = expression.trim().split(/\s+/);

  if (fields.length !== 5)
    return "Cron expressions must have five fields (minute hour day month weekday)";

  return (
    cronFieldProblem(fields[0] ?? "", 0, 59, "Minute") ??
    cronFieldProblem(fields[1] ?? "", 0, 23, "Hour") ??
    cronFieldProblem(fields[2] ?? "", 1, 31, "Day") ??
    cronFieldProblem(fields[3] ?? "", 1, 12, "Month") ??
    cronFieldProblem(fields[4] ?? "", 0, 6, "Weekday")
  );
};

/** The script fields validation needs; every mutation builds one of these. */
export type ScriptDraft = {
  readonly name: string;
  readonly description?: string | null;
  readonly language: string;
  readonly body: string;
  readonly runAs: string;
  readonly timeoutSeconds: number;
  readonly environment?: ReadonlyArray<ScriptEnvironmentEntry> | null;
  readonly trigger: ScriptTrigger;
};

/**
 * Why a script draft cannot be saved, in operator-facing wording. A null
 * result means it is valid. Validation happens after trimming so a name of
 * spaces is rejected rather than stored as an empty label.
 */
export const scriptProblem = (draft: ScriptDraft): string | null => {
  const name = draft.name.trim();

  if (!name) return "Name is required";

  if (name.length > SCRIPT_NAME_MAX_LENGTH)
    return `Name must be at most ${SCRIPT_NAME_MAX_LENGTH} characters`;

  if ((draft.description ?? "").length > SCRIPT_DESCRIPTION_MAX_LENGTH)
    return `Description must be at most ${SCRIPT_DESCRIPTION_MAX_LENGTH} characters`;

  if (!SCRIPT_LANGUAGES.find((language) => language === draft.language))
    return "Shell must be bash, zsh, sh or pwsh";

  if (!SCRIPT_RUN_AS.find((runAs) => runAs === draft.runAs)) return "Run-as must be root or user";

  if (!draft.body.trim()) return "Script body is required";

  if (utf8Length(draft.body) > SCRIPT_BODY_MAX_BYTES)
    return `Script body must be at most ${SCRIPT_BODY_MAX_BYTES / 1024} KiB`;

  if (
    !Number.isInteger(draft.timeoutSeconds) ||
    draft.timeoutSeconds < SCRIPT_TIMEOUT_MIN_SECONDS ||
    draft.timeoutSeconds > SCRIPT_TIMEOUT_MAX_SECONDS
  )
    return `Timeout must be between ${SCRIPT_TIMEOUT_MIN_SECONDS} and ${SCRIPT_TIMEOUT_MAX_SECONDS} seconds`;

  const environment = draft.environment ?? [];

  if (environment.length > SCRIPT_ENVIRONMENT_MAX_ENTRIES)
    return `At most ${SCRIPT_ENVIRONMENT_MAX_ENTRIES} environment variables are allowed`;

  const seen = new Set<string>();

  for (const entry of environment) {
    if (!ENVIRONMENT_NAME.test(entry.name))
      return `Environment variable ${JSON.stringify(entry.name)} is not a valid name`;

    if (seen.has(entry.name)) return `Environment variable ${entry.name} is defined twice`;

    seen.add(entry.name);

    if (utf8Length(entry.value) > SCRIPT_ENVIRONMENT_VALUE_MAX_BYTES)
      return `Environment variable ${entry.name} is too long`;
  }

  const triggerType = triggerTypeOf(draft.trigger.type);

  if (!triggerType) return "Unknown trigger";

  if (triggerType === "interval") {
    const seconds = draft.trigger.intervalSeconds ?? null;

    if (
      seconds === null ||
      !Number.isInteger(seconds) ||
      seconds < SCRIPT_INTERVAL_MIN_SECONDS ||
      seconds > SCRIPT_INTERVAL_MAX_SECONDS
    )
      return `Interval must be between ${SCRIPT_INTERVAL_MIN_SECONDS} and ${SCRIPT_INTERVAL_MAX_SECONDS} seconds`;
  }

  if (triggerType === "cron") {
    const expression = draft.trigger.cronExpression?.trim() ?? "";

    if (!expression) return "A cron expression is required";

    const problem = cronExpressionProblem(expression);

    if (problem) return problem;
  }

  return null;
};

/** Trigger-specific columns normalised from the request. */
export const normalizeScriptTrigger = (trigger: ScriptTrigger) => ({
  type: trigger.type,
  intervalSeconds: trigger.type === "interval" ? Math.trunc(trigger.intervalSeconds ?? 0) : null,
  cronExpression: trigger.type === "cron" ? (trigger.cronExpression?.trim() ?? null) : null,
});

export const scriptTriggerLabel = (trigger: ScriptTriggerType): string => {
  switch (trigger) {
    case "manual":
      return "Manual";
    case "cron":
      return "Schedule";
    case "interval":
      return "Interval";
    case "login":
      return "User login";
    case "logout":
      return "User logout";
    case "network-change":
      return "Network change";
    case "install":
      return "On install";
  }
};

/**
 * Environment entries the agent injects. Secret values are sent to the device
 * (the script needs them) but are removed from anything stored server-side.
 */
export const scriptEnvironment = (
  entries: ReadonlyArray<ScriptEnvironmentEntry> | null | undefined,
): ReadonlyArray<{ readonly name: string; readonly value: string }> =>
  (entries ?? []).map(({ name, value }) => ({ name, value }));

export const scriptSecretValues = (
  entries: ReadonlyArray<ScriptEnvironmentEntry> | null | undefined,
): ReadonlyArray<string> =>
  (entries ?? [])
    .filter((entry) => entry.secret && entry.value.length > 0)
    .map((entry) => entry.value);

const REDACTION_PATTERNS: ReadonlyArray<RegExp> = [
  // Authorization headers echoed by a verbose tool.
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi,
  // `password=...`, `token: ...`, `api_key="..."` in command output.
  /\b(password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\b(\s*[=:]\s*)("?)[^\s"']+\3/gi,
  // PEM private keys and common cloud credential prefixes.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
];

/**
 * Remove credentials from captured output before it leaves the device or is
 * stored. `secrets` are exact environment values marked secret by the
 * operator; the patterns catch credentials a script echoed from elsewhere.
 *
 * This is intentionally conservative: it can redact a harmless word such as
 * `token=` in prose, and it cannot recognise an arbitrary secret that neither
 * came from the environment nor matched a known shape.
 */
export const redactScriptText = (text: string, secrets: ReadonlyArray<string> = []): string => {
  let redacted = text;

  for (const secret of secrets) {
    if (!secret) continue;
    redacted = redacted.split(secret).join("[redacted]");
  }

  for (const pattern of REDACTION_PATTERNS) redacted = redacted.replace(pattern, "[redacted]");

  return redacted;
};

/** Byte-capped, redacted output with a marker when anything was dropped. */
export const capScriptOutput = (
  value: string | null | undefined,
  secrets: ReadonlyArray<string> = [],
  maxBytes = SCRIPT_OUTPUT_MAX_BYTES,
) => {
  if (!value) return { text: "", truncated: false };

  const redacted = redactScriptText(value, secrets);
  const bytes = new TextEncoder().encode(redacted);

  if (bytes.length <= maxBytes) return { text: redacted, truncated: false };

  // Cut on a UTF-8 boundary by decoding the truncated bytes with a streaming
  // decoder that replaces a partial sequence instead of throwing.
  const text = new TextDecoder().decode(bytes.slice(0, maxBytes));

  return { text: `${text}${SCRIPT_OUTPUT_TRUNCATED_MARKER}`, truncated: true };
};

// ─── Assignment resolution ────────────────────────────────────────

export type ScriptAssignmentRow = {
  readonly scriptId: string;
  readonly targetType: "device" | "group";
  readonly targetId: string;
};

/**
 * Script ids assigned to one device. A device assignment always matches; a
 * group assignment matches when the device belongs to that group. Resolution
 * is a set union, so duplicate paths (direct + group) run the script once.
 */
export const resolveAssignedScriptIds = (
  assignments: ReadonlyArray<ScriptAssignmentRow>,
  input: { readonly deviceId: string; readonly groupIds: ReadonlySet<string> },
): ReadonlySet<string> => {
  const scriptIds = new Set<string>();

  for (const assignment of assignments) {
    if (assignment.targetType === "device" && assignment.targetId === input.deviceId)
      scriptIds.add(assignment.scriptId);
    else if (assignment.targetType === "group" && input.groupIds.has(assignment.targetId))
      scriptIds.add(assignment.scriptId);
  }

  return scriptIds;
};

// ─── Queue lifecycle ──────────────────────────────────────────────

export type ScriptExecutionLifecycleRow = {
  readonly id: string;
  readonly scriptId: string;
  readonly deviceId: string;
  readonly status: string;
  readonly dedupeKey?: string | null;
  readonly createdAt: Date;
  readonly expiresAt?: Date | null;
};

export const scriptStatusIsActive = (status: string | null | undefined): boolean =>
  status === "queued" || status === "sent" || status === "running";

export const scriptExecutionIsExpired = (
  row: Pick<ScriptExecutionLifecycleRow, "status" | "expiresAt">,
  now: Date,
): boolean =>
  scriptStatusIsActive(row.status) &&
  row.expiresAt != null &&
  row.expiresAt.getTime() <= now.getTime();

export type ScriptRunQueuePlan = {
  /** An unexpired run already queued for this device and script. */
  readonly duplicate: ScriptExecutionLifecycleRow | null;
  /** Queued runs past their deadline that must become `expired`. */
  readonly expireIds: ReadonlyArray<string>;
};

/**
 * Decide what a manual run request does against a device's recent run history.
 * A queued run that is still inside its window is returned instead of creating
 * a second one, so double-clicking Run (or two administrators clicking at
 * once) produces one execution. Expired queued runs are reported for closure.
 */
export const planScriptRunQueue = (
  rows: ReadonlyArray<ScriptExecutionLifecycleRow>,
  input: { readonly scriptId: string; readonly deviceId: string; readonly now: Date },
): ScriptRunQueuePlan => {
  const relevant = rows.filter(
    (row) => row.scriptId === input.scriptId && row.deviceId === input.deviceId,
  );

  const expireIds = relevant.flatMap((row) =>
    scriptExecutionIsExpired(row, input.now) ? [row.id] : [],
  );

  const duplicate =
    relevant.find(
      (row) =>
        row.status === "queued" &&
        !scriptExecutionIsExpired(row, input.now) &&
        (row.expiresAt == null || row.expiresAt.getTime() > input.now.getTime()),
    ) ?? null;

  return { duplicate, expireIds };
};

/** Stable key for one manual run per device and script (active rows only). */
export const manualRunDedupeSource = (scriptId: string): string => `manual\u0000${scriptId}`;

// ─── Agent identity ───────────────────────────────────────────────

/** Prefix makes a leaked token recognisable in a secret scanner. */
export const SCRIPT_AGENT_TOKEN_PREFIX = "mttx_sa1_";

const encoder = new TextEncoder();

const base64Url = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const fromBase64Url = (value: string): Uint8Array => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const hmacKey = async (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);

const constantTimeEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false;

  let difference = 0;

  for (let index = 0; index < left.length; index++) difference |= left[index]! ^ right[index]!;

  return difference === 0;
};

/**
 * Bearer token the on-device agent uses for its script channel.
 *
 * The token embeds the device id and an HMAC over it, so the server needs no
 * token table and a device cannot post results for another device: the
 * signature binds the token to the id, and ingestion still checks that the
 * device is enrolled and tenant-scoped. Rotating `AUTH_SECRET` invalidates
 * every token, which is the intended recovery path after a leak.
 */
export const scriptAgentToken = async (deviceId: string, secret: string): Promise<string> => {
  const key = await hmacKey(secret);

  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`script-agent\u0000${deviceId}`)),
  );

  return `${SCRIPT_AGENT_TOKEN_PREFIX}${base64Url(encoder.encode(deviceId))}.${base64Url(signature)}`;
};

/** Device id a bearer token proves, or null when it is malformed or forged. */
export const verifyScriptAgentToken = async (
  token: string,
  secret: string,
): Promise<string | null> => {
  if (!token.startsWith(SCRIPT_AGENT_TOKEN_PREFIX)) return null;

  const [encodedId, encodedSignature] = token.slice(SCRIPT_AGENT_TOKEN_PREFIX.length).split(".");

  if (!encodedId || !encodedSignature) return null;

  let deviceId: string;
  let signature: Uint8Array;

  try {
    deviceId = new TextDecoder().decode(fromBase64Url(encodedId));
    signature = fromBase64Url(encodedSignature);
  } catch {
    return null;
  }

  if (!deviceId) return null;

  const key = await hmacKey(secret);

  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`script-agent\u0000${deviceId}`)),
  );

  return constantTimeEqual(expected, signature) ? deviceId : null;
};

// ─── Contracts ────────────────────────────────────────────────────

export const ScriptInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  language: ScriptLanguage,
  runAs: ScriptRunAs,
  timeoutSeconds: Schema.Number,
  environment: Schema.Array(ScriptEnvironmentEntry),
  trigger: ScriptTrigger,
  enabled: Schema.Boolean,
  /** Direct device assignments. */
  deviceCount: Schema.Number,
  /** Group assignments; membership is resolved per device at delivery time. */
  groupCount: Schema.Number,
  /** Number of enrolled devices the script currently resolves to. */
  assignedDeviceCount: Schema.Number,
  lastRunAt: Schema.optional(Schema.NullOr(Schema.String)),
  lastRunStatus: Schema.optional(Schema.NullOr(ScriptExecutionStatus)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type ScriptInfo = typeof ScriptInfo.Type;

export const ScriptListResponse = Schema.Struct({
  scripts: Schema.Array(ScriptInfo),
  /** Tenant opt-out state; false means the whole feature is switched off. */
  enabled: Schema.Boolean,
  canRun: Schema.Boolean,
});

export type ScriptListResponse = typeof ScriptListResponse.Type;

export const ScriptDetail = Schema.Struct({
  script: ScriptInfo,
  body: Schema.String,
});

export type ScriptDetail = typeof ScriptDetail.Type;

export const ScriptSettings = Schema.Struct({
  enabled: Schema.Boolean,
});

export type ScriptSettings = typeof ScriptSettings.Type;

export const CreateScriptRequest = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  language: ScriptLanguage,
  body: Schema.String,
  runAs: ScriptRunAs,
  timeoutSeconds: Schema.Number,
  environment: Schema.optional(Schema.NullOr(Schema.Array(ScriptEnvironmentEntry))),
  trigger: ScriptTrigger,
  enabled: Schema.optional(Schema.Boolean),
});

export type CreateScriptRequest = typeof CreateScriptRequest.Type;

export const PatchScriptRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  language: Schema.optional(ScriptLanguage),
  body: Schema.optional(Schema.String),
  runAs: Schema.optional(ScriptRunAs),
  timeoutSeconds: Schema.optional(Schema.Number),
  environment: Schema.optional(Schema.NullOr(Schema.Array(ScriptEnvironmentEntry))),
  trigger: Schema.optional(ScriptTrigger),
  enabled: Schema.optional(Schema.Boolean),
});

export type PatchScriptRequest = typeof PatchScriptRequest.Type;

export const PatchScriptAssignmentsRequest = Schema.Struct({
  assign: Schema.optional(
    Schema.Struct({
      groups: Schema.optional(Schema.Array(Schema.String)),
      devices: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  unassign: Schema.optional(
    Schema.Struct({
      groups: Schema.optional(Schema.Array(Schema.String)),
      devices: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});

export type PatchScriptAssignmentsRequest = typeof PatchScriptAssignmentsRequest.Type;

export const ScriptAssignmentsResponse = Schema.Struct({
  groups: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  devices: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
});

export type ScriptAssignmentsResponse = typeof ScriptAssignmentsResponse.Type;

export const RunScriptRequest = Schema.Struct({
  /** Omit both to run on every currently assigned device. */
  devices: Schema.optional(Schema.Array(Schema.String)),
  groups: Schema.optional(Schema.Array(Schema.String)),
});

export type RunScriptRequest = typeof RunScriptRequest.Type;

export const RunScriptTarget = Schema.Struct({
  executionId: Schema.String,
  deviceId: Schema.String,
  deviceName: Schema.String,
  /** Set when the device cannot run the script (platform, status). */
  skippedReason: Schema.optional(Schema.NullOr(Schema.String)),
});

export type RunScriptTarget = typeof RunScriptTarget.Type;

export const RunScriptResponse = Schema.Struct({
  queued: Schema.Number,
  skipped: Schema.Number,
  targets: Schema.Array(RunScriptTarget),
});

export type RunScriptResponse = typeof RunScriptResponse.Type;

export const ScriptExecutionInfo = Schema.Struct({
  id: Schema.String,
  scriptId: Schema.String,
  scriptName: Schema.String,
  deviceId: Schema.String,
  deviceName: Schema.String,
  trigger: ScriptTriggerType,
  status: ScriptExecutionStatus,
  exitCode: Schema.optional(Schema.NullOr(Schema.Number)),
  stdout: Schema.String,
  stderr: Schema.String,
  stdoutTruncated: Schema.Boolean,
  stderrTruncated: Schema.Boolean,
  durationMs: Schema.optional(Schema.NullOr(Schema.Number)),
  detail: Schema.optional(Schema.NullOr(Schema.String)),
  startedAt: Schema.optional(Schema.NullOr(Schema.String)),
  finishedAt: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  expiresAt: Schema.optional(Schema.NullOr(Schema.String)),
});

export type ScriptExecutionInfo = typeof ScriptExecutionInfo.Type;

export const ScriptExecutionsResponse = Schema.Struct({
  executions: Schema.Array(ScriptExecutionInfo),
  hasMore: Schema.Boolean,
});

export type ScriptExecutionsResponse = typeof ScriptExecutionsResponse.Type;

/** Result posted by the on-device agent. Output is capped again server-side. */
export const ScriptAgentResultRequest = Schema.Struct({
  /** Agent-side run identity; retries reuse it and collapse to one row. */
  runId: Schema.String,
  scriptId: Schema.String,
  trigger: ScriptTriggerType,
  exitCode: Schema.optional(Schema.NullOr(Schema.Number)),
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
  durationMs: Schema.optional(Schema.NullOr(Schema.Number)),
  startedAt: Schema.optional(Schema.NullOr(Schema.String)),
  finishedAt: Schema.optional(Schema.NullOr(Schema.String)),
  detail: Schema.optional(Schema.NullOr(Schema.String)),
  /** True when the agent killed the script at the timeout. */
  timedOut: Schema.optional(Schema.Boolean),
});

export type ScriptAgentResultRequest = typeof ScriptAgentResultRequest.Type;

export const ScriptAgentResultResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  executionId: Schema.String,
  duplicate: Schema.Boolean,
});

export type ScriptAgentResultResponse = typeof ScriptAgentResultResponse.Type;

/** One script definition returned to the agent by the poll endpoint. */
export const ScriptAgentScript = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  language: ScriptLanguage,
  body: Schema.String,
  runAs: ScriptRunAs,
  timeoutSeconds: Schema.Number,
  environment: Schema.Array(ScriptEnvironmentEntry),
  trigger: ScriptTrigger,
  /** Content digest; changes mean the agent needs to run install triggers. */
  digest: Schema.String,
  /** Set when a manual run is queued; consumed by the agent exactly once. */
  runId: Schema.optional(Schema.NullOr(Schema.String)),
  runExpiresAt: Schema.optional(Schema.NullOr(Schema.String)),
});

export type ScriptAgentScript = typeof ScriptAgentScript.Type;

export const ScriptAgentSyncResponse = Schema.Struct({
  scripts: Schema.Array(ScriptAgentScript),
});

export type ScriptAgentSyncResponse = typeof ScriptAgentSyncResponse.Type;
