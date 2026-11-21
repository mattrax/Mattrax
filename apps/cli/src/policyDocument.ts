import { readFile } from "node:fs/promises";
import { Effect, Option, Schema } from "effect";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  CreatePolicyRequest as CreatePolicyRequestSchema,
  IdResponse as IdResponseSchema,
  PatchPolicyRequest as PatchPolicyRequestSchema,
  PolicyListResponse as PolicyListResponseSchema,
  PolicyRow as PolicyRowSchema,
} from "@mattrax/enterprise-domain/client";
import {
  JsonRecord,
  PORTABLE_POLICY_VERSION,
  PortablePolicy as PortablePolicySchema,
  PortablePolicyDocument as PortablePolicyDocumentSchema,
} from "@mattrax/enterprise-domain/client";
import { CliFailure } from "./settings.ts";

type PolicyList = typeof PolicyListResponseSchema.Type;

type PolicyRow = typeof PolicyRowSchema.Type;

type IdResponse = typeof IdResponseSchema.Type;

type CreatePolicy = typeof CreatePolicyRequestSchema.Type;

type PatchPolicy = typeof PatchPolicyRequestSchema.Type;

/** The document format is shared with the dashboard's policy import. */
export { PORTABLE_POLICY_VERSION };

export const PortablePolicy = PortablePolicySchema;

export type PortablePolicy = typeof PortablePolicy.Type;

export const PortablePolicyDocument = PortablePolicyDocumentSchema;

export type PortablePolicyDocument = typeof PortablePolicyDocument.Type;

export interface PolicyDocumentSource {
  readonly source: string;
  readonly document: PortablePolicyDocument;
}

export interface PolicyDocumentIssue {
  readonly source: string;
  readonly path: string | undefined;
  readonly message: string;
}

export interface ExportPolicyOptions {
  /** Include server ids so a same-deployment round trip can patch in place. */
  readonly includeIds: boolean;
}

export type PolicyDocumentFormat = "yaml" | "json";

export const serializePolicyDocument = (
  document: PortablePolicyDocument,
  format: PolicyDocumentFormat,
): string =>
  format === "json"
    ? `${JSON.stringify(document, null, 2)}\n`
    : stringifyYaml(document, { lineWidth: 0 });

/** Compare JSON payloads regardless of object key insertion order. */
export const stableJson = (value: Schema.Json): string =>
  JSON.stringify(value, (_key, nested) => {
    const object = Schema.decodeUnknownOption(JsonRecord)(nested);

    if (Option.isNone(object)) return nested;

    return Object.fromEntries(
      Object.entries(object.value).sort(([left], [right]) => left.localeCompare(right)),
    );
  });

/** Parse and structurally decode one YAML or JSON document. */
export const parsePolicyDocument = (
  text: string,
  source: string,
): Effect.Effect<PortablePolicyDocument, CliFailure> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => parseYaml(text),
      catch: () =>
        new CliFailure({
          message: `${source} is not valid YAML or JSON.`,
        }),
    });

    return yield* Schema.decodeUnknownEffect(PortablePolicyDocument)(parsed).pipe(
      Effect.mapError(
        (error) =>
          new CliFailure({
            message: `${source} is not a portable Mattrax policy document.\n${error.message}`,
            hint: "Expected `version: 1` and a `policies` array.",
          }),
      ),
    );
  });

/** Read one file and decode it. File errors name the path, never the contents. */
export const readPolicyDocument = (path: string): Effect.Effect<PolicyDocumentSource, CliFailure> =>
  Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: () =>
        new CliFailure({
          message: `Could not read ${path}.`,
        }),
    });

    const document = yield* parsePolicyDocument(text, path);

    return { source: path, document };
  });

