import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { stringify as stringifyYaml } from "yaml";
import { formatJson, formatKeyValues, formatTable, line } from "../output.ts";
import {
  applyPolicyDocuments,
  countPolicyActions,
  exportPolicyDocument,
  formatPolicyIssues,
  readPolicyDocument,
  serializePolicyDocument,
  validatePolicyDocuments,
} from "../policyDocument.ts";
import type { PolicyApplyTarget } from "../policyDocument.ts";
import { CliFailure } from "../settings.ts";
import { CliSecureFileStore } from "../secureFileStore.ts";
import { rootCommand } from "../global.ts";
import { commandContext, resolveTenantId } from "./shared.ts";

const timestamp = (value: string): string => value.replace("T", " ").slice(0, 16);

const list = Command.make(
  "list",
  {},
  Effect.fn(function* () {
    const { flags, settings, api } = yield* commandContext();
    const tenantId = yield* resolveTenantId(api, settings);
    const { rows } = yield* api.listPolicies(tenantId);

    if (flags.json) {
      yield* line(formatJson({ policies: rows }));

      return;
    }

    if (rows.length === 0) {
      yield* line("No policies.");

      return;
    }

    yield* line(
      formatTable(
        ["NAME", "PRIORITY", "UPDATED", "ID"],
        rows.map((policy) => [
          policy.name,
          policy.priority,
          timestamp(policy.updatedAt),
          policy.id,
        ]),
      ),
    );
  }),
).pipe(Command.withDescription("List policies"));

const get = Command.make(
  "get",
  { id: Argument.String("id").pipe(Argument.withDescription("Policy id")) },
  Effect.fn(function* (config) {
    const { flags, settings, api } = yield* commandContext();
    const tenantId = yield* resolveTenantId(api, settings);
    const policy = yield* api.getPolicy(tenantId, config.id);

    if (flags.json) {
      yield* line(formatJson(policy));

      return;
    }

    yield* line(
      formatKeyValues([
        { key: "ID", value: policy.id },
        { key: "Name", value: policy.name },
        { key: "Priority", value: policy.priority },
        { key: "Notes", value: policy.notes },
        { key: "Created", value: timestamp(policy.createdAt) },
        { key: "Updated", value: timestamp(policy.updatedAt) },
      ]),
    );

    if (policy.configurations) {
      yield* line("");
      yield* line("Configurations:");
      yield* line(stringifyYaml(policy.configurations, { lineWidth: 0 }).trimEnd());
    }
  }),
).pipe(Command.withDescription("Show one policy"));

