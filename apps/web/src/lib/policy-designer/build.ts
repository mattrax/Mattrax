import { Option, Schema } from "effect";
import {
  collectionProperties,
  Property as PropertySchema,
  type Collection,
  type PlatformId,
  type Property,
} from "./catalog";
import { buildZip } from "./zip";

/** A JSON value stored in a policy draft. */
export type PolicyValue = Schema.Json;

export type PolicyValueMap = Record<string, PolicyValue | undefined>;

export type SelectionTemplate = {
  readonly provider: "thirdparty-app";
  readonly appId: string;
  readonly bundleId?: string;
  readonly packageName?: string;
  readonly installType?: string;
};

export type Selection = {
  collectionId: string;
  identifier: string;
  kind: Collection["kind"];
  surface: string;
  name: string;
  properties: ReadonlyArray<Property>;
  values: Readonly<Record<string, PolicyValue | undefined>>;
  /** Set when the selection comes from the third-party application catalogue. */
  template?: SelectionTemplate;
};

export type Draft = {
  version: 1;
  platform: PlatformId;
  name: string;
  selections: Selection[];
  /** Set when a draft is persisted so the newest draft wins on rehydration. */
  savedAt?: number;
};

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/** Marks a string that is already base64 and should become `<data>`. */
class PlistData {
  readonly base64: string;

  constructor(base64: string) {
    this.base64 = base64;
  }
}

const plistData = (value: string) => new PlistData(value);

export type PlistValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | Date
  | PlistData
  | readonly PlistValue[]
  | { readonly [key: string]: PlistValue };

const isString = Schema.is(Schema.String);

const isBoolean = Schema.is(Schema.Boolean);

const isNumber = Schema.is(Schema.Number);

const isJsonObject = Schema.is(Schema.JsonObject);

const isPlistData = (value: PlistValue): value is PlistData => value instanceof PlistData;

const isPlistObject = (value: PlistValue): value is { readonly [key: string]: PlistValue } =>
  typeof value === "object" &&
  value !== null &&
  !(value instanceof Date) &&
  !(value instanceof PlistData) &&
  !Array.isArray(value);

const plistValue = (value: PlistValue): string => {
  if (value === null || value === undefined) return "<string></string>";

  if (isPlistData(value)) return `<data>${escapeXml(value.base64.replace(/\s/g, ""))}</data>`;

  if (isBoolean(value)) return value ? "<true/>" : "<false/>";

  if (isNumber(value))
    return Number.isInteger(value) ? `<integer>${value}</integer>` : `<real>${value}</real>`;

  if (value instanceof Date) return `<date>${value.toISOString().replace(/\.\d{3}Z$/, "Z")}</date>`;

  if (isString(value)) return `<string>${escapeXml(value)}</string>`;

  if (Array.isArray(value))
    return `<array>${value.map((item) => plistValue(item)).join("")}</array>`;

  if (isPlistObject(value))
    return `<dict>${Object.entries(value)
      .filter(([, item]) => item !== undefined && item !== null)
      .map(([key, item]) => `<key>${escapeXml(key)}</key>${plistValue(item)}`)
      .join("")}</dict>`;

  return `<string>${escapeXml(String(value))}</string>`;
};

