import { Effect, Option, Schema } from "effect";
import { parsePlist, serializePlist } from "@mattrax/plist";
import type { PlistValue } from "@mattrax/plist";

/**
 * Apple delivery for Mattrax scripts.
 *
 * A script is installed as a configuration profile whose payload type is
 * `com.mattrax.script`. The on-device agent reads installed profiles and runs
 * the payload when its trigger fires. This mirrors the legacy `mattraxd`
 * payload so an existing agent keeps working, while adding the fields the
 * hosted queue needs (timeout, environment, run id and the result endpoint).
 */

export const MATTRAX_SCRIPT_PAYLOAD_TYPE = "com.mattrax.script";

export const SCRIPT_PAYLOAD_TRIGGER_TYPES = [
  "manual",
  "cron",
  "interval",
  "login",
  "logout",
  "network-change",
  "install",
] as const;

export const ScriptTriggerType = Schema.Literals(SCRIPT_PAYLOAD_TRIGGER_TYPES);

export type ScriptPayloadTrigger = typeof ScriptTriggerType.Type;

export type ScriptPayloadInput = {
  readonly scriptId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly language: "bash" | "zsh" | "sh" | "pwsh";
  readonly body: string;
  readonly runAs: "root" | "user";
  readonly timeoutSeconds: number;
  readonly environment: ReadonlyArray<{
    readonly name: string;
    readonly value: string;
    /** Redact this value from captured output. */
    readonly secret?: boolean;
  }>;
  readonly trigger: {
    readonly type: ScriptPayloadTrigger;
    readonly intervalSeconds?: number | null;
    readonly cronExpression?: string | null;
  };
  /** Set for one queued manual run; the agent executes it exactly once. */
  readonly runId?: string | null;
  /** Where the agent posts results, and the signed identity it presents. */
  readonly serverUrl: string;
  readonly deviceToken: string;
};

const encoder = new TextEncoder();

const stableUuid = async (value: string): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))).slice(
    0,
    16,
  );

  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** Profile identifier for a script; stable across edits so a reinstall replaces it. */
export const scriptProfileIdentifier = (scriptId: string) => `com.mattrax.script.${scriptId}`;

/**
 * The outer `.mobileconfig` identifier the device reports. Delivery keys the
 * installed map by this value, while the payload keeps the shorter identifier.
 */
export const scriptProfileDocumentIdentifier = (scriptId: string) =>
  `${scriptProfileIdentifier(scriptId)}.profile`;

/** Legacy trigger names the agent understands. */
type ScriptTriggerPayload =
  | { readonly Type: "timer"; readonly TimerInterval: number }
  | { readonly Type: "timer"; readonly CronExpression: string }
  | { readonly Type: "networkstatechange" }
  | { readonly Type: "login" }
  | { readonly Type: "logout" }
  | { readonly Type: "install" }
  | { readonly Type: "manual" };

const legacyTrigger = (trigger: ScriptPayloadInput["trigger"]): ScriptTriggerPayload => {
  switch (trigger.type) {
    case "network-change":
      return { Type: "networkstatechange" };
    case "interval":
      return {
        Type: "timer",
        TimerInterval: Math.max(1, Math.trunc(trigger.intervalSeconds ?? 60)),
      };
    case "cron":
      return { Type: "timer", CronExpression: trigger.cronExpression ?? "" };
    case "manual":
      return { Type: "manual" };
    case "login":
      return { Type: "login" };
    case "logout":
      return { Type: "logout" };
    case "install":
      return { Type: "install" };
  }
};

/** One `com.mattrax.script` payload dictionary. */
export const scriptPayload = async (
  input: ScriptPayloadInput,
): Promise<Record<string, PlistValue>> => {
  const environment: Record<string, PlistValue> = {};
  const secrets: PlistValue[] = [];

  for (const entry of input.environment) {
    environment[entry.name] = entry.value;

    if (entry.secret) secrets.push(entry.name);
  }

  return {
    PayloadType: MATTRAX_SCRIPT_PAYLOAD_TYPE,
    PayloadIdentifier: scriptProfileIdentifier(input.scriptId),
    PayloadUUID: await stableUuid(`mattrax:script:${input.scriptId}:${input.runId ?? "idle"}`),
    PayloadDisplayName: input.name,
    PayloadDescription: input.description ?? `Mattrax script ${input.name}`,
    PayloadVersion: 1,
    ScriptID: input.scriptId,
    Permission: input.runAs,
    Shell: input.language,
    Content: input.body,
    Timeout: input.timeoutSeconds,
    Triggers: [legacyTrigger(input.trigger)],
    Environment: environment,
    // Names, not values: the agent redacts these from captured output. Older
    // profiles omit it and the agent falls back to its name heuristic.
    SecretEnvironment: secrets,
    RunID: input.runId ?? "",
    ServerURL: input.serverUrl,
    DeviceToken: input.deviceToken,
  };
};

