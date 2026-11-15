import { readFile } from "node:fs/promises";
import { Effect, Schema } from "effect";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  DynamicGroupKind,
  DynamicGroupRules,
  CreateGroupRequest as CreateGroupRequestSchema,
  DeviceListResponse as DeviceListResponseSchema,
  GroupListResponse as GroupListResponseSchema,
  IdResponse as IdResponseSchema,
  PatchGroupMembersRequest as PatchGroupMembersRequestSchema,
  PatchGroupRequest as PatchGroupRequestSchema,
  PolicyListResponse as PolicyListResponseSchema,
  type DeviceRow,
  type GroupNode,
  type GroupRow,
  type PolicyRow,
} from "@mattrax/enterprise-domain/client";
import { CliFailure } from "./settings.ts";
import {
  type PolicyDocumentFormat,
  type PolicyDocumentIssue,
  formatPolicyIssues,
  stableJson,
} from "./policyDocument.ts";

type GroupList = typeof GroupListResponseSchema.Type;

type GroupPayload = typeof CreateGroupRequestSchema.Type;

type PatchGroupPayload = typeof PatchGroupRequestSchema.Type;

type PatchGroupMembersPayload = typeof PatchGroupMembersRequestSchema.Type;

type PolicyList = typeof PolicyListResponseSchema.Type;

type DeviceList = typeof DeviceListResponseSchema.Type;

type IdResponse = typeof IdResponseSchema.Type;

export const PORTABLE_GROUP_VERSION = 1;

export const PortableGroup = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.String,
  notes: Schema.optional(Schema.NullOr(Schema.String)),
  kind: Schema.optional(DynamicGroupKind),
  rules: Schema.optional(Schema.NullOr(DynamicGroupRules)),
  /** Device ids, serials or exact names. Dynamic groups derive membership. */
  devices: Schema.optional(Schema.Array(Schema.String)),
  /** Policy ids or exact names. */
  policies: Schema.optional(Schema.Array(Schema.String)),
});

export type PortableGroup = typeof PortableGroup.Type;

export const PortableGroupDocument = Schema.Struct({
  version: Schema.Literal(PORTABLE_GROUP_VERSION),
  groups: Schema.Array(PortableGroup),
});

export type PortableGroupDocument = typeof PortableGroupDocument.Type;

export interface GroupDocumentSource {
  readonly source: string;
  readonly document: PortableGroupDocument;
}

export const readGroupDocument = (path: string): Effect.Effect<GroupDocumentSource, CliFailure> =>
  Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: () => new CliFailure({ message: `Could not read ${path}.` }),
    });

    const parsed = yield* Effect.try({
      try: () => parseYaml(text),
      catch: () => new CliFailure({ message: `${path} is not valid YAML or JSON.` }),
    });

    const document = yield* Schema.decodeUnknownEffect(PortableGroupDocument)(parsed).pipe(
      Effect.mapError(
        (error) =>
          new CliFailure({
            message: `${path} is not a portable Mattrax group document.\n${error.message}`,
            hint: "Expected `version: 1` and a `groups` array.",
          }),
      ),
    );

    return { source: path, document };
  });