const exportCommand = Command.make(
  "export",
  {
    format: Flag.Literals("format", ["yaml", "json"]).pipe(
      Flag.withDescription("Document format (defaults to YAML, or JSON with --json)"),
      Flag.optional,
    ),
    output: Flag.String("output").pipe(
      Flag.withAlias("o"),
      Flag.withDescription("Write the document to a file instead of stdout"),
      Flag.optional,
    ),
    id: Flag.String("id").pipe(Flag.withDescription("Export only this policy id"), Flag.optional),
    includeIds: Flag.Boolean("include-ids").pipe(
      Flag.withDescription("Include server ids for same-deployment round trips"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function* (config) {
    const { flags, settings, api } = yield* commandContext();
    const tenantId = yield* resolveTenantId(api, settings);
    const id = Option.getOrUndefined(config.id);

    const policies = id
      ? [yield* api.getPolicy(tenantId, id)]
      : yield* api.listPolicies(tenantId).pipe(
          Effect.flatMap(({ rows }) =>
            Effect.forEach(rows, (row) => api.getPolicy(tenantId, row.id), {
              concurrency: 8,
            }),
          ),
        );

    const document = exportPolicyDocument(policies, { includeIds: config.includeIds });
    const format = Option.getOrUndefined(config.format) ?? (flags.json ? "json" : "yaml");
    const text = serializePolicyDocument(document, format);
    const output = Option.getOrUndefined(config.output);

    if (!output) {
      yield* line(text.trimEnd());

      return;
    }

    const store = yield* CliSecureFileStore;
    yield* store.writePrivate(output, text);

    if (flags.json) {
      yield* line(
        formatJson({
          output,
          format,
          policies: document.policies.length,
        }),
      );

      return;
    }

    yield* line(`Wrote ${document.policies.length} policies to ${output} (${format}).`);
  }),
).pipe(Command.withDescription("Export policies as a portable YAML or JSON document"));

const apply = Command.make(
  "apply",
  {
    files: Argument.String("files").pipe(
      Argument.variadic({ min: 1 }),
      Argument.withDescription("One or more policy documents"),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Show planned changes without writing"),
      Flag.withDefault(false),
    ),
    id: Flag.String("id").pipe(
      Flag.withDescription("Patch this policy id (the document must contain one policy)"),
      Flag.optional,
    ),
  },
  Effect.fn(function* (config) {
    const { flags, settings, api } = yield* commandContext();
    const tenantId = yield* resolveTenantId(api, settings);
    const documents = yield* Effect.forEach(config.files, readPolicyDocument);
    const issues = validatePolicyDocuments(documents);

    if (issues.length > 0)
      return yield* Effect.fail(
        new CliFailure({
          message: `The policy documents are invalid:\n${formatPolicyIssues(issues)}`,
        }),
      );

    const target: PolicyApplyTarget = {
      listPolicies: () => api.listPolicies(tenantId),
      getPolicy: (policyId) => api.getPolicy(tenantId, policyId),
      createPolicy: (payload) => api.createPolicy(tenantId, payload),
      patchPolicy: (policyId, payload) => api.patchPolicy(tenantId, policyId, payload),
    };

    const report = yield* applyPolicyDocuments(target, documents, {
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

    const counts = countPolicyActions(report);
    yield* line("");
    yield* line(
      `${report.dryRun ? "Dry run: " : ""}${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged.`,
    );
  }),
).pipe(Command.withDescription("Create or patch policies from portable documents"));

const validate = Command.make(
  "validate",
  {
    files: Argument.String("files").pipe(
      Argument.variadic({ min: 1 }),
      Argument.withDescription("One or more policy documents"),
    ),
  },
  Effect.fn(function* (config) {
    const flags = yield* rootCommand;

    const results = yield* Effect.forEach(config.files, (file) =>
      readPolicyDocument(file).pipe(
        Effect.match({
          onFailure: (error) => ({ file, error: error.message, document: undefined }),
          onSuccess: (value) => ({ file, error: undefined, document: value }),
        }),
      ),
    );

    const parsed = results.flatMap((result) => (result.document ? [result.document] : []));

    const issues = validatePolicyDocuments(parsed);

    const parseFailures = results.flatMap((result) =>
      result.error ? [{ source: result.file, path: undefined, message: result.error }] : [],
    );

    const allIssues = [...parseFailures, ...issues];

    if (flags.json) {
      yield* line(formatJson({ valid: allIssues.length === 0, issues: allIssues }));
    } else if (allIssues.length === 0) {
      yield* line(
        `Valid: ${config.files.length} file${config.files.length === 1 ? "" : "s"}, ${parsed.reduce((count, entry) => count + entry.document.policies.length, 0)} policies.`,
      );
    } else {
      yield* line(formatPolicyIssues(allIssues));
    }

    if (allIssues.length > 0)
      return yield* Effect.fail(
        new CliFailure({
          message: "Policy document validation failed.",
          exitCode: 1,
          silent: true,
        }),
      );
  }),
).pipe(Command.withDescription("Validate portable policy documents without network access"));

export const policiesCommand = Command.make("policies").pipe(
  Command.withDescription("List, export, validate and apply policies"),
  Command.withSubcommands([list, get, exportCommand, apply, validate]),
);