const semanticIssues = (
  source: string,
  document: PortablePolicyDocument,
): ReadonlyArray<PolicyDocumentIssue> => {
  const issues: PolicyDocumentIssue[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();

  document.policies.forEach((policy, index) => {
    const at = `policies[${index}]`;
    const name = policy.name.trim();

    if (!name)
      issues.push({ source, path: `${at}.name`, message: "Policy name must not be empty." });

    if (names.has(name))
      issues.push({
        source,
        path: `${at}.name`,
        message: `Duplicate policy name "${name}".`,
      });
    names.add(name);

    if (policy.id) {
      if (ids.has(policy.id))
        issues.push({
          source,
          path: `${at}.id`,
          message: `Duplicate policy id "${policy.id}".`,
        });
      ids.add(policy.id);
    }

    if (policy.priority !== undefined && !Number.isSafeInteger(policy.priority))
      issues.push({
        source,
        path: `${at}.priority`,
        message: "Policy priority must be a whole number.",
      });
  });

  return issues;
};

/**
 * Validate decoded documents, including uniqueness across files. Two files that
 * define the same policy name would otherwise make apply order-dependent.
 */
export const validatePolicyDocuments = (
  documents: ReadonlyArray<PolicyDocumentSource>,
): ReadonlyArray<PolicyDocumentIssue> => {
  const issues = documents.flatMap((entry) => semanticIssues(entry.source, entry.document));
  const names = new Map<string, string>();
  const ids = new Map<string, string>();

  documents.forEach((entry) => {
    entry.document.policies.forEach((policy, index) => {
      const name = policy.name.trim();
      const previousName = names.get(name);

      if (previousName && previousName !== entry.source)
        issues.push({
          source: entry.source,
          path: `policies[${index}].name`,
          message: `Policy "${name}" is also defined in ${previousName}.`,
        });
      else names.set(name, entry.source);

      if (!policy.id) return;

      const previousId = ids.get(policy.id);

      if (previousId && previousId !== entry.source)
        issues.push({
          source: entry.source,
          path: `policies[${index}].id`,
          message: `Policy id "${policy.id}" is also defined in ${previousId}.`,
        });
      else ids.set(policy.id, entry.source);
    });
  });

  return issues;
};

export const formatPolicyIssues = (issues: ReadonlyArray<PolicyDocumentIssue>): string =>
  issues
    .map((issue) => `${issue.source}${issue.path ? `: ${issue.path}` : ""}: ${issue.message}`)
    .join("\n");

const portablePolicy = (policy: PolicyRow, includeIds: boolean): PortablePolicy => ({
  id: includeIds ? policy.id : undefined,
  name: policy.name,
  notes: policy.notes,
  priority: policy.priority,
  // Absence means enabled in the document, so only a disabled policy is
  // written out.
  enabled: policy.enabled === false ? false : undefined,
  configurations: policy.configurations,
  // Omitted scopes are device-scoped; write only the user channel entries.
  ...(Object.values(policy.configurationScopes ?? {}).includes("user")
    ? {
        configurationScopes: Object.fromEntries(
          Object.entries(policy.configurationScopes ?? {}).filter(([, scope]) => scope === "user"),
        ),
      }
    : {}),
});

/** Build a deterministic document sorted by name, then id. */
export const exportPolicyDocument = (
  policies: ReadonlyArray<PolicyRow>,
  options: ExportPolicyOptions,
): PortablePolicyDocument => ({
  version: PORTABLE_POLICY_VERSION,
  policies: [...policies]
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
    .map((policy) => portablePolicy(policy, options.includeIds)),
});

export interface PolicyApplyTarget {
  readonly listPolicies: () => Effect.Effect<PolicyList, CliFailure>;
  readonly getPolicy: (policyId: string) => Effect.Effect<PolicyRow, CliFailure>;
  readonly createPolicy: (payload: CreatePolicy) => Effect.Effect<IdResponse, CliFailure>;
  readonly patchPolicy: (policyId: string, payload: PatchPolicy) => Effect.Effect<void, CliFailure>;
}

export interface PolicyApplyOptions {
  readonly dryRun: boolean;
  /** Force every policy in the document onto this server id. */
  readonly id: string | undefined;
}

export type PolicyApplyAction = "created" | "updated" | "unchanged";

export interface PolicyApplyEntry {
  readonly action: PolicyApplyAction;
  readonly name: string;
  readonly id: string | undefined;
  /** Fields that would change (or did change) on update. */
  readonly fields: ReadonlyArray<string>;
}

export interface PolicyApplyReport {
  readonly dryRun: boolean;
  readonly entries: ReadonlyArray<PolicyApplyEntry>;
}

const unchanged = (entry: PolicyApplyEntry): boolean => entry.action === "unchanged";

const findByName = (
  policies: ReadonlyArray<PolicyRow>,
  name: string,
): Effect.Effect<PolicyRow | undefined, CliFailure> => {
  const matches = policies.filter((policy) => policy.name === name);

  if (matches.length > 1)
    return Effect.fail(
      new CliFailure({
        message: `More than one policy is named "${name}".`,
        hint: `Patch by id instead:\n${matches.map((policy) => `${policy.id}  ${policy.name}`).join("\n")}`,
      }),
    );

  return Effect.succeed(matches[0]);
};

interface PolicyPatch {
  readonly payload: PatchPolicy;
  readonly fields: ReadonlyArray<string>;
}

interface MutablePolicyPatch {
  name?: string;
  notes?: string | null;
  priority?: number;
  configurations?: Record<string, Schema.Json | null>;
  configurationScopes?: Record<string, "device" | "user">;
}

const buildPatch = (desired: PortablePolicy, existing: PolicyRow): PolicyPatch => {
  const fields: string[] = [];
  const payload: MutablePolicyPatch = {};

  if (desired.name !== existing.name) {
    fields.push("name");
    payload.name = desired.name;
  }

  if (desired.notes !== undefined && (desired.notes ?? null) !== (existing.notes ?? null)) {
    fields.push("notes");
    payload.notes = desired.notes;
  }

  if (desired.priority !== undefined && desired.priority !== existing.priority) {
    fields.push("priority");
    payload.priority = desired.priority;
  }

  if (desired.configurations !== undefined) {
    const existingConfigurations = existing.configurations ?? {};
    const changes: Record<string, Schema.Json | null> = {};

    for (const [kind, value] of Object.entries(desired.configurations)) {
      const desiredJson = Schema.decodeUnknownSync(Schema.Json)(value);

      if (!(kind in existingConfigurations)) {
        changes[kind] = desiredJson;
        continue;
      }

      const existingJson = Schema.decodeUnknownSync(Schema.Json)(existingConfigurations[kind]);

      if (stableJson(existingJson) !== stableJson(desiredJson)) changes[kind] = desiredJson;
    }

    for (const kind of Object.keys(existingConfigurations))
      if (!(kind in desired.configurations)) changes[kind] = null;

    // A supplied scope map is authoritative for the kinds it carries, so every
    // written kind needs an entry. An omitted scope keeps the stored channel,
    // which preserves user-scoped settings across a document that predates
    // scope.
    const storedScopes = existing.configurationScopes ?? {};
    const scopes: Record<string, "device" | "user"> = {};
    const written = { ...changes };
    let scopeChanged = false;

    for (const kind of Object.keys(changes)) {
      if (changes[kind] === null) continue;

      const scope = desired.configurationScopes?.[kind] ?? storedScopes[kind] ?? "device";

      scopes[kind] = scope;

      if (scope !== (storedScopes[kind] ?? "device")) scopeChanged = true;
    }

    // A scope-only change must be detected even when no payload differs, and
    // the patch re-sends the stored payload so the server validates the new
    // channel instead of ignoring the scope map.
    for (const [kind, scope] of Object.entries(desired.configurationScopes ?? {})) {
      if (kind in written || scope === (storedScopes[kind] ?? "device")) continue;

      const stored = existing.configurations?.[kind];

      if (stored === undefined) continue;
      written[kind] = Schema.decodeUnknownSync(Schema.Json)(stored);
      scopes[kind] = scope;
      scopeChanged = true;
    }

    if (Object.keys(changes).length > 0) fields.push("configurations");

    if (Object.keys(written).length > 0) payload.configurations = written;

    if (Object.keys(scopes).length > 0) payload.configurationScopes = scopes;

    if (scopeChanged) fields.push("configurationScopes");
  }

  return { payload, fields };
};

const applyOne = (
  target: PolicyApplyTarget,
  policy: PortablePolicy,
  existing: PolicyRow | undefined,
  options: PolicyApplyOptions,
): Effect.Effect<PolicyApplyEntry, CliFailure> => {
  if (!existing) {
    if (options.dryRun)
      return Effect.succeed({
        action: "created",
        name: policy.name,
        id: undefined,
        fields: ["name"],
      });

    return Effect.gen(function* () {
      const payload: CreatePolicy = {
        name: policy.name,
        notes: policy.notes,
        priority: policy.priority,
      };

      const fields = ["name"];

      if (policy.configurations !== undefined) fields.push("configurations");

      const { id } = yield* target.createPolicy(payload);

      if (policy.configurations !== undefined)
        yield* target.patchPolicy(id, {
          configurations: policy.configurations,
          ...(policy.configurationScopes
            ? { configurationScopes: policy.configurationScopes }
            : {}),
        });

      return { action: "created" as const, name: policy.name, id, fields };
    });
  }

  return Effect.gen(function* () {
    const current = yield* target.getPolicy(existing.id);
    const patch = buildPatch(policy, current);

    if (patch.fields.length === 0)
      return {
        action: "unchanged" as const,
        name: policy.name,
        id: existing.id,
        fields: [],
      };

    if (!options.dryRun) yield* target.patchPolicy(existing.id, patch.payload);

    return {
      action: "updated" as const,
      name: policy.name,
      id: existing.id,
      fields: patch.fields,
    };
  });
};

/**
 * Create or patch each policy, matching by name unless `--id` or a document id
 * is supplied. Comparing the fetched configuration map makes repeated runs
 * report `unchanged` instead of writing the same rows again.
 */
export const applyPolicyDocuments = (
  target: PolicyApplyTarget,
  documents: ReadonlyArray<PolicyDocumentSource>,
  options: PolicyApplyOptions,
): Effect.Effect<PolicyApplyReport, CliFailure> =>
  Effect.gen(function* () {
    const policies = documents.flatMap((entry) => entry.document.policies);

    if (options.id && policies.length !== 1)
      return yield* Effect.fail(
        new CliFailure({
          message: `--id applies a single policy, but the documents contain ${policies.length}.`,
          hint: "Pass one document with one policy, or move the id into the document.",
        }),
      );

    const { rows } = yield* target.listPolicies();
    const entries: PolicyApplyEntry[] = [];

    for (const policy of policies) {
      const explicitId = options.id ?? policy.id;
      let existing: PolicyRow | undefined;

      if (explicitId) {
        existing = rows.find((row) => row.id === explicitId);

        if (!existing)
          return yield* Effect.fail(
            new CliFailure({
              message: `Policy id "${explicitId}" was not found.`,
              hint: "Create it without --id, or correct the id in the document.",
            }),
          );
      } else {
        existing = yield* findByName(rows, policy.name);
      }

      entries.push(yield* applyOne(target, policy, existing, options));
    }

    return { dryRun: options.dryRun, entries };
  });

export const countPolicyActions = (report: PolicyApplyReport) => ({
  created: report.entries.filter((entry) => entry.action === "created").length,
  updated: report.entries.filter((entry) => entry.action === "updated").length,
  unchanged: report.entries.filter(unchanged).length,
});
