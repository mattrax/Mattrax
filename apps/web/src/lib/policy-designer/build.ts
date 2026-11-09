import { collectionProperties, type Collection, type PlatformId, type Property } from "./catalog";

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

export const defaultValues = (collection: Collection): Record<string, unknown> =>
  Object.fromEntries(
    collectionProperties(collection)
      .filter(
        (property) =>
          property.defaultValue !== undefined &&
          property.defaultValue !== null &&
          !isEnvelope(property),
      )
      .map((property) => [valueKey(property, collection.platform), property.defaultValue]),
  );

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

const windowsFormat = (property: Property, value: unknown) => {
  if (typeof value === "boolean") return "int";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "chr";
  if (property.type === "integer" || property.type === "boolean") return "int";
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
      const value = selection.values[valueKey(property, "windows")];
      if (value === undefined || value === null) continue;
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

export const buildAndroidPolicy = (draft: Draft) =>
  Object.assign({}, ...draft.selections.map((selection) => payloadValues(selection)));

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

    declarations.forEach((selection, index) => {
      configurations[declarationConfigKind(selection.identifier, index)] = {
        kind: selection.identifier,
        configuration: payloadValues(selection),
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
  return {};
};
