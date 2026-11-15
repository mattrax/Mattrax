import { Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import {
  DynamicGroupRules,
  CreateGroupRequest as CreateGroupRequestSchema,
} from "@mattrax/enterprise-domain/client";
import { formatJson, formatKeyValues, formatTable, line } from "../output.ts";
import {
  type GroupApplyTarget,
  applyGroupDocuments,
  formatGroupIssues,
  readGroupDocument,
  validateGroupDocuments,
} from "../groupDocument.ts";
import { CliFailure } from "../settings.ts";
import {
  commandContext,
  resolveDeviceIds,
  resolveGroupId,
  resolvePolicyIds,
  resolveTenantId,
} from "./shared.ts";

type CreateGroupPayload = typeof CreateGroupRequestSchema.Type;

const timestamp = (value: string): string => value.replace("T", " ").slice(0, 16);

const splitList = (value: string | undefined): ReadonlyArray<string> =>
  value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const list = Command.make(
  "list",
  {},
  Effect.fn(function* () {
    const { flags, settings, api } = yield* commandContext();
    const tenantId = yield* resolveTenantId(api, settings);
    const { rows } = yield* api.listGroups(tenantId);

    if (flags.json) {
      yield* line(formatJson({ groups: rows }));

      return;
    }

    if (rows.length === 0) {
      yield* line("No groups.");

      return;
    }

    yield* line(
      formatTable(
        ["NAME", "KIND", "DEVICES", "POLICIES", "UPDATED", "ID"],
        rows.map((group) => [
          group.name,
          group.kind,
          group.devicesCount,
          group.policiesCount,
          timestamp(group.updatedAt),
          group.id,
        ]),
      ),
    );
  }),
).pipe(Command.withDescription("List groups"));

const get = Command.make(
  "get",
  { id: Argument.String("id").pipe(Argument.withDescription("Group id or exact name")) },
  Effect.fn(function* (config) {
    const { flags, settings, api } = yield* commandContext();
    const tenantId = yield* resolveTenantId(api, settings);
    const groupId = yield* resolveGroupId(api, tenantId, config.id);
    const group = yield* api.getGroup(tenantId, groupId);

    if (flags.json) {
      yield* line(formatJson(group));

      return;
    }

    yield* line(
      formatKeyValues([
        { key: "ID", value: group.id },
        { key: "Name", value: group.name },
        { key: "Kind", value: group.kind },
        { key: "Notes", value: group.notes },
        { key: "Devices", value: group.devices?.length ?? group.devicesCount ?? 0 },
        { key: "Policies", value: group.policies?.length ?? group.policiesCount ?? 0 },
        { key: "Evaluated", value: group.lastEvaluatedAt },
      ]),
    );

    if (group.devices && group.devices.length > 0) {
      yield* line("");
      yield* line("Members:");
      yield* line(
        formatTable(
          ["NAME", "ID"],
          group.devices.map((device) => [device.name, device.id]),
        ),
      );
    }

    if (group.policies && group.policies.length > 0) {
      yield* line("");
      yield* line("Policies:");
      yield* line(
        formatTable(
          ["NAME", "MODE", "PRIORITY", "ID"],
          group.policies.map((policy) => [policy.name, policy.mode, policy.priority, policy.id]),
        ),
      );
    }
  }),
).pipe(Command.withDescription("Show a group and its membership"));

const parseRules = (raw: string): Effect.Effect<DynamicGroupRules, CliFailure> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw),
      catch: () =>
        new CliFailure({
          message: "--rules must be JSON.",
          hint: 'Example: --rules \'{"version":1,"all":[]}\'',
        }),
    });

    return yield* Schema.decodeUnknownEffect(DynamicGroupRules)(parsed).pipe(
      Effect.mapError(
        (error) =>
          new CliFailure({
            message: `--rules is not a valid dynamic group rule set.\n${error.message}`,
          }),
      ),
    );
  });

