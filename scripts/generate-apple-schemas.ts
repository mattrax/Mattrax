import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";

const APPLE_REPO = "/tmp/apple-device-management";

/**
 * The generated declaration, profile, command and check-in schemas live in the
 * Apple protocol package: it is the only package that describes Apple's wire
 * format, and policy delivery already imports `supportedOS` from the same tree.
 */
const OUT_DIR = path.resolve(process.cwd(), "packages/dm-apple/src/generated");

/**
 * `supportedOS` metadata is emitted alongside the policy schemas because
 * policy delivery (management-backend-enterprise) must import it inside the
 * Worker, where the generated schema sources are not bundled.
 */
const SUPPORT_OUT_DIR = OUT_DIR;

// Ensure output directories exist
fs.mkdirSync(OUT_DIR, { recursive: true });

fs.mkdirSync(SUPPORT_OUT_DIR, { recursive: true });

// Type definitions for Apple schema YAML
interface AppleSupportedOsEntry {
  introduced?: string;
  deprecated?: string;
  removed?: string;
}

/** Apple's `supportedOS` block, keyed by OS family. */
type AppleSupportedOs = Record<string, AppleSupportedOsEntry | undefined>;

interface AppleSchemaFile {
  title?: string;
  description?: string;
  payload?: {
    payloadtype?: string;
    declarationtype?: string;
    requesttype?: string;
    supportedOS?: AppleSupportedOs;
  };
  payloadkeys?: ApplePayloadKey[];
  responsekeys?: ApplePayloadKey[];
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
  supportedOS?: AppleSupportedOs;
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

