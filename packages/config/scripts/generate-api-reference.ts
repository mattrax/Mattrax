import { mkdir, rm, writeFile } from "node:fs/promises";
import { Schema } from "effect";
import { HttpApi, OpenApi } from "effect/http-api";
import {
  enterpriseAccountApi,
  enterpriseAdminApi,
  enterpriseAdeApi,
  enterpriseApi,
  enterpriseAttributeApi,
  enterpriseIdentityApi,
  enterpriseUserApi,
  enterpriseWindowsApi,
  fleetMigrationApi,
  scriptAgentApi,
  scriptApi,
} from "../../enterprise-domain/src/enterprise.ts";
import { managementApi } from "../../management-backend-http/src/http.ts";
import type { JsonSchema } from "effect/JsonSchema";

/**
 * Build the API reference from the live Effect `HttpApi` definitions. The
 * served OpenAPI document is generated from the same contracts, so an endpoint
 * cannot exist in one and be missing from the other. `docs/api/reference/` is
 * generated output and is not committed.
 *
 * TypeDoc was evaluated and cannot be used: the workspace compiles with
 * TypeScript 7, whose native compiler does not expose the JavaScript AST that
 * TypeDoc 0.28 requires. Rendering the contract directly also documents the
 * actual wire shape rather than TypeScript implementation types.
 */

const methodNames = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

type Document = ReturnType<typeof OpenApi.fromApi>;

type Operation = NonNullable<Document["paths"][string][(typeof methodNames)[number]]>;

type Parameter = Operation["parameters"][number];

const isString = Schema.is(Schema.String);

const isArray = Schema.is(Schema.Array(Schema.Unknown));

const isJsonArray = Schema.is(Schema.Array(Schema.Json));

const isRecord = Schema.is(Schema.Record(Schema.String, Schema.Unknown));

const restDocument = OpenApi.fromApi(
  HttpApi.make("Mattrax")
    .add(enterpriseAccountApi)
    .add(enterpriseAdminApi)
    .add(enterpriseApi)
    .add(enterpriseAdeApi)
    .add(enterpriseAttributeApi)
    .add(enterpriseIdentityApi)
    .add(enterpriseUserApi)
    .add(enterpriseWindowsApi)
    .add(fleetMigrationApi)
    .add(scriptApi)
    .add(scriptAgentApi),
);

const webhookDocument = OpenApi.fromApi(managementApi);