const create = Command.make(
  "create",
  {
    name: Argument.String("name").pipe(Argument.withDescription("Group name")),
    notes: Flag.String("notes").pipe(Flag.withDescription("Notes"), Flag.optional),
    kind: Flag.Literals("kind", ["manual", "dynamic"]).pipe(
      Flag.withDescription("Membership kind (defaults to manual)"),
      Flag.withDefault("manual" as const),
    ),
    rules: Flag.String("rules").pipe(
      Flag.withDescription("Dynamic membership rules as JSON (required for dynamic groups)"),
      Flag.optional,
    ),
    devices: Flag.String("devices").pipe(
      Flag.withDescription("Comma-separated device ids, serials or names"),
      Flag.optional,
    ),
    policies: Flag.String("policies").pipe(
      Flag.withDescription("Comma-separated policy ids or names"),
      Flag.optional,
    ),
  },
  Effect.fn(function* (config) {
    const { flags, settings, api } = yield* commandContext();
    const tenantId = yield* resolveTenantId(api, settings);

    if (config.kind !== "dynamic" && Option.isSome(config.rules))
      return yield* Effect.fail(
        new CliFailure({
          message: "Manual groups do not accept --rules; set --kind dynamic.",
        }),
      );

    const rules =
      config.kind === "dynamic"
        ? yield* parseRules(Option.getOrUndefined(config.rules) ?? "")
        : undefined;

    const deviceRefs = splitList(Option.getOrUndefined(config.devices));
    const policyRefs = splitList(Option.getOrUndefined(config.policies));

    if (config.kind === "dynamic" && deviceRefs.length > 0)
      return yield* Effect.fail(
        new CliFailure({
          message: "Dynamic groups derive device membership from rules; remove --devices.",
        }),
      );

    const devices = yield* resolveDeviceIds(api, tenantId, deviceRefs);
    const policies = yield* resolvePolicyIds(api, tenantId, policyRefs);

    const payload: CreateGroupPayload = {
      name: config.name,
      notes: Option.getOrUndefined(config.notes),
      kind: config.kind,
      rules,
      devices: devices.length ? [...devices] : undefined,
      policies: policies.length ? [...policies] : undefined,
    };

    const { id } = yield* api.createGroup(tenantId, payload);

    if (flags.json) {
      yield* line(formatJson({ id, name: config.name, kind: config.kind }));

      return;
    }

    yield* line(
      `Created ${config.kind} group ${config.name} (${id}) with ${devices.length} devices and ${policies.length} policies.`,
    );
  }),
).pipe(Command.withDescription("Create a manual or dynamic group"));

const apply = Command.make(
  "apply",
  {
    files: Argument.String("files").pipe(
      Argument.variadic({ min: 1 }),
      Argument.withDescription("One or more group documents"),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Show planned changes without writing"),
      Flag.withDefault(false),
    ),
    id: Flag.String("id").pipe(
      Flag.withDescription("Patch this group id (the document must contain one group)"),
      Flag.optional,
    ),
  },
  Effect.fn(function* (config) {
    const { flags, settings, api } = yield* commandContext();
    const tenantId = yield* resolveTenantId(api, settings);
    const documents = yield* Effect.forEach(config.files, readGroupDocument);
    const issues = validateGroupDocuments(documents);

    if (issues.length > 0)
      return yield* Effect.fail(
        new CliFailure({
          message: `The group documents are invalid:\n${formatGroupIssues(issues)}`,
        }),
      );

    const target: GroupApplyTarget = {
      listGroups: () => api.listGroups(tenantId),
      getGroup: (groupId) => api.getGroup(tenantId, groupId),
      createGroup: (payload) => api.createGroup(tenantId, payload),
      patchGroup: (groupId, payload) => api.patchGroup(tenantId, groupId, payload),
      patchGroupMembers: (groupId, payload) => api.patchGroupMembers(tenantId, groupId, payload),
      listPolicies: () => api.listPolicies(tenantId),
      listDevices: () => api.listDevices(tenantId),
    };

    const report = yield* applyGroupDocuments(target, documents, {
      dryRun: config.dryRun,
      id: Option.getOrUndefined(config.id),
    });

    if (flags.json) {
      yield* line(formatJson(report));

      return;
    }

    for (const entry of report.entries) {
      const detail = entry.fields.length > 0 ? ` (${entry.fields.join(", ")})` : "";
      const id = entry.id ? ` ${entry.id}` : "";

      yield* line(`${entry.action.padEnd(10)} ${entry.name}${id}${detail}`);
    }

    const created = report.entries.filter((entry) => entry.action === "created").length;
    const updated = report.entries.filter((entry) => entry.action === "updated").length;
    const unchanged = report.entries.filter((entry) => entry.action === "unchanged").length;

    yield* line("");
    yield* line(
      `${report.dryRun ? "Dry run: " : ""}${created} created, ${updated} updated, ${unchanged} unchanged.`,
    );
  }),
).pipe(Command.withDescription("Create or patch groups from portable documents"));

export const groupsCommand = Command.make("groups").pipe(
  Command.withDescription("List, inspect and apply groups"),
  Command.withSubcommands([list, get, create, apply]),
);