  entries(): IterableIterator<[ApplePayloadKey[], string]> {
    return this.refs.entries();
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
    for (const [subkeys, id] of tracker.entries()) {
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
const crossCategoryRenames = new Map<string, string>();

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

generateCategoryFileWithRenames("profile", path.join(APPLE_REPO, "mdm/profiles"), "profiles.ts");

generateCategoryFileWithRenames("command", path.join(APPLE_REPO, "mdm/commands"), "commands.ts");

generateCategoryFileWithRenames("checkin", path.join(APPLE_REPO, "mdm/checkin"), "checkin.ts");

// ─── Supported OS metadata ───────────────────────────────────────
//
// `payload.supportedOS` is the only machine-readable statement Apple makes
// about which OS versions accept a payload or declaration. Policy delivery
// needs it to filter a configuration out of a device's declarations, so it is
// emitted as data alongside the schemas rather than dropped.

const OS_FAMILIES = ["iOS", "iPadOS", "macOS", "tvOS", "visionOS", "watchOS"] as const;

type OsFamily = (typeof OS_FAMILIES)[number];

interface OsEntry {
  introduced?: string;
  deprecated?: string;
  removed?: string;
}

type SupportedOs = Partial<Record<OsFamily, OsEntry>>;

const normaliseSupportedOs = (value: AppleSupportedOs | undefined): SupportedOs | undefined => {
  if (!value) return undefined;

  const result: SupportedOs = {};

  for (const family of OS_FAMILIES) {
    const info = value[family];

    // `n/a` means the OS does not support the payload at all; recording it as a
    // version would make the delivery filter believe it is supported.
    if (!info?.introduced || info.introduced === "n/a") continue;

    const entry: OsEntry = { introduced: info.introduced };

    if (info.deprecated && info.deprecated !== "n/a") entry.deprecated = info.deprecated;

    if (info.removed && info.removed !== "n/a") entry.removed = info.removed;

    result[family] = entry;
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

const supportedOsEntries = new Map<string, SupportedOs>();

const collectSupportedOs = (identifier: string, filePath: string) => {
  const data: AppleSchemaFile = parse(fs.readFileSync(filePath, "utf-8"));
  const supported = normaliseSupportedOs(data.payload?.supportedOS);

  if (supported) supportedOsEntries.set(identifier, supported);
};

const collectSupportedOsDir = (dir: string, prefix: "payloadtype" | "declarationtype") => {
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".yaml"))) {
    const filePath = path.join(dir, file);
    const data: AppleSchemaFile = parse(fs.readFileSync(filePath, "utf-8"));

    const identifier =
      prefix === "payloadtype" ? data.payload?.payloadtype : data.payload?.declarationtype;

    if (identifier) collectSupportedOs(identifier, filePath);
  }
};

collectSupportedOsDir(path.join(APPLE_REPO, "mdm/profiles"), "payloadtype");

collectSupportedOsDir(
  path.join(APPLE_REPO, "declarative/declarations/configurations"),
  "declarationtype",
);

const declarativeProtocol = (() => {
  const data: AppleSchemaFile = parse(
    fs.readFileSync(path.join(APPLE_REPO, "mdm/commands/declarativemanagement.yaml"), "utf-8"),
  );

  return normaliseSupportedOs(data.payload?.supportedOS);
})();

const literalOs = (entry: OsEntry) => {
  const fields = [`introduced: ${JSON.stringify(entry.introduced)}`];

  if (entry.deprecated) fields.push(`deprecated: ${JSON.stringify(entry.deprecated)}`);

  if (entry.removed) fields.push(`removed: ${JSON.stringify(entry.removed)}`);

  return `{ ${fields.join(", ")} }`;
};

const supportedOsSource = `// Auto-generated from https://github.com/apple/device-management
// Do not edit manually. Regenerate with \`pnpm exec tsx scripts/generate-apple-schemas.ts\`.

/**
 * Per-OS version support for an Apple payload or declaration type, taken from
 * the schema's \`supportedOS\` block. An OS the payload does not support is
 * absent rather than mapped to a version.
 */
export type AppleSupportedOs = Partial<
  Record<
    "iOS" | "iPadOS" | "macOS" | "tvOS" | "visionOS" | "watchOS",
    { readonly introduced: string; readonly deprecated?: string; readonly removed?: string }
  >
>;

/** Keyed by \`payloadtype\` for profiles and \`declarationtype\` for declarations. */
export const APPLE_SUPPORTED_OS: Readonly<Record<string, AppleSupportedOs>> = {
${[...supportedOsEntries]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(
    ([identifier, supported]) =>
      `  ${JSON.stringify(identifier)}: {\n${OS_FAMILIES.flatMap((family) =>
        supported[family] ? [`    ${family}: ${literalOs(supported[family])},`] : [],
      ).join("\n")}\n  },`,
  )
  .join("\n")}
};

/**
 * OS versions that first support the Declarative Management engine
 * (\`DeclarativeManagement\` command). A device below these versions cannot apply
 * a declaration, so policy delivery must use legacy profiles instead.
 */
export const APPLE_DECLARATIVE_PROTOCOL_SUPPORT: AppleSupportedOs = {
${(declarativeProtocol ? OS_FAMILIES.filter((family) => declarativeProtocol[family]) : [])
  .map((family) => `  ${family}: ${literalOs(declarativeProtocol![family]!)},`)
  .join("\n")}
};
`;

fs.writeFileSync(path.join(SUPPORT_OUT_DIR, "supportedOs.ts"), supportedOsSource, "utf-8");

console.log(`Generated supportedOs.ts with ${supportedOsEntries.size} entries`);

/**
 * The policy designer shows the same range the delivery path enforces, so the
 * published metadata is also emitted as a static asset the dashboard loads.
 */
const WEB_CATALOG_DIR = path.resolve(process.cwd(), "apps/web/public/catalog");

fs.mkdirSync(WEB_CATALOG_DIR, { recursive: true });

fs.writeFileSync(
  path.join(WEB_CATALOG_DIR, "apple-supported-os.json"),
  `${JSON.stringify(
    {
      supportedOs: Object.fromEntries(
        [...supportedOsEntries].sort(([left], [right]) => left.localeCompare(right)),
      ),
    },
    null,
    2,
  )}\n`,
  "utf-8",
);

console.log("Generated apple-supported-os.json");

console.log("Done!");
