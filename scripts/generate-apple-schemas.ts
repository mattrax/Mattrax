import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "../node_modules/.pnpm/yaml@2.8.3/node_modules/yaml/dist/index.js";

const APPLE_REPO = "/tmp/apple-device-management";
const OUT_DIR = path.resolve(process.cwd(), "packages/policy-apple/src/generated");

// Ensure output directory exists
fs.mkdirSync(OUT_DIR, { recursive: true });

// Type definitions for Apple schema YAML
interface AppleSchemaFile {
  title?: string;
  description?: string;
  payload?: {
    payloadtype?: string;
    declarationtype?: string;
    requesttype?: string;
    supportedOS?: unknown;
  };
  payloadkeys?: ApplePayloadKey[];
}

interface ApplePayloadKey {
  key: string;
  title?: string;
  type?: string | string[];
  presence?: "required" | "optional";
  default?: unknown;
  content?: string;
  format?: string;
  range?: { min?: number; max?: number };
  rangelist?: Array<string | number | boolean>;
  subkeys?: ApplePayloadKey[];
  anyof?: ApplePayloadKey[];
  subkeytype?: string;
}

// Helpers for generating valid TypeScript identifiers
function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]/g, " ")
    .split(" ")
    .map((w) => (w[0]?.toUpperCase() ?? "") + w.slice(1).toLowerCase())
    .join("")
    .replace(/[^a-zA-Z0-9]/g, "");
}

function makeSchemaName(identifier: string): string {
  return identifier
    .split(".")
    .map((part) => toPascalCase(part))
    .join("")
    .replace(/[^a-zA-Z0-9]/g, "");
}

