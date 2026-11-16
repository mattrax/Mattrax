import type { Collection, Property, PropertyEnumValue, PropertyType } from "./catalog.ts";
import { cleanText, fetchJson, SourceError } from "./util.ts";

const DISCOVERY = "https://androidmanagement.googleapis.com/$discovery/rest?version=v1";
const MAX_DEPTH = 5;

/** One entry in Google's discovery document `schemas` map. */
interface AndroidSchema {
  $ref?: string;
  type?: string;
  format?: string;
  description?: string;
  deprecated?: boolean;
  enum?: string[];
  enumDescriptions?: string[];
  properties?: Record<string, AndroidSchema>;
  items?: AndroidSchema;
}

interface DiscoveryDocument {
  revision?: string;
  schemas?: Record<string, AndroidSchema>;
}

interface Context {
  schemas: Record<string, AndroidSchema>;
  seen: Set<string>;
  depth: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Google's discovery document is generated from the API's protos and is the
 * canonical description of every schema in it, so the declared `AndroidSchema`
 * shape is trusted once the top-level document is known to be an object.
 */
const parseDiscovery = (value: unknown): DiscoveryDocument => {
  if (!isRecord(value)) throw new SourceError(DISCOVERY, "invalid discovery document");

  // SAFETY: Google's discovery document declares each schema inline, so the
  // record check on `schemas` is the guard for the map indexed above.
  const schemas = isRecord(value.schemas)
    ? (value.schemas as Record<string, AndroidSchema>)
    : undefined;

  return {
    revision: typeof value.revision === "string" ? value.revision : undefined,
    schemas,
  };
};

/** camelCase / snake_case → "Title Case" for a friendlier label. */
const humanize = (key: string): string => {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const mapType = (schema: AndroidSchema): PropertyType => {
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

const enumValues = (schema: AndroidSchema): PropertyEnumValue[] | undefined => {
  if (!schema.enum?.length) return undefined;

  return schema.enum.map((value, index) => ({
    value,
    description: cleanText(schema.enumDescriptions?.[index], 600) || undefined,
  }));
};

const itemEnum = (schema: AndroidSchema, ctx: Context): PropertyEnumValue[] | undefined => {
  const items = schema.items;

  if (!items) return undefined;

  const resolved = items.$ref ? ctx.schemas[items.$ref] : items;

  return resolved ? enumValues(resolved) : undefined;
};

const resolveChildren = (
  schema: AndroidSchema,
  path: string,
  ctx: Context,
): Property[] | undefined => {
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

const toProperty = (key: string, schema: AndroidSchema, path: string, ctx: Context): Property => {
  const resolved = schema.$ref ? ctx.schemas[schema.$ref] : schema;
  const combined: AndroidSchema = { ...resolved, ...schema, $ref: undefined };
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

export const loadAndroid = async (): Promise<{
  collections: Collection[];
  revision: string | undefined;
}> => {
  const discovery = parseDiscovery(await fetchJson(DISCOVERY, "android/discovery"));
  const policy = discovery.schemas?.Policy;

  if (!policy?.properties) {
    throw new SourceError(DISCOVERY, "Policy schema missing from discovery document");
  }

  const ctx: Context = {
    schemas: discovery.schemas ?? {},
    seen: new Set(),
    depth: 0,
  };

  const properties = Object.entries(policy.properties).map(([key, schema]) =>
    toProperty(key, schema, "", ctx),
  );

  const collection: Collection = {
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