export const serializePlist = (value: PlistValue) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${plistValue(value)}</plist>`;

const uuid = () => crypto.randomUUID();

const identifierSafe = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "-");

/** Windows vector/CSP settings are identified by OMA-URI, not just the key. */
export const valueKey = (property: Property, platform: PlatformId) =>
  platform === "windows" ? (property.address ?? property.key) : property.key;

const isEnvelope = (property: Property) => property.category === "Envelope";

const isPlistDataProperty = (property: Property) => property.type === "data";

const isPlistDateProperty = (property: Property) => property.type === "date";

/** Payload fields, without generated declaration envelope fields or unset values. */
const payloadValues = (selection: Selection) => {
  const envelope = new Set(selection.properties.filter(isEnvelope).map((property) => property.key));
  const values: PolicyValueMap = {};

  for (const [key, value] of Object.entries(selection.values)) {
    if (value === undefined || value === null || envelope.has(key)) continue;

    values[key] = value;
  }

  return values;
};

/**
 * Some catalogue entries declare a scalar default for a structured setting
 * (for example `0` on an array). Treat those as "no default" rather than
 * seeding a draft with a value that cannot be serialized.
 */
const enumDomainKind = (property: Property): "boolean" | "number" | "string" => {
  const values = property.enum?.map((option) => option.value) ?? [];

  if (values.length > 0 && values.every((value) => value === "true" || value === "false"))
    return "boolean";

  if (
    values.length > 0 &&
    values.every((value) => value.trim() !== "" && Number.isFinite(Number(value)))
  )
    return "number";

  return "string";
};

/** Normalise an enum default to the type the control will store. */
const coerceEnumValue = (property: Property, value: PolicyValue): PolicyValue => {
  if (!property.enum) return value;
  const kind = enumDomainKind(property);

  if (kind === "boolean") {
    if (value === true || value === "true") return true;

    if (value === false || value === "false") return false;

    return value;
  }

  if (kind === "number") {
    const number = isNumber(value) ? value : Number(value);

    return Number.isFinite(number) ? number : value;
  }

  return value;
};

export const catalogDefault = (property: Property): PolicyValue | undefined => {
  const value = property.defaultValue;

  if (value === undefined || value === null) return undefined;

  if (property.enum) return coerceEnumValue(property, value);

  switch (property.type) {
    case "array":
      return Array.isArray(value) ? value : undefined;
    case "dictionary":
      return isPlainObject(value) ? value : undefined;
    case "data":
      return isString(value) ? value : undefined;
    case "boolean":
      return property.enum || isBoolean(value) ? value : undefined;
    case "integer":
    case "real": {
      if (property.enum) return value;
      const number = isNumber(value) ? value : Number(value);

      return Number.isFinite(number) ? number : undefined;
    }

    default:
      return value;
  }
};

export const defaultValues = (collection: Collection) => {
  const values: PolicyValueMap = {};

  for (const property of collectionProperties(collection)) {
    if (isEnvelope(property)) continue;

    const value = catalogDefault(property);

    if (value === undefined) continue;

    values[valueKey(property, collection.platform)] = value;
  }

  return values;
};

/**
 * Compare drafts and catalogue defaults without depending on object key order.
 * Dates are normalized because date properties round-trip through JSON strings.
 */
export const sameValue = (
  left: PolicyValue | undefined,
  right: PolicyValue | undefined,
): boolean => {
  const normalize = (value: PolicyValue | undefined): string => {
    if (Array.isArray(value)) return `[${value.map(normalize).join(",")}]`;

    if (isPlainObject(value))
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${normalize(value[key])}`)
        .join(",")}}`;

    return JSON.stringify(value) ?? "undefined";
  };

  return normalize(left) === normalize(right);
};

/** A value is configured when the payload will contain it. */
export const isConfiguredValue = (value: PolicyValue | undefined) =>
  value !== undefined && value !== null;

/** A value is changed when it differs from the catalogue default (including unset). */
export const isChangedValue = (property: Property, value: PolicyValue | undefined) =>
  !sameValue(value, catalogDefault(property));

export type ValidationSeverity = "error" | "warning";

export type ValidationIssue = {
  readonly severity: ValidationSeverity;
  readonly collectionId: string;
  readonly collectionName: string;
  readonly propertyKey: string;
  readonly propertyName: string;
  readonly message: string;
};

function isPlainObject(value: PolicyValue | undefined): value is Schema.JsonObject {
  return isJsonObject(value) && !Array.isArray(value);
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Validate a draft before it is saved or exported. Missing required values are
 * warnings: shipped baselines intentionally leave some required envelope
 * values to the platform at apply time. Structurally invalid values are errors
 * and block the action because they cannot be serialized safely.
 */
export const validateDraft = (draft: Draft): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  for (const selection of draft.selections) {
    for (const property of collectionProperties(selection)) {
      if (isEnvelope(property)) continue;
      const key = valueKey(property, draft.platform);
      const value = selection.values[key];

      const add = (severity: ValidationSeverity, message: string) =>
        issues.push({
          severity,
          collectionId: selection.collectionId,
          collectionName: selection.name,
          propertyKey: key,
          propertyName: property.name,
          message,
        });

      if (value === undefined || value === null || value === "") {
        if (property.required) add("warning", "Required value is missing.");
        continue;
      }

      // Catalogue defaults are not user input. Some ship below `min` or in a
      // looser JSON type than the control stores; do not block a policy the
      // user never edited.
      if (sameValue(value, catalogDefault(property))) continue;

      const enumProperty = Boolean(property.enum);

      if (property.type === "array") {
        if (!Array.isArray(value)) add("error", "Expected a list of values.");
        continue;
      }

      if (property.type === "dictionary") {
        if (!isPlainObject(value)) add("error", "Expected a dictionary (JSON object).");
        continue;
      }

      if (property.type === "data") {
        if (!isString(value)) {
          add("error", "Expected a base64-encoded string.");
        } else if (value.trim() !== "" && !BASE64.test(value.replace(/\s/g, ""))) {
          add("warning", "This value does not look like base64 data.");
        }

        continue;
      }

      if (property.type === "boolean" && !enumProperty) {
        if (!isBoolean(value)) add("error", "Expected On or Off.");
        continue;
      }

      if ((property.type === "integer" || property.type === "real") && !enumProperty) {
        const number = isNumber(value) ? value : Number(value);

        if (!Number.isFinite(number)) {
          add("error", `Expected a ${property.type === "integer" ? "whole number" : "number"}.`);
          continue;
        }

        if (property.min !== undefined && number < property.min)
          add("error", `Must be at least ${property.min}.`);
        else if (property.max !== undefined && number > property.max)
          add("error", `Must be at most ${property.max}.`);
        continue;
      }

      if (property.type === "string" && property.pattern && isString(value)) {
        try {
          if (!new RegExp(property.pattern).test(value))
            add("error", `Does not match the required format (${property.pattern}).`);
        } catch {
          // A malformed catalogue pattern is not the user's problem.
        }
      }
    }
  }

  if (
    draft.platform === "windows" &&
    draft.selections.length > 0 &&
    buildWindowsNodes(draft).length === 0
  ) {
    const first = draft.selections[0]!;
    issues.push({
      severity: "error",
      collectionId: first.collectionId,
      collectionName: first.name,
      propertyKey: "",
      propertyName: first.name,
      message: "This collection has no applicable Windows settings; add a setting or remove it.",
    });
  }

  return issues;
};

const applePayloadValues = (selection: Selection) => {
  const values: Record<string, PlistValue> = {};

  for (const [key, value] of Object.entries(payloadValues(selection))) {
    if (value !== undefined) values[key] = value;
  }

  for (const property of selection.properties) {
    const value = values[property.key];

    if (value === undefined) continue;

    if (isPlistDataProperty(property) && isString(value)) values[property.key] = plistData(value);

    if (isPlistDateProperty(property) && isString(value)) {
      const date = new Date(value);
      values[property.key] = Number.isNaN(date.getTime()) ? value : date;
    }
  }

  return values;
};

export const buildAppleProfile = (draft: Draft) => {
  const payloads = draft.selections
    .filter((selection) => selection.kind === "profile")
    .map((selection) => {
      const values = applePayloadValues(selection);
      const template = selection.template;

      if (template?.provider === "thirdparty-app" && template.bundleId) {
        return {
          PayloadType: "com.apple.ManagedClient.preferences",
          PayloadIdentifier: `app.mattrax.apps.${identifierSafe(template.appId)}`,
          PayloadUUID: uuid(),
          PayloadVersion: 1,
          PayloadContent: {
            [template.bundleId]: {
              Forced: [{ mcx_preference_settings: values }],
            },
          },
        };
      }

      return {
        ...values,
        PayloadType: selection.identifier,
        PayloadIdentifier:
          values.PayloadIdentifier ??
          `app.mattrax.designer.${identifierSafe(selection.identifier)}`,
        PayloadUUID: values.PayloadUUID ?? uuid(),
        PayloadVersion: values.PayloadVersion ?? 1,
      };
    });

  return {
    PayloadContent: payloads,
    PayloadDisplayName: draft.name || "Mattrax policy",
    PayloadIdentifier: `app.mattrax.designer.${identifierSafe(draft.name || "policy")}`,
    PayloadOrganization: "Mattrax",
    PayloadType: "Configuration",
    PayloadUUID: uuid(),
    PayloadVersion: 1,
  };
};

export const buildMobileconfig = (draft: Draft) => serializePlist(buildAppleProfile(draft));

export const buildDeclarations = (draft: Draft) =>
  draft.selections
    .filter((selection) => selection.kind === "declaration")
    .map((selection) => {
      const values = payloadValues(selection);
      const explicit = values.Payload;

      return {
        Type: selection.identifier,
        Identifier: `com.mattrax.designer.${identifierSafe(selection.identifier)}`,
        ServerToken: crypto.randomUUID(),
        Payload: isPlainObject(explicit) ? explicit : values,
      };
    });

/** Older drafts stored enum defaults as strings; normalise before SyncML. */
const normalizeEnumValue = (property: Property, value: PolicyValue): PolicyValue => {
  if (!property.enum) return value;
  const kind = enumDomainKind(property);

  if (kind === "boolean") {
    if (value === true || value === "true") return true;

    if (value === false || value === "false") return false;

    return value;
  }

  if (kind === "number") {
    const number = isNumber(value) ? value : Number(value);

    return Number.isFinite(number) ? number : value;
  }

  return value;
};

const windowsFormat = (property: Property, value: PolicyValue) => {
  if (isBoolean(value)) return "int";

  if (isNumber(value)) return Number.isInteger(value) ? "int" : "chr";

  if (property.type === "integer" || property.type === "boolean") return "int";

  if (property.enum && enumDomainKind(property) !== "string") return "int";

  if (property.type === "data") return "b64";

  return "chr";
};

/** SyncML booleans are 1/0, not JSON booleans. */
const syncmlData = (value: PolicyValue) => {
  if (value === null || value === undefined) return "";

  if (isBoolean(value)) return value ? "1" : "0";

  if (isJsonObject(value) || Array.isArray(value)) return JSON.stringify(value);

  return String(value);
};

export type WindowNode = {
  readonly omaUri: string;
  readonly value: PolicyValue;
  readonly format: string;
  /**
   * Minimum Windows build the setting supports (from the catalogue). Delivery
   * skips a node the device's build predates, so the designer label is honoured.
   */
  readonly minOs?: string;
};

/** `WindowNode` while it is being assembled. */
type MutableWindowNode = { -readonly [K in keyof WindowNode]: WindowNode[K] };

export const buildWindowsNodes = (draft: Draft): WindowNode[] => {
  const nodes = new Map<string, WindowNode>();

  for (const selection of draft.selections) {
    for (const property of collectionProperties(selection)) {
      const rawValue = selection.values[valueKey(property, "windows")];

      if (rawValue === undefined || rawValue === null) continue;
      const value = normalizeEnumValue(property, rawValue);

      const omaUri =
        property.address ??
        `./Device/Vendor/MSFT/Policy/Config/${selection.identifier}/${property.key}`;

      if (/[{}]/.test(omaUri)) continue;

      const minimum = property.minOs?.replace(/\+$/, "");

      const node: MutableWindowNode = {
        omaUri,
        value,
        format: windowsFormat(property, value),
      };

      if (minimum) node.minOs = minimum;

      nodes.set(omaUri, node);
    }
  }

  return [...nodes.values()];
};

export const buildSyncML = (draft: Draft) => {
  const nodes = buildWindowsNodes(draft);

  const commands = nodes
    .map(
      (node, index) => `    <Replace>
      <CmdID>${index + 2}</CmdID>
      <Item>
        <Target><LocURI>${escapeXml(node.omaUri)}</LocURI></Target>
        <Meta><Format xmlns="syncml:metinf">${node.format}</Format><Type xmlns="syncml:metinf">text/plain</Type></Meta>
        <Data>${escapeXml(syncmlData(node.value))}</Data>
      </Item>
    </Replace>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<SyncML xmlns="SYNCML:SYNCML1.2">
  <SyncHdr>
    <VerDTD>1.2</VerDTD>
    <VerProto>DM/1.2</VerProto>
    <SessionID>1</SessionID>
    <MsgID>1</MsgID>
    <Target><LocURI>${escapeXml(draft.name || "Mattrax")}</LocURI></Target>
    <Source><LocURI>Mattrax</LocURI></Source>
  </SyncHdr>
  <SyncBody>
