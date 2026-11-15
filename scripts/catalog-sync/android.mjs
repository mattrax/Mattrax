import { cleanText, fetchJson, SourceError } from "./util.mjs";

const DISCOVERY = "https://androidmanagement.googleapis.com/$discovery/rest?version=v1";
const MAX_DEPTH = 5;

/** camelCase / snake_case → "Title Case" for a friendlier label. */
const humanize = (key) => {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const mapType = (schema) => {
  if (schema.format === "date-time") return "date";

  if (schema.format === "byte") return "data";

  switch (schema.type) {
    case "integer":
      return "integer";
    case "number":
      return "real";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    case "object":
      return "dictionary";
    case "string":
      return schema.enum?.length ? "enum" : "string";
    default:
      return "unknown";
  }
};

const enumValues = (schema) => {
  if (!schema.enum?.length) return undefined;

  return schema.enum.map((value, index) => ({
    value,
    description: cleanText(schema.enumDescriptions?.[index], 600) || undefined,
  }));
};

const itemEnum = (schema, ctx) => {
  const items = schema.items;

  if (!items) return undefined;

  const resolved = items.$ref ? ctx.schemas[items.$ref] : items;

  return resolved ? enumValues(resolved) : undefined;
};

const resolveChildren = (schema, path, ctx) => {
  if (ctx.depth > MAX_DEPTH) return undefined;

  if (schema.type === "object" && schema.properties) {
    return Object.entries(schema.properties).map(([key, child]) =>
      toProperty(key, child, path, { ...ctx, depth: ctx.depth + 1 }),
    );
  }

  if (schema.type === "array" && schema.items) {
    const itemRef = schema.items.$ref;

    if (itemRef) {
      if (ctx.seen.has(itemRef)) return undefined;

      const target = ctx.schemas[itemRef];

      if (!target?.properties) return undefined;

      const seen = new Set(ctx.seen).add(itemRef);

      return Object.entries(target.properties).map(([key, child]) =>
        toProperty(key, child, `${path}[0]`, { ...ctx, seen, depth: ctx.depth + 1 }),
      );
    }

    if (schema.items.type === "object" && schema.items.properties) {
      return Object.entries(schema.items.properties).map(([key, child]) =>
        toProperty(key, child, `${path}[0]`, { ...ctx, depth: ctx.depth + 1 }),
      );
    }
  }

  return undefined;
};

const toProperty = (key, schema, path, ctx) => {
  const resolved = schema.$ref ? ctx.schemas[schema.$ref] : schema;
  const combined = { ...resolved, ...schema, $ref: undefined };
  const type = mapType(combined);
  const nextPath = path ? `${path}.${key}` : key;
  const children = resolveChildren(combined, nextPath, ctx);

  return {
    key,
    name: humanize(key),
    type: children?.length && type === "array" ? "array" : type,
    description: cleanText(combined.description, 3000),
    deprecated: combined.deprecated || undefined,
    enum: enumValues(combined) ?? itemEnum(combined, ctx),
    address: nextPath,
    children,
  };
};

export const loadAndroid = async () => {
  const discovery = await fetchJson(DISCOVERY, "android/discovery");
  const policy = discovery.schemas?.Policy;

  if (!policy?.properties) {
    throw new SourceError(DISCOVERY, "Policy schema missing from discovery document");
  }

  const ctx = { schemas: discovery.schemas, seen: new Set(), depth: 0 };

  const properties = Object.entries(policy.properties).map(([key, schema]) =>
    toProperty(key, schema, "", ctx),
  );

  const collection = {
    id: "android/policy/Policy",
    platform: "android",
    kind: "policy",
    surface: "policy",
    identifier: "Policy",
    name: "Policy",
    description:
      cleanText(policy.description, 2000) ||
      "The Android Management API Policy resource. Applied to an enterprise through enterprises.policies.patch.",
    properties,
    source:
      "https://developers.google.com/android/management/reference/rest/v1/enterprises.policies",
  };

  return { collections: [collection], revision: discovery.revision };
};
