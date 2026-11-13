import { collectionProperties, type Collection, type PlatformId, type Property } from "./catalog";
import { buildZip } from "./zip";

export type Selection = {
  collectionId: string;
  identifier: string;
  kind: Collection["kind"];
  surface: string;
  name: string;
  properties: Property[];
  values: Record<string, unknown>;
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
const PLIST_DATA = Symbol("plist-data");
const plistData = (value: string) => ({ [PLIST_DATA]: value });

const isPlistData = (value: unknown): value is { [PLIST_DATA]: string } =>
  typeof value === "object" && value !== null && PLIST_DATA in value;

const plistValue = (value: unknown): string => {
  if (value === null || value === undefined) return "<string></string>";

  if (isPlistData(value)) return `<data>${escapeXml(value[PLIST_DATA].replace(/\s/g, ""))}</data>`;

  if (typeof value === "boolean") return value ? "<true/>" : "<false/>";

  if (typeof value === "number")
    return Number.isInteger(value) ? `<integer>${value}</integer>` : `<real>${value}</real>`;

  if (value instanceof Date) return `<date>${value.toISOString().replace(/\.\d{3}Z$/, "Z")}</date>`;

  if (typeof value === "string") return `<string>${escapeXml(value)}</string>`;

  if (Array.isArray(value))
    return `<array>${value.map((item) => plistValue(item)).join("")}</array>`;

  if (typeof value === "object")
    return `<dict>${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && item !== null)
      .map(([key, item]) => `<key>${escapeXml(key)}</key>${plistValue(item)}`)
      .join("")}</dict>`;

  return `<string>${escapeXml(String(value))}</string>`;
};

export const serializePlist = (value: unknown) =>
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
const payloadValues = (selection: Selection): Record<string, unknown> => {
  const envelope = new Set(selection.properties.filter(isEnvelope).map((property) => property.key));

  return Object.fromEntries(
    Object.entries(selection.values).filter(
      ([key, value]) => value !== undefined && value !== null && !envelope.has(key),
    ),
  );
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
const coerceEnumValue = (property: Property, value: unknown): unknown => {
  if (!property.enum) return value;
  const kind = enumDomainKind(property);

  if (kind === "boolean") {
    if (value === true || value === "true") return true;

    if (value === false || value === "false") return false;

    return value;
  }

  if (kind === "number") {
    const number = typeof value === "number" ? value : Number(value);

    return Number.isFinite(number) ? number : value;
  }

  return value;
};

export const catalogDefault = (property: Property): unknown => {
  const value = property.defaultValue;

  if (value === undefined || value === null) return undefined;

  if (property.enum) return coerceEnumValue(property, value);

  switch (property.type) {
    case "array":
      return Array.isArray(value) ? value : undefined;
    case "dictionary":
      return isPlainObject(value) ? value : undefined;
    case "data":
      return typeof value === "string" ? value : undefined;
    case "boolean":
      return property.enum || typeof value === "boolean" ? value : undefined;
    case "integer":
    case "real": {
      if (property.enum) return value;
      const number = typeof value === "number" ? value : Number(value);

      return Number.isFinite(number) ? number : undefined;
    }

    default:
      return value;
  }
};

export const defaultValues = (collection: Collection): Record<string, unknown> =>
  Object.fromEntries(
    collectionProperties(collection)
      .filter((property) => !isEnvelope(property))
      .map((property) => [valueKey(property, collection.platform), catalogDefault(property)])
      .filter(([, value]) => value !== undefined),
  );

/**
 * Compare drafts and catalogue defaults without depending on object key order.
 * Dates are normalized because date properties round-trip through JSON strings.
 */
export const sameValue = (left: unknown, right: unknown): boolean => {
  const normalize = (value: unknown): string => {
    if (value instanceof Date) return `date:${value.toISOString()}`;

    if (Array.isArray(value)) return `[${value.map(normalize).join(",")}]`;

    if (typeof value === "object" && value !== null)
      return `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map(
          (key) => `${JSON.stringify(key)}:${normalize((value as Record<string, unknown>)[key])}`,
        )
        .join(",")}}`;

    return JSON.stringify(value) ?? "undefined";
  };

  return normalize(left) === normalize(right);
};

/** A value is configured when the payload will contain it. */
export const isConfiguredValue = (value: unknown) => value !== undefined && value !== null;

/** A value is changed when it differs from the catalogue default (including unset). */
export const isChangedValue = (property: Property, value: unknown) =>
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

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
        if (typeof value !== "string") {
          add("error", "Expected a base64-encoded string.");
        } else if (value.trim() !== "" && !BASE64.test(value.replace(/\s/g, ""))) {
          add("warning", "This value does not look like base64 data.");
        }

        continue;
      }

      if (property.type === "boolean" && !enumProperty) {
        if (typeof value !== "boolean") add("error", "Expected On or Off.");
        continue;
      }

      if ((property.type === "integer" || property.type === "real") && !enumProperty) {
        const number = typeof value === "number" ? value : Number(value);

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

      if (property.type === "string" && property.pattern && typeof value === "string") {
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
  const values = payloadValues(selection);

  for (const property of selection.properties) {
    const value = values[property.key];

    if (value === undefined) continue;

    if (isPlistDataProperty(property) && typeof value === "string")
      values[property.key] = plistData(value);

    if (isPlistDateProperty(property) && typeof value === "string") {
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
        Payload:
          typeof explicit === "object" && explicit !== null && !Array.isArray(explicit)
            ? explicit
            : values,
      };
    });

/** Older drafts stored enum defaults as strings; normalise before SyncML. */
const normalizeEnumValue = (property: Property, value: unknown) => {
  if (!property.enum) return value;
  const kind = enumDomainKind(property);

  if (kind === "boolean") {
    if (value === true || value === "true") return true;

    if (value === false || value === "false") return false;

    return value;
  }

  if (kind === "number") {
    const number = typeof value === "number" ? value : Number(value);

    return Number.isFinite(number) ? number : value;
  }

  return value;
};

const windowsFormat = (property: Property, value: unknown) => {
  if (typeof value === "boolean") return "int";

  if (typeof value === "number") return Number.isInteger(value) ? "int" : "chr";

  if (property.type === "integer" || property.type === "boolean") return "int";

  if (property.enum && enumDomainKind(property) !== "string") return "int";

  if (property.type === "data") return "b64";

  return "chr";
};

/** SyncML booleans are 1/0, not JSON booleans. */
const syncmlData = (value: unknown) =>
  value === null || value === undefined
    ? ""
    : typeof value === "boolean"
      ? value
        ? "1"
        : "0"
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

export const buildWindowsNodes = (draft: Draft) => {
  const nodes = new Map<string, { omaUri: string; value: unknown; format: string }>();

  for (const selection of draft.selections) {
    for (const property of collectionProperties(selection)) {
      const rawValue = selection.values[valueKey(property, "windows")];

      if (rawValue === undefined || rawValue === null) continue;
      const value = normalizeEnumValue(property, rawValue);

      const omaUri =
        property.address ??
        `./Device/Vendor/MSFT/Policy/Config/${selection.identifier}/${property.key}`;

      if (/[{}]/.test(omaUri)) continue;
      nodes.set(omaUri, { omaUri, value, format: windowsFormat(property, value) });
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
  const policy = Object.assign(
    {},
    ...draft.selections.map((selection) => payloadValues(selection)),
  ) as Record<string, unknown>;

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

export const artifactToConfigurations = (draft: Draft): Record<string, unknown> => {
  if (draft.platform === "apple") {
    const profiles = draft.selections.filter((selection) => selection.kind === "profile");
    const declarations = draft.selections.filter((selection) => selection.kind === "declaration");
    const configurations: Record<string, unknown> = {};
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
      configurations[declarationConfigKind(selection.identifier, duplicate)] = {
        kind: selection.identifier,
        configuration: payloadValues(selection),
        designer: true,
        ...(profiles.length === 0 && index === 0 ? { draft: draftWithTime } : {}),
      };
    });

    return configurations;
  }

  if (draft.platform === "windows") {
    return {
      "mttx.windows.custom.designer": {
        nodes: buildWindowsNodes(draft).map((node) => ({
          omaUri: node.omaUri,
          value: node.value,
          format: node.format,
        })),
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Accept both the persisted v1 draft (one platform) and the multi-platform v2
 * draft. Anything that cannot be trusted is ignored rather than half-loaded.
 */
export const parsePolicyDraft = (value: unknown): PolicyDraft | undefined => {
  if (!value) return undefined;
  let parsed = value;

  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  if (!isRecord(parsed)) return undefined;
  const name = typeof parsed.name === "string" ? parsed.name : "My policy";
  const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : undefined;

  if (parsed.version === 1 && Array.isArray(parsed.selections)) {
    const platform = parsed.platform;

    if (platform !== "apple" && platform !== "windows" && platform !== "android") return undefined;

    return {
      version: 2,
      name,
      platforms: { [platform]: parsed.selections as Selection[] },
      ...(savedAt ? { savedAt } : {}),
    };
  }

  if (parsed.version !== 2 || !isRecord(parsed.platforms)) return undefined;
  const platforms: Partial<Record<PlatformId, Selection[]>> = {};

  for (const platform of PLATFORM_ORDER) {
    const selections = parsed.platforms[platform];

    if (Array.isArray(selections)) platforms[platform] = selections as Selection[];
  }

  return { version: 2, name, platforms, ...(savedAt ? { savedAt } : {}) };
};

export const policyPlatforms = (policy: PolicyDraft): PlatformId[] =>
  PLATFORM_ORDER.filter((platform) => (policy.platforms[platform]?.length ?? 0) > 0);

export const policySelectionCount = (policy: PolicyDraft) =>
  PLATFORM_ORDER.reduce((total, platform) => total + (policy.platforms[platform]?.length ?? 0), 0);

export const draftForPlatform = (policy: PolicyDraft, platform: PlatformId): Draft => ({
  version: 1,
  platform,
  name: policy.name,
  selections: policy.platforms[platform] ?? [],
  ...(policy.savedAt ? { savedAt: policy.savedAt } : {}),
});

/** Every artifact represented by the policy, in platform order. */
export const buildArtifacts = (policy: PolicyDraft): ExportArtifact[] =>
  policyPlatforms(policy).map((platform) => buildArtifact(draftForPlatform(policy, platform)));

export type PolicyBundle = {
  readonly fileName: string;
  readonly contentType: string;
  readonly content: string | Uint8Array;
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
  configurations: Record<string, unknown>,
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

/** Build the configuration map for every platform in one policy. */
export const policyToConfigurations = (policy: PolicyDraft): Record<string, unknown> => {
  const savedAt = policy.savedAt ?? Date.now();
  const snapshot: PolicyDraft = { ...policy, savedAt };
  const configurations: Record<string, unknown> = {};

  for (const platform of policyPlatforms(policy)) {
    Object.assign(configurations, artifactToConfigurations(draftForPlatform(policy, platform)));
  }

  for (const platform of PLATFORM_ORDER) {
    const kind = draftAnchor(platform, configurations);

    if (!kind) continue;
    const current = configurations[kind];

    if (!isRecord(current)) continue;
    configurations[kind] = { ...current, draft: snapshot };
  }

  return configurations;
};