/**
 * Encode a `.mobileconfig` for one script. The outer profile identifier is
 * derived from the payload identifier so it is unique per script and stable
 * across reinstalls.
 */
export const buildScriptProfile = async (input: ScriptPayloadInput): Promise<Uint8Array> => {
  const documentIdentifier = scriptProfileDocumentIdentifier(input.scriptId);

  const profile: PlistValue = {
    PayloadContent: [await scriptPayload(input)],
    PayloadDisplayName: `Mattrax script: ${input.name}`.slice(0, 120),
    PayloadIdentifier: documentIdentifier,
    PayloadOrganization: "Mattrax",
    PayloadType: "Configuration",
    PayloadUUID: await stableUuid(`mattrax:script-profile:${input.scriptId}`),
    PayloadVersion: 1,
  };

  const plist = await Effect.runPromise(serializePlist(profile));

  return encoder.encode(plist);
};

const ScriptPayload = Schema.Struct({
  PayloadType: Schema.optional(Schema.String),
  PayloadDisplayName: Schema.optional(Schema.String),
  ScriptID: Schema.optional(Schema.String),
  Content: Schema.optional(Schema.String),
  Shell: Schema.optional(Schema.String),
  Permission: Schema.optional(Schema.String),
  Timeout: Schema.optional(Schema.Number),
  RunID: Schema.optional(Schema.String),
});

const ScriptProfile = Schema.Struct({
  PayloadContent: Schema.optional(Schema.Array(ScriptPayload)),
});

export type InstalledScriptProfile = {
  readonly scriptId: string;
  readonly name: string;
  readonly language: string;
  readonly body: string;
  readonly runAs: string;
  readonly timeoutSeconds: number;
  readonly runId: string | null;
};

/**
 * Read the `com.mattrax.script` payloads out of an installed `.mobileconfig`.
 * Used by the agent and by tests; the server also uses it to detect a profile
 * whose content changed.
 */
export const parseScriptProfile = async (
  bytes: Uint8Array,
): Promise<ReadonlyArray<InstalledScriptProfile>> => {
  const parsed = await Effect.runPromise(
    Effect.match(parsePlist(new TextDecoder().decode(bytes)), {
      onFailure: () => null,
      onSuccess: (value) => value,
    }),
  );

  const profile = Option.getOrNull(Schema.decodeUnknownOption(ScriptProfile)(parsed));

  if (!profile?.PayloadContent) return [];

  return profile.PayloadContent.flatMap((payload) => {
    if (payload.PayloadType !== MATTRAX_SCRIPT_PAYLOAD_TYPE) return [];

    if (!payload.ScriptID || payload.Content === undefined) return [];

    return [
      {
        scriptId: payload.ScriptID,
        name: payload.PayloadDisplayName ?? payload.ScriptID,
        language: payload.Shell ?? "sh",
        body: payload.Content,
        runAs: payload.Permission ?? "user",
        timeoutSeconds: payload.Timeout ?? 300,
        runId: payload.RunID ? payload.RunID : null,
      },
    ];
  });
};

export type ScriptResultPayload = {
  readonly runId: string;
  readonly scriptId: string;
  readonly trigger: ScriptPayloadTrigger;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly detail?: string | null;
  readonly timedOut?: boolean;
};

const AgentResult = Schema.Struct({
  runId: Schema.String,
  scriptId: Schema.String,
  trigger: Schema.String,
  exitCode: Schema.NullOr(Schema.Number),
  stdout: Schema.String,
  stderr: Schema.String,
  durationMs: Schema.NullOr(Schema.Number),
  startedAt: Schema.NullOr(Schema.String),
  finishedAt: Schema.NullOr(Schema.String),
  detail: Schema.optional(Schema.NullOr(Schema.String)),
  timedOut: Schema.optional(Schema.Boolean),
});

/**
 * Validate the JSON an agent posts. The backend applies its own schema; this
 * keeps the wire contract in the protocol package so the agent and server
 * cannot drift.
 */
export const parseScriptResult = (value: Schema.Json): ScriptResultPayload | null =>
  Option.match(Schema.decodeUnknownOption(AgentResult)(value), {
    onNone: () => null,
    onSome: (decoded) => {
      const trigger = Option.getOrNull(
        Schema.decodeUnknownOption(ScriptTriggerType)(decoded.trigger),
      );

      return trigger ? { ...decoded, trigger } : null;
    },
  });