function escapeRegexForCode(regex: string): string {
  return regex.replace(/\\/g, "\\\\").replace(/\//g, "\\/");
}

function escapeStringForJs(str: string): string {
  return JSON.stringify(str);
}

function isString(value: string | number | boolean): value is string {
  return typeof value === "string";
}

function literalForJs(value: string | number | boolean): string {
  return isString(value) ? escapeStringForJs(value) : String(value);
}

function buildChecks(filters: string[]): string {
  if (filters.length === 0) return "";

  if (filters.length === 1) return `.pipe(Schema.check(${filters[0]}))`;

  return `.pipe(Schema.check(${filters.join(", ")}))`;
}

// Track circular references by object identity
class CircularRefTracker {
  private refs = new Map<ApplePayloadKey[], string>();
  private counter = 0;

  getRefId(subkeys: ApplePayloadKey[]): string | undefined {
    return this.refs.get(subkeys);
  }

  registerRef(subkeys: ApplePayloadKey[], suggestedName: string): string {
    const existing = this.refs.get(subkeys);

    if (existing) return existing;
    const id = suggestedName + (this.counter++ > 0 ? String(this.counter) : "");
    this.refs.set(subkeys, id);

    return id;
  }

  hasRefs(): boolean {
    return this.refs.size > 0;
  }
}

interface GenContext {
  tracker: CircularRefTracker;
  visited: Set<ApplePayloadKey[]>;
  indent: string;
}

function generateFieldSchema(key: ApplePayloadKey, parentKeyPath: string, ctx: GenContext): string {
  const isOptional = key.presence !== "required";
  let schema = generateTypeSchema(key, parentKeyPath + "." + key.key, ctx);

  if (isOptional) {
    schema = `Schema.optional(${schema})`;
  }

  return schema;
}

function generateTypeSchema(key: ApplePayloadKey, keyPath: string, ctx: GenContext): string {
  const types = Array.isArray(key.type) ? key.type : [key.type];
  const type = types[0] ?? "<string>";

  switch (type) {
    case "<boolean>": {
      return `Schema.Boolean`;
    }

    case "<string>": {
      if (key.rangelist && key.rangelist.length > 0) {
        const values = key.rangelist.map(literalForJs);

        if (values.length === 1) {
          return `Schema.Literal(${values[0]})`;
        }

        return `Schema.Literals([${values.join(", ")}])`;
      }

      if (key.format) {
        let regex = key.format;

        // Avoid double anchoring if the regex already has ^ and $
        if (regex.startsWith("^") && regex.endsWith("$")) {
          regex = regex.slice(1, -1);
        }

        const escaped = escapeRegexForCode(regex);

        return `Schema.String.pipe(Schema.check(Schema.isPattern(/^${escaped}$/)))`;
      }

      return `Schema.String`;
    }

    case "<integer>": {
      if (key.rangelist && key.rangelist.length > 0) {
        const values = key.rangelist.map(literalForJs);

        if (values.length === 1) {
          return `Schema.Literal(${values[0]})`;
        }

        return `Schema.Literals([${values.join(", ")}])`;
      }

      const filters: string[] = [];

      if (key.range?.min !== undefined) {
        filters.push(`Schema.isGreaterThanOrEqualTo(${key.range.min})`);
      }

      if (key.range?.max !== undefined) {
        filters.push(`Schema.isLessThanOrEqualTo(${key.range.max})`);
      }

      if (filters.length > 0) {
        return `Schema.Int${buildChecks(filters)}`;
      }

      return `Schema.Int`;
    }

    case "<real>": {
      const filters: string[] = [];

      if (key.range?.min !== undefined) {
        filters.push(`Schema.isGreaterThanOrEqualTo(${key.range.min})`);
      }

      if (key.range?.max !== undefined) {
        filters.push(`Schema.isLessThanOrEqualTo(${key.range.max})`);
      }

      if (filters.length > 0) {
        return `Schema.Number${buildChecks(filters)}`;
      }

      return `Schema.Number`;
    }

    case "<date>": {
      return `Schema.String`;
    }

    case "<data>": {
      return `Schema.String`;
    }

    case "<array>": {
      if (key.subkeys && key.subkeys.length > 0) {
        const firstSub = key.subkeys[0];

        if (firstSub.key && key.subkeys.length === 1) {
          const itemSchema = generateTypeSchema(firstSub, keyPath + "[]", ctx);

          return `Schema.Array(${itemSchema})`;
        }

        const objSchema = generateObjectSchema(key.subkeys, keyPath, ctx);

        return `Schema.Array(${objSchema})`;
      }

      return `Schema.Array(Schema.Unknown)`;
    }

    case "<dictionary>": {
      if (key.subkeys && key.subkeys.length > 0) {
        return generateObjectSchema(key.subkeys, keyPath, ctx);
      }

      return `Schema.Record(Schema.String, Schema.Unknown)`;
    }

    default: {
      if (type?.startsWith("<") && type?.endsWith(">")) {
        return `Schema.Unknown /* ${type} */`;
      }

      return `Schema.Unknown`;
    }
  }
}

function generateObjectSchema(
  subkeys: ApplePayloadKey[],
  keyPath: string,
  ctx: GenContext,
): string {
  // Check for circular reference
  if (ctx.visited.has(subkeys)) {
    const refId = ctx.tracker.getRefId(subkeys);

    if (refId) {
      return `Schema.suspend(() => ${refId})`;
    }

    // Register a new ref
    const suggestedName = makeSchemaName(keyPath.replace(/\./g, "_"));
    const id = ctx.tracker.registerRef(subkeys, suggestedName);

    return `Schema.suspend(() => ${id})`;
  }

  ctx.visited.add(subkeys);

  const childCtx: GenContext = { ...ctx, indent: ctx.indent + "  " };

  const fields = subkeys.map((sub) => {
    const fieldSchema = generateFieldSchema(sub, keyPath, childCtx);
    const keyName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(sub.key) ? sub.key : JSON.stringify(sub.key);

    return `${childCtx.indent}${keyName}: ${fieldSchema}`;
  });

  ctx.visited.delete(subkeys);

  if (fields.length === 0) {
    return `Schema.Record(Schema.String, Schema.Unknown)`;
  }

  return `Schema.Struct({\n${fields.join(",\n")}\n${ctx.indent}})`;
}

interface SchemaResult {
  name: string;
  code: string;
}

function generateSchemaFromFile(
  filePath: string,
  category: "declaration" | "profile" | "command" | "checkin",
): SchemaResult | null {
  const content = fs.readFileSync(filePath, "utf-8");
  const data: AppleSchemaFile = parse(content);

  if (!data.payloadkeys || data.payloadkeys.length === 0) {
    return null;
  }

  let identifier: string;

  if (category === "declaration") {
    identifier = data.payload?.declarationtype ?? path.basename(filePath, ".yaml");
  } else if (category === "profile") {
    identifier = data.payload?.payloadtype ?? path.basename(filePath, ".yaml");
  } else if (category === "command") {
    identifier = data.payload?.requesttype ?? path.basename(filePath, ".yaml");
  } else {
    identifier = data.payload?.requesttype ?? data.title ?? path.basename(filePath, ".yaml");
  }

  const schemaName = makeSchemaName(identifier);
  const title = data.title ?? schemaName;
  const description = data.description ?? "";

  const tracker = new CircularRefTracker();

  const ctx: GenContext = {
    tracker,
    visited: new Set(),
    indent: "  ",
  };

  const body = generateObjectSchema(data.payloadkeys, "", { ...ctx, indent: "" });

  // Generate helper type declarations for circular refs using function wrappers
  // to avoid TypeScript's implicit-any error on self-referencing consts.
  const helperDecls: string[] = [];

  if (tracker.hasRefs()) {
    for (const [subkeys, id] of tracker.refs) {
      const subCtx: GenContext = {
        tracker,
        visited: new Set(),
        indent: "  ",
      };

      const schemaCode = generateObjectSchema(subkeys, id, subCtx);
      helperDecls.push(
        `const make${id} = (): Schema.Schema<any> => ${schemaCode};\n` +
          `export const ${id} = make${id}();\n` +
          `export type ${id} = typeof ${id}.Type;`,
      );
    }
  }

  const helperCode = helperDecls.length > 0 ? helperDecls.join("\n\n") + "\n\n" : "";

  const code = `${helperCode}/**
 * ${escapeJsDoc(title)}
 * ${escapeJsDoc(description)}
 */
export const ${schemaName} = ${body};
export type ${schemaName} = typeof ${schemaName}.Type;
`;

  return { name: schemaName, code };
}

function escapeJsDoc(str: string): string {
  return str.replace(/\*\//g, "* /").replace(/\n/g, "\n * ");
}

// Generate in order: declarations, profiles, commands, checkin
// If a later category has conflicts with earlier ones, we rename them.
// But we need to know conflicts ahead of time. Let's do two passes.

function collectNames(
  category: "declaration" | "profile" | "command" | "checkin",
  sourceDir: string,
): string[] {
  const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".yaml"));
  const names: string[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(sourceDir, file), "utf-8");
    const data: AppleSchemaFile = parse(content);

    if (!data.payloadkeys || data.payloadkeys.length === 0) continue;
    let identifier: string;

    if (category === "declaration") {
      identifier = data.payload?.declarationtype ?? path.basename(file, ".yaml");
    } else if (category === "profile") {
      identifier = data.payload?.payloadtype ?? path.basename(file, ".yaml");
    } else if (category === "command") {
      identifier = data.payload?.requesttype ?? path.basename(file, ".yaml");
    } else {
      identifier = data.payload?.requesttype ?? data.title ?? path.basename(file, ".yaml");
    }

    names.push(makeSchemaName(identifier));
  }

  return names;
}