${commands}
    <Final/>
  </SyncBody>
</SyncML>`;
};

export const buildAndroidPolicy = (draft: Draft) => {
  const policy: PolicyValueMap = {};

  type AndroidApplicationEntry = {
    readonly packageName: string;
    readonly installType: string;
    readonly autoUpdateMode: string;
    readonly managedConfiguration?: Record<string, Schema.Json>;
  };

  type MutableAndroidApplicationEntry = {
    -readonly [K in keyof AndroidApplicationEntry]: AndroidApplicationEntry[K];
  };

  const applications: AndroidApplicationEntry[] = [];

  for (const selection of draft.selections) {
    const template = selection.template;

    if (
      template?.provider === "thirdparty-app" &&
      template.packageName &&
      selection.kind === "policy"
    ) {
      const managedConfiguration: Record<string, Schema.Json> = {};

      for (const [key, value] of Object.entries(payloadValues(selection)))
        if (value !== undefined) managedConfiguration[key] = value;

      const application: MutableAndroidApplicationEntry = {
        packageName: template.packageName,
        // The policy editor's default for an assigned app: install it and keep
        // it updated, while every catalogue field stays optional.
        installType: template.installType ?? "FORCE_INSTALLED",
        autoUpdateMode: "AUTO_UPDATE_DEFAULT",
      };

      if (Object.keys(managedConfiguration).length > 0)
        application.managedConfiguration = managedConfiguration;

      applications.push(application);
      continue;
    }

    for (const [key, value] of Object.entries(payloadValues(selection))) {
      if (value !== undefined) policy[key] = value;
    }
  }

  if (applications.length > 0) {
    const existing = Array.isArray(policy.applications)
      ? policy.applications.filter((entry) => Schema.is(Schema.JsonObject)(entry))
      : [];

    const packages = new Set(
      existing.flatMap((entry) => {
        const packageName = entry.packageName;

        return Schema.is(Schema.String)(packageName) ? [packageName] : [];
      }),
    );

    policy.applications = [
      ...existing,
      ...applications.filter((application) => {
        if (packages.has(application.packageName)) return false;
        packages.add(application.packageName);

        return true;
      }),
    ];
  }

  // These are read-only Google resource fields, not policy settings.
  delete policy.name;
  delete policy.version;

  return policy;
};

export type ExportArtifact = {
  readonly fileName: string;
  readonly contentType: string;
  readonly content: string;
  readonly kind: "mobileconfig" | "declarations" | "apple-bundle" | "syncml" | "android-policy";
};

export const buildArtifact = (draft: Draft): ExportArtifact => {
  if (draft.platform === "apple") {
    const declarations = buildDeclarations(draft);
    const profiles = draft.selections.filter((selection) => selection.kind === "profile");

    if (declarations.length > 0 && profiles.length > 0)
      return {
        fileName: `${identifierSafe(draft.name || "policy")}-bundle.json`,
        contentType: "application/json",
        content: JSON.stringify({ profile: buildMobileconfig(draft), declarations }, null, 2),
        kind: "apple-bundle",
      };

    if (declarations.length > 0)
      return {
        fileName: `${identifierSafe(draft.name || "policy")}.json`,
        contentType: "application/json",
        content: JSON.stringify(declarations, null, 2),
        kind: "declarations",
      };

    return {
      fileName: `${identifierSafe(draft.name || "policy")}.mobileconfig`,
      contentType: "application/x-apple-aspen-config",
      content: buildMobileconfig(draft),
      kind: "mobileconfig",
    };
  }

  if (draft.platform === "windows")
    return {
      fileName: `${identifierSafe(draft.name || "policy")}.syncml.xml`,
      contentType: "application/xml",
      content: buildSyncML(draft),
      kind: "syncml",
    };

  return {
    fileName: `${identifierSafe(draft.name || "policy")}.json`,
    contentType: "application/json",
    content: JSON.stringify(buildAndroidPolicy(draft), null, 2),
    kind: "android-policy",
  };
};

/** FNV-1a keeps declaration configuration kinds stable and alphanumeric. */
const stableId = (value: string) => {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
};

const declarationConfigKind = (identifier: string, index: number) =>
  `mttx.apple.declaration.d${stableId(`${identifier}:${index}`)}`;

export type AppleProfileConfiguration = {
  readonly content: string;
  readonly draft: Draft;
};

export type AppleDeclarationConfiguration = {
  readonly kind: string;
  readonly configuration: PolicyValueMap;
  readonly designer: true;
  readonly draft?: Draft;
};

export type WindowsDesignerConfiguration = {
  readonly nodes: readonly WindowNode[];
  readonly draft: Draft;
};

export type AndroidDesignerConfiguration = {
  readonly policy: PolicyValueMap;
  readonly draft: Draft;
};

export type PolicyConfiguration =
  | PolicyValue
  | PolicyValueMap
  | AppleProfileConfiguration
  | AppleDeclarationConfiguration
  | WindowsDesignerConfiguration
  | AndroidDesignerConfiguration;

export type PolicyConfigurations = Record<string, PolicyConfiguration | undefined>;

export const artifactToConfigurations = (draft: Draft) => {
  if (draft.platform === "apple") {
    const profiles = draft.selections.filter((selection) => selection.kind === "profile");
    const declarations = draft.selections.filter((selection) => selection.kind === "declaration");
    const configurations: PolicyConfigurations = {};
    const draftWithTime: Draft = { ...draft, savedAt: draft.savedAt ?? Date.now() };

    if (profiles.length > 0) {
      const content = buildMobileconfig(draft);
      const bytes = new TextEncoder().encode(content);
      let binary = "";

      for (const byte of bytes) binary += String.fromCharCode(byte);
      configurations["mttx.apple.custom.designer"] = {
        content: btoa(binary),
        draft: draftWithTime,
      };
    }

    const declarationCounts = new Map<string, number>();
    declarations.forEach((selection, index) => {
      // Key by identifier, not array position: reordering or removing one
      // declaration must not rename every other configuration.
      const duplicate = declarationCounts.get(selection.identifier) ?? 0;
      declarationCounts.set(selection.identifier, duplicate + 1);

      const base = {
        kind: selection.identifier,
        configuration: payloadValues(selection),
        designer: true,
      } satisfies Omit<AppleDeclarationConfiguration, "draft">;

      const configuration: AppleDeclarationConfiguration =
        profiles.length === 0 && index === 0 ? { ...base, draft: draftWithTime } : base;

      configurations[declarationConfigKind(selection.identifier, duplicate)] = configuration;
    });

    return configurations;
  }

  if (draft.platform === "windows") {
    return {
      "mttx.windows.custom.designer": {
        nodes: buildWindowsNodes(draft),
        draft: { ...draft, savedAt: draft.savedAt ?? Date.now() },
      },
    };
  }

  if (draft.platform === "android") {
    return {
      "mttx.android.policy.designer": {
        policy: buildAndroidPolicy(draft),
        draft: { ...draft, savedAt: draft.savedAt ?? Date.now() },
      },
    };
  }

  return {};
};

/**
 * A policy can target several operating systems at once. The v1 draft only
 * carried one platform; v2 keeps a selection list per platform so switching
 * tabs never discards work and one export can bundle every artifact.
 */
export type PolicyDraft = {
  version: 2;
  name: string;
  platforms: Partial<Record<PlatformId, Selection[]>>;
  savedAt?: number;
};

export const PLATFORM_ORDER: PlatformId[] = ["apple", "windows", "android"];

export const emptyPolicyDraft = (name = "My policy"): PolicyDraft => ({
  version: 2,
  name,
  platforms: { apple: [], windows: [], android: [] },
});

const SelectionSchema = Schema.Struct({
  collectionId: Schema.String,
  identifier: Schema.String,
  kind: Schema.Literals(["profile", "declaration", "policy", "csp"]),
  surface: Schema.String,
  name: Schema.String,
  properties: Schema.Array(PropertySchema),
  values: Schema.Record(Schema.String, Schema.Json),
  template: Schema.optional(
    Schema.Struct({
      provider: Schema.Literal("thirdparty-app"),
      appId: Schema.String,
      bundleId: Schema.optional(Schema.String),
      packageName: Schema.optional(Schema.String),
      installType: Schema.optional(Schema.String),
    }),
  ),
});

const decodeJson = Schema.decodeUnknownOption(Schema.Json);

const decodeSelection = Schema.decodeUnknownOption(SelectionSchema);

const parseJson = (value: string): Schema.Json | undefined => {
  try {
    return Option.getOrUndefined(decodeJson(JSON.parse(value)));
  } catch {
    return undefined;
  }
};

const selectionsOf = (value: Schema.Json | readonly Selection[] | undefined): Selection[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const selection = Option.getOrUndefined(decodeSelection(item));

    return selection === undefined ? [] : [selection];
  });
};

/**
 * Accept both the persisted v1 draft (one platform) and the multi-platform v2
 * draft. Anything that cannot be trusted is ignored rather than half-loaded.
 */
export const parsePolicyDraft = (
  source: string | Schema.Json | Draft | PolicyDraft | null | undefined,
): PolicyDraft | undefined => {
  if (source === null || source === undefined) return undefined;
  const parsed = isString(source) ? parseJson(source) : source;

  if (!isJsonObject(parsed)) return undefined;
  const name = isString(parsed.name) ? parsed.name : "My policy";
  const savedAt = isNumber(parsed.savedAt) ? parsed.savedAt : undefined;

  if (parsed.version === 1) {
    const platform = parsed.platform;

    if (platform !== "apple" && platform !== "windows" && platform !== "android") return undefined;

    const platforms: Partial<Record<PlatformId, Selection[]>> = {
      [platform]: selectionsOf(parsed.selections),
    };

    const result: PolicyDraft = { version: 2, name, platforms };

    if (savedAt !== undefined) result.savedAt = savedAt;

    return result;
  }

  if (parsed.version !== 2 || !isJsonObject(parsed.platforms)) return undefined;

  const platforms: Partial<Record<PlatformId, Selection[]>> = {};

  for (const platform of PLATFORM_ORDER) {
    const selections = parsed.platforms[platform];

    if (Array.isArray(selections)) platforms[platform] = selectionsOf(selections);
  }

  const result: PolicyDraft = { version: 2, name, platforms };

  if (savedAt !== undefined) result.savedAt = savedAt;

  return result;
};

export const policyPlatforms = (policy: PolicyDraft): PlatformId[] =>
  PLATFORM_ORDER.filter((platform) => (policy.platforms[platform]?.length ?? 0) > 0);

export const policySelectionCount = (policy: PolicyDraft) =>
  PLATFORM_ORDER.reduce((total, platform) => total + (policy.platforms[platform]?.length ?? 0), 0);

export const draftForPlatform = (policy: PolicyDraft, platform: PlatformId): Draft => {
  const draft: Draft = {
    version: 1,
    platform,
    name: policy.name,
    selections: policy.platforms[platform] ?? [],
  };

  if (policy.savedAt !== undefined) draft.savedAt = policy.savedAt;

  return draft;
};

/** Every artifact represented by the policy, in platform order. */
export const buildArtifacts = (policy: PolicyDraft): ExportArtifact[] =>
  policyPlatforms(policy).map((platform) => buildArtifact(draftForPlatform(policy, platform)));

export type PolicyBundle = {
  readonly fileName: string;
  readonly contentType: string;
  readonly content: string | Uint8Array<ArrayBuffer>;
  readonly artifactCount: number;
};

/**
 * A single-platform policy exports its native artifact; a multi-platform policy
 * exports one ZIP so the operator gets everything in one download.
 */
export const buildPolicyBundle = (policy: PolicyDraft): PolicyBundle | null => {
  const artifacts = buildArtifacts(policy);

  if (artifacts.length === 0) return null;

  if (artifacts.length === 1) {
    const artifact = artifacts[0]!;

    return {
      fileName: artifact.fileName,
      contentType: artifact.contentType,
      content: artifact.content,
      artifactCount: 1,
    };
  }

  const base = identifierSafe(policy.name || "policy");

  return {
    fileName: `${base}.zip`,
    contentType: "application/zip",
    content: buildZip(
      artifacts.map((artifact) => ({ name: artifact.fileName, content: artifact.content })),
    ),
    artifactCount: artifacts.length,
  };
};

/** Which configuration row carries the full multi-platform draft. */
const draftAnchor = (
  platform: PlatformId,
  configurations: PolicyConfigurations,
): string | undefined => {
  if (platform === "windows")
    return "mttx.windows.custom.designer" in configurations
      ? "mttx.windows.custom.designer"
      : undefined;

  if (platform === "android")
    return "mttx.android.policy.designer" in configurations
      ? "mttx.android.policy.designer"
      : undefined;

  if ("mttx.apple.custom.designer" in configurations) return "mttx.apple.custom.designer";

  return Object.keys(configurations).find((kind) => kind.startsWith("mttx.apple.declaration."));
};

const DraftAnchor = Schema.Struct({
  content: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.String),
  configuration: Schema.optional(Schema.Unknown),
  designer: Schema.optional(Schema.Boolean),
  nodes: Schema.optional(Schema.Unknown),
  policy: Schema.optional(Schema.Unknown),
  draft: Schema.optional(Schema.Unknown),
});

const isDraftAnchor = Schema.is(DraftAnchor);

/** Build the configuration map for every platform in one policy. */
export const policyToConfigurations = (policy: PolicyDraft) => {
  const savedAt = policy.savedAt ?? Date.now();
  const snapshot: PolicyDraft = { ...policy, savedAt };
  const configurations: PolicyConfigurations = {};

  for (const platform of policyPlatforms(policy)) {
    Object.assign(configurations, artifactToConfigurations(draftForPlatform(policy, platform)));
  }

  for (const platform of PLATFORM_ORDER) {
    const kind = draftAnchor(platform, configurations);

    if (!kind) continue;

    const current = configurations[kind];

    if (!isDraftAnchor(current)) continue;

    Object.assign(current, { draft: snapshot });
  }

  return configurations;
};