const semanticIssues = (
  source: string,
  document: PortableGroupDocument,
): ReadonlyArray<PolicyDocumentIssue> => {
  const issues: PolicyDocumentIssue[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();

  document.groups.forEach((group, index) => {
    const at = `groups[${index}]`;
    const name = group.name.trim();

    if (!name)
      issues.push({ source, path: `${at}.name`, message: "Group name must not be empty." });

    if (names.has(name))
      issues.push({ source, path: `${at}.name`, message: `Duplicate group name "${name}".` });
    names.add(name);

    if (group.id) {
      if (ids.has(group.id))
        issues.push({ source, path: `${at}.id`, message: `Duplicate group id "${group.id}".` });
      ids.add(group.id);
    }

    if (group.kind === "dynamic" && (group.devices?.length ?? 0) > 0)
      issues.push({
        source,
        path: `${at}.devices`,
        message: "Dynamic groups derive device membership from rules; remove `devices`.",
      });

    if (group.kind !== "dynamic" && group.rules != null)
      issues.push({
        source,
        path: `${at}.rules`,
        message: "Manual groups do not accept membership rules; set `kind: dynamic`.",
      });

    if (group.kind === "dynamic" && group.rules == null)
      issues.push({
        source,
        path: `${at}.rules`,
        message: "Dynamic groups require membership rules.",
      });
  });

  return issues;
};

export const validateGroupDocuments = (
  documents: ReadonlyArray<GroupDocumentSource>,
): ReadonlyArray<PolicyDocumentIssue> => {
  const issues = documents.flatMap((entry) => semanticIssues(entry.source, entry.document));
  const names = new Map<string, string>();
  const ids = new Map<string, string>();

  documents.forEach((entry) => {
    entry.document.groups.forEach((group, index) => {
      const name = group.name.trim();
      const previousName = names.get(name);

      if (previousName && previousName !== entry.source)
        issues.push({
          source: entry.source,
          path: `groups[${index}].name`,
          message: `Group "${name}" is also defined in ${previousName}.`,
        });
      else names.set(name, entry.source);

      if (!group.id) return;

      const previousId = ids.get(group.id);

      if (previousId && previousId !== entry.source)
        issues.push({
          source: entry.source,
          path: `groups[${index}].id`,
          message: `Group id "${group.id}" is also defined in ${previousId}.`,
        });
      else ids.set(group.id, entry.source);
    });
  });

  return issues;
};

export const formatGroupIssues = formatPolicyIssues;

export const serializeGroupDocument = (
  document: PortableGroupDocument,
  format: PolicyDocumentFormat,
): string =>
  format === "json"
    ? `${JSON.stringify(document, null, 2)}\n`
    : stringifyYaml(document, { lineWidth: 0 });

export interface GroupApplyTarget {
  readonly listGroups: () => Effect.Effect<GroupList, CliFailure>;
  readonly getGroup: (groupId: string) => Effect.Effect<GroupNode, CliFailure>;
  readonly createGroup: (payload: GroupPayload) => Effect.Effect<IdResponse, CliFailure>;
  readonly patchGroup: (
    groupId: string,
    payload: PatchGroupPayload,
  ) => Effect.Effect<void, CliFailure>;
  readonly patchGroupMembers: (
    groupId: string,
    payload: PatchGroupMembersPayload,
  ) => Effect.Effect<void, CliFailure>;
  readonly listPolicies: () => Effect.Effect<PolicyList, CliFailure>;
  readonly listDevices: () => Effect.Effect<DeviceList, CliFailure>;
}

export interface GroupApplyOptions {
  readonly dryRun: boolean;
  readonly id: string | undefined;
}

export type GroupApplyAction = "created" | "updated" | "unchanged";

export interface GroupApplyEntry {
  readonly action: GroupApplyAction;
  readonly name: string;
  readonly id: string | undefined;
  readonly fields: ReadonlyArray<string>;
}

export interface GroupApplyReport {
  readonly dryRun: boolean;
  readonly entries: ReadonlyArray<GroupApplyEntry>;
}

const resolvePolicyRefs = (
  policies: ReadonlyArray<PolicyRow>,
  references: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, CliFailure> =>
  Effect.gen(function* () {
    const ids: string[] = [];

    for (const reference of references) {
      const needle = reference.toLocaleLowerCase();

      const matches = policies.filter(
        (policy) => policy.id === reference || policy.name.toLocaleLowerCase() === needle,
      );

      if (matches.length === 0)
        return yield* Effect.fail(
          new CliFailure({
            message: `Policy "${reference}" was not found.`,
            hint:
              policies.length === 0
                ? "This tenant has no policies."
                : `Known policies:\n${policies.map((policy) => `${policy.id}  ${policy.name}`).join("\n")}`,
          }),
        );

      if (matches.length > 1)
        return yield* Effect.fail(
          new CliFailure({
            message: `Policy "${reference}" is ambiguous.`,
            hint: matches.map((policy) => `${policy.id}  ${policy.name}`).join("\n"),
          }),
        );

      if (!ids.includes(matches[0].id)) ids.push(matches[0].id);
    }

    return ids;
  });

const resolveDeviceRefs = (
  devices: ReadonlyArray<DeviceRow>,
  references: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, CliFailure> =>
  Effect.gen(function* () {
    const ids: string[] = [];

    for (const reference of references) {
      const needle = reference.toLocaleLowerCase();

      const matches = devices.filter(
        (device) =>
          device.id === reference ||
          device.serial === reference ||
          device.name.toLocaleLowerCase() === needle,
      );

      if (matches.length === 0)
        return yield* Effect.fail(
          new CliFailure({ message: `Device "${reference}" was not found.` }),
        );

      if (matches.length > 1)
        return yield* Effect.fail(
          new CliFailure({
            message: `Device "${reference}" is ambiguous.`,
            hint: matches.map((device) => `${device.id}  ${device.name}`).join("\n"),
          }),
        );

      if (!ids.includes(matches[0].id)) ids.push(matches[0].id);
    }

    return ids;
  });

interface MemberDiff {
  readonly assign: ReadonlyArray<string>;
  readonly unassign: ReadonlyArray<string>;
}

const difference = (
  desired: ReadonlyArray<string>,
  current: ReadonlyArray<string>,
): MemberDiff => ({
  assign: desired.filter((id) => !current.includes(id)),
  unassign: current.filter((id) => !desired.includes(id)),
});

const findGroup = (
  groups: ReadonlyArray<GroupRow>,
  reference: string,
): Effect.Effect<GroupRow | undefined, CliFailure> => {
  const needle = reference.toLocaleLowerCase();

  const matches = groups.filter(
    (group) => group.id === reference || group.name.toLocaleLowerCase() === needle,
  );

  if (matches.length > 1)
    return Effect.fail(
      new CliFailure({
        message: `More than one group is named "${reference}".`,
        hint: `Patch by id instead:\n${matches.map((group) => `${group.id}  ${group.name}`).join("\n")}`,
      }),
    );

  return Effect.succeed(matches[0]);
};

const rulesJson = (rules: GroupNode["rules"]): Schema.Json =>
  Schema.decodeUnknownSync(Schema.Json)(rules ?? null);

interface MutableGroupPatch {
  name?: string;
  notes?: string | null;
  kind?: GroupNode["kind"];
  rules?: GroupNode["rules"];
}

interface GroupPatchPlan {
  readonly payload: PatchGroupPayload;
  readonly fields: ReadonlyArray<string>;
}

const buildGroupPatch = (desired: PortableGroup, existing: GroupNode): GroupPatchPlan => {
  const fields: string[] = [];
  const payload: MutableGroupPatch = {};

  if (desired.name !== existing.name) {
    fields.push("name");
    payload.name = desired.name;
  }

  if (desired.notes !== undefined && (desired.notes ?? null) !== (existing.notes ?? null)) {
    fields.push("notes");
    payload.notes = desired.notes;
  }

  if (desired.kind !== undefined && desired.kind !== existing.kind) {
    fields.push("kind");
    payload.kind = desired.kind;
  }

  if (
    desired.rules !== undefined &&
    stableJson(rulesJson(desired.rules)) !== stableJson(rulesJson(existing.rules))
  ) {
    fields.push("rules");
    payload.rules = desired.rules;
  }

  return { payload, fields };
};

const applyOne = (
  target: GroupApplyTarget,
  group: PortableGroup,
  existing: GroupRow | undefined,
  options: GroupApplyOptions,
): Effect.Effect<GroupApplyEntry, CliFailure> =>
  Effect.gen(function* () {
    const kind = group.kind ?? existing?.kind ?? "manual";
    const { rows: policies } = yield* target.listPolicies();
    const policyIds = yield* resolvePolicyRefs(policies, group.policies ?? []);
    const deviceReferences = group.devices ?? [];

    const deviceIds =
      kind === "dynamic" || deviceReferences.length === 0
        ? []
        : yield* resolveDeviceRefs((yield* target.listDevices()).rows, deviceReferences);

    if (!existing) {
      const createdFields = ["name"];

      if (policyIds.length) createdFields.push("policies");

      if (deviceIds.length) createdFields.push("devices");

      if (options.dryRun)
        return {
          action: "created" as const,
          name: group.name,
          id: undefined,
          fields: createdFields,
        };

      const payload: GroupPayload = {
        name: group.name,
        notes: group.notes,
        kind: group.kind,
        rules: group.rules,
        devices: deviceIds.length ? [...deviceIds] : undefined,
        policies: policyIds.length ? [...policyIds] : undefined,
      };

      const { id } = yield* target.createGroup(payload);

      return {
        action: "created" as const,
        name: group.name,
        id,
        fields: createdFields,
      };
    }

    const current = yield* target.getGroup(existing.id);
    const patch = buildGroupPatch(group, current);
    const fields = [...patch.fields];

    const currentDevices = (current.devices ?? []).map((device) => device.id);

    const currentPolicies = (current.policies ?? [])
      .filter((policy) => policy.mode === "include")
      .map((policy) => policy.id);

    const deviceDiff: MemberDiff =
      kind === "manual" && group.devices !== undefined
        ? difference(deviceIds, currentDevices)
        : { assign: [], unassign: [] };

    const policyDiff =
      group.policies !== undefined
        ? difference(policyIds, currentPolicies)
        : { assign: [], unassign: [] };

    const assign = {
      devices: deviceDiff.assign.length ? [...deviceDiff.assign] : undefined,
      policies: policyDiff.assign.length ? [...policyDiff.assign] : undefined,
    };

    const unassign = {
      devices: deviceDiff.unassign.length ? [...deviceDiff.unassign] : undefined,
      policies: policyDiff.unassign.length ? [...policyDiff.unassign] : undefined,
    };

    const members: PatchGroupMembersPayload = {
      assign: assign.devices || assign.policies ? assign : undefined,
      unassign: unassign.devices || unassign.policies ? unassign : undefined,
    };

    const membersChanged = members.assign !== undefined || members.unassign !== undefined;

    if (membersChanged) fields.push("members");

    if (fields.length === 0)
      return { action: "unchanged" as const, name: group.name, id: existing.id, fields: [] };

    if (!options.dryRun) {
      if (patch.fields.length > 0) yield* target.patchGroup(existing.id, patch.payload);

      if (membersChanged) yield* target.patchGroupMembers(existing.id, members);
    }

    return { action: "updated" as const, name: group.name, id: existing.id, fields };
  });

export const applyGroupDocuments = (
  target: GroupApplyTarget,
  documents: ReadonlyArray<GroupDocumentSource>,
  options: GroupApplyOptions,
): Effect.Effect<GroupApplyReport, CliFailure> =>
  Effect.gen(function* () {
    const groups = documents.flatMap((entry) => entry.document.groups);

    if (options.id && groups.length !== 1)
      return yield* Effect.fail(
        new CliFailure({
          message: `--id applies a single group, but the documents contain ${groups.length}.`,
          hint: "Pass one document with one group, or move the id into the document.",
        }),
      );

    const { rows } = yield* target.listGroups();
    const entries: GroupApplyEntry[] = [];

    for (const group of groups) {
      const explicitId = options.id ?? group.id;
      let existing: GroupRow | undefined;

      if (explicitId) {
        existing = rows.find((row) => row.id === explicitId);

        if (!existing)
          return yield* Effect.fail(
            new CliFailure({
              message: `Group id "${explicitId}" was not found.`,
              hint: "Create it without --id, or correct the id in the document.",
            }),
          );
      } else {
        existing = yield* findGroup(rows, group.name);
      }

      entries.push(yield* applyOne(target, group, existing, options));
    }

    return { dryRun: options.dryRun, entries };
  });