const declarationNames = new Set(
  collectNames("declaration", path.join(APPLE_REPO, "declarative/declarations/configurations")),
);

const profileNames = new Set(collectNames("profile", path.join(APPLE_REPO, "mdm/profiles")));
const commandNames = new Set(collectNames("command", path.join(APPLE_REPO, "mdm/commands")));
const checkinNames = new Set(collectNames("checkin", path.join(APPLE_REPO, "mdm/checkin")));

// Build rename map for cross-category conflicts.
// Priority: declarations > profiles > commands > checkin
// Lower priority categories get renamed when they conflict with higher priority ones.
const crossCategoryRenames = new Map<string, { name: string; category: string }>();

function addRenames(
  lowerNames: Set<string>,
  higherNames: Set<string>,
  lowerCategory: string,
  prefix: string,
) {
  for (const name of lowerNames) {
    if (higherNames.has(name)) {
      crossCategoryRenames.set(`${lowerCategory}:${name}`, prefix + name);
    }
  }
}

// Checkin gets renamed when conflicting with anything else
addRenames(checkinNames, commandNames, "checkin", "Checkin");

addRenames(checkinNames, declarationNames, "checkin", "Checkin");

addRenames(checkinNames, profileNames, "checkin", "Checkin");

// Commands get renamed when conflicting with declarations or profiles
addRenames(commandNames, declarationNames, "command", "Command");

addRenames(commandNames, profileNames, "command", "Command");

// Profiles get renamed when conflicting with declarations
addRenames(profileNames, declarationNames, "profile", "Profile");

// Now generate with renames
function generateCategoryFileWithRenames(
  category: "declaration" | "profile" | "command" | "checkin",
  sourceDir: string,
  outFileName: string,
) {
  const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".yaml"));
  const results: SchemaResult[] = [];
  const usedNames = new Set<string>();

  for (const file of files) {
    try {
      const result = generateSchemaFromFile(path.join(sourceDir, file), category);

      if (result) {
        // Apply cross-category rename if needed
        const renameKey = `${category}:${result.name}`;

        if (crossCategoryRenames.has(renameKey)) {
          const newName = crossCategoryRenames.get(renameKey)!;
          // Replace all occurrences of the old name in the code
          result.code = result.code.replace(new RegExp(`\\b${result.name}\\b`, "g"), newName);
          result.name = newName;
        }

        // Handle duplicate names within this file
        let uniqueName = result.name;
        let suffix = 1;

        while (usedNames.has(uniqueName)) {
          uniqueName = result.name + suffix;
          suffix++;
        }

        if (uniqueName !== result.name) {
          result.code = result.code.replace(new RegExp(`\\b${result.name}\\b`, "g"), uniqueName);
          result.name = uniqueName;
        }

        usedNames.add(result.name);
        results.push(result);
      }
    } catch (cause) {
      console.error(
        `Error processing ${file}:`,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }

  // Sort by name for deterministic output
  results.sort((a, b) => a.name.localeCompare(b.name));

  const header = `// Auto-generated from https://github.com/apple/device-management
// Do not edit manually.

import { Schema } from "effect";

`;

  const body = results.map((r) => r.code).join("\n");
  fs.writeFileSync(path.join(OUT_DIR, outFileName), header + body, "utf-8");
  console.log(`Generated ${outFileName} with ${results.length} schemas`);
}

generateCategoryFileWithRenames(
  "declaration",
  path.join(APPLE_REPO, "declarative/declarations/configurations"),
  "declarations.ts",
);

generateCategoryFileWithRenames(
  "profile",
  path.join(APPLE_REPO, "mdm/profiles"),
  "profiles.ts",
);

generateCategoryFileWithRenames(
  "command",
  path.join(APPLE_REPO, "mdm/commands"),
  "commands.ts",
);

generateCategoryFileWithRenames(
  "checkin",
  path.join(APPLE_REPO, "mdm/checkin"),
  "checkin.ts",
);

console.log("Done!");