/** Escape text for a GFM table cell or prose line. */
const text = (value: string | undefined): string =>
  (value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ").trim();

const isJson = Schema.is(Schema.Json);

const literal = (value: Schema.Json): string => {
  if (isString(value)) return JSON.stringify(value);

  if (Schema.is(Schema.Number)(value) || Schema.is(Schema.Boolean)(value)) return String(value);

  if (value === null) return "null";

  return "value";
};

/** A compact human-readable type for a JSON Schema node. */
const schemaType = (schema: JsonSchema): string => {
  const reference = schema.$ref;

  if (isString(reference)) return `\`${reference.slice(reference.lastIndexOf("/") + 1)}\``;

  const variants = schema.anyOf ?? schema.oneOf;

  if (isArray(variants)) {
    const types = variants.filter(isRecord).map(schemaType);

    return types.length > 0 ? types.join(" \\| ") : "value";
  }

  const literalValues = schema.enum;

  if (isJsonArray(literalValues) && literalValues.length > 0)
    return literalValues.map(literal).join(" \\| ");

  if (isJson(schema.const)) return literal(schema.const);

  const type = schema.type;

  if (type === "array") {
    const items = schema.items;

    return isRecord(items) ? `${schemaType(items)}[]` : "value[]";
  }

  if (type === "object" || isRecord(schema.properties)) return "object";

  return isString(type) ? type : "value";
};

const propertyRows = (
  schema: JsonSchema,
): ReadonlyArray<{ name: string; type: string; required: boolean }> => {
  const properties = schema.properties;

  if (!isRecord(properties)) return [];
  const required = isArray(schema.required) ? schema.required.filter(isString) : [];

  return Object.entries(properties)
    .filter((entry): entry is [string, JsonSchema] => isRecord(entry[1]))
    .map(([name, value]) => ({
      name,
      type: schemaType(value),
      required: required.includes(name),
    }));
};

const schemaSection = (title: string, schema: JsonSchema | undefined): string[] => {
  if (!schema) return [];
  const rows = propertyRows(schema);

  if (rows.length === 0) return [`**${title}:** ${schemaType(schema)}`, ""];

  return [
    `**${title}:** ${schemaType(schema)}`,
    "",
    "| Property | Type | Required |",
    "| --- | --- | --- |",
    ...rows.map((row) => `| \`${row.name}\` | ${row.type} | ${row.required ? "yes" : "no"} |`),
    "",
  ];
};

const responseSchema = (operation: Operation, status: string): string => {
  const response = operation.responses[Number(status)];
  const schema = response?.content?.["application/json"]?.schema;

  return schema ? schemaType(schema) : text(response?.description) || "—";
};

const requestSchema = (operation: Operation): JsonSchema | undefined =>
  operation.requestBody?.content?.["application/json"]?.schema;

const parameterRows = (operation: Operation, pathParameters: ReadonlyArray<Parameter>) => {
  const parameters = [...pathParameters, ...operation.parameters];

  const rows = parameters.map((parameter) => {
    // SAFETY: OpenAPI parameter schemas are JSON Schema documents; the
    // library types the field as `object` because it cannot name the dialect.
    const schema = parameter.schema as JsonSchema;

    return `| \`${parameter.name}\` | ${parameter.in} | ${parameter.required ? "yes" : "no"} | ${schemaType(schema)} |`;
  });

  return rows.length === 0
    ? []
    : ["| Parameter | In | Required | Type |", "| --- | --- | --- | --- |", ...rows, ""];
};

const renderOperation = (
  method: string,
  path: string,
  operation: Operation,
  pathParameters: ReadonlyArray<Parameter>,
): string[] => {
  const lines = [
    `### \`${method.toUpperCase()} ${path}\``,
    "",
    `Operation: \`${operation.operationId}\``,
    "",
  ];

  if (operation.description) lines.push(text(operation.description), "");

  if (operation.deprecated) lines.push("> **Deprecated.**", "");

  lines.push(...parameterRows(operation, pathParameters));
  lines.push(...schemaSection("Request body", requestSchema(operation)));

  const statuses = Object.keys(operation.responses).sort(
    (left, right) => Number(left) - Number(right),
  );

  if (statuses.length > 0) {
    lines.push("| Status | Response |", "| --- | --- |");
    lines.push(...statuses.map((status) => `| ${status} | ${responseSchema(operation, status)} |`));
    lines.push("");
  }

  return lines;
};

const renderDocument = (document: Document, heading: string, intro: string): string[] => {
  const groups = new Map<string, string[]>();
  let operationCount = 0;

  for (const [path, item] of Object.entries(document.paths)) {
    const pathParameters = item.parameters ?? [];

    for (const method of methodNames) {
      const operation = item[method];

      if (!operation) continue;
      operationCount += 1;
      const tag = operation.tags[0] ?? "Endpoints";
      const lines = groups.get(tag) ?? [];

      lines.push(...renderOperation(method, path, operation, pathParameters));
      groups.set(tag, lines);
    }
  }

  const lines = [`# ${heading}`, "", intro, "", `**${operationCount} operations.**`, ""];

  for (const tag of [...groups.keys()].sort()) {
    lines.push(`## ${tag}`, "", ...groups.get(tag)!);
  }

  return lines;
};

const rest = renderDocument(
  restDocument,
  "REST API reference",
  "Generated from `packages/enterprise-domain` (the Effect `HttpApi` contract) on every docs build. Request and response shapes are the encoded forms the API actually sends. The machine-readable equivalent is served at [`/api/openapi.json`](/api/openapi).",
);

const webhooks = renderDocument(
  webhookDocument,
  "Management webhook reference",
  "Generated from `packages/management-backend-http`. These are the routes a customer management backend implements; Mattrax signs every request with `x-mattrax-timestamp` and `x-mattrax-signature`.",
);

const index = [
  "# API reference",
  "",
  "This section is generated from the Effect `HttpApi` contracts at build time, so it cannot drift from the code.",
  "",
  "- [REST API reference](/api/reference/rest) — every route in the `MattraxEnterprise`, account, ADE, attribute, identity, Windows and script groups.",
  "- [Management webhook reference](/api/reference/management) — the contract a customer management backend implements.",
  "- [OpenAPI document](/api/openapi) — the served, machine-readable specification.",
  "",
  `The REST contract currently exposes **${Object.keys(restDocument.paths).length} paths**; the management webhook contract exposes **${Object.keys(webhookDocument.paths).length}**.`,
  "",
];

const output = new URL("../../../docs/api/reference/", import.meta.url);

await rm(output, { recursive: true, force: true });

await mkdir(output, { recursive: true });

await Promise.all([
  writeFile(new URL("index.md", output), index.join("\n")),
  writeFile(new URL("rest.md", output), rest.join("\n")),
  writeFile(new URL("management.md", output), webhooks.join("\n")),
]);

console.log(
  `Generated API reference: ${Object.keys(restDocument.paths).length} REST paths, ${Object.keys(webhookDocument.paths).length} management paths`,
);
