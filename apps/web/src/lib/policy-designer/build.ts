import type { Collection, PlatformId, Property } from "./catalog";

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
};

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const plistValue = (value: unknown): string => {
  if (value === null || value === undefined) return "<string></string>";
  if (typeof value === "boolean") return value ? "<true/>" : "<false/>";
  if (typeof value === "number")
    return Number.isInteger(value) ? `<integer>${value}</integer>` : `<real>${value}</real>`;
  if (typeof value === "string") return `<string>${escapeXml(value)}</string>`;
  if (value instanceof Date) return `<date>${value.toISOString().replace(/\.\d{3}Z$/, "Z")}</date>`;
  if (Array.isArray(value))
    return `<array>${value.map((item) => plistValue(item)).join("")}</array>`;
  if (typeof value === "object")
    return `<dict>${Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `<key>${escapeXml(key)}</key>${plistValue(item)}`)
      .join("")}</dict>`;
  return `<string>${escapeXml(String(value))}</string>`;
};

export const serializePlist = (value: unknown) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${plistValue(value)}</plist>`;

const uuid = () => crypto.randomUUID();
const identifierSafe = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "-");

export const defaultValues = (collection: Collection): Record<string, unknown> =>
  Object.fromEntries(
    collection.properties
      .filter((property) => property.defaultValue !== undefined)
      .map((property) => [property.key, property.defaultValue]),
  );

export const buildAppleProfile = (draft: Draft) => {
  const payloads = draft.selections
    .filter((selection) => selection.kind === "profile")
    .map((selection) => ({
      ...selection.values,
      PayloadType: selection.identifier,
      PayloadIdentifier:
        selection.values.PayloadIdentifier ??
        `app.mattrax.designer.${identifierSafe(selection.identifier)}`,
      PayloadUUID: selection.values.PayloadUUID ?? uuid(),
      PayloadVersion: selection.values.PayloadVersion ?? 1,
    }));
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
    .map((selection) => ({
      Type: selection.identifier,
      Identifier: `com.mattrax.designer.${identifierSafe(selection.identifier)}`,
      ServerToken: crypto.randomUUID(),
      Payload: selection.values,
    }));

const windowsFormat = (property: Property, value: unknown) => {
  if (typeof value === "boolean") return "int";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "chr";
  if (property.type === "integer" || property.type === "boolean") return "int";
  if (property.type === "data") return "b64";
  return "chr";
};

/** SyncML booleans are 1/0, not JSON booleans. */
const syncmlData = (value: unknown) =>
  typeof value === "boolean"
    ? value
      ? "1"
      : "0"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

export const buildWindowsNodes = (draft: Draft) =>
  draft.selections.flatMap((selection) =>
    selection.properties
      .filter((property) => selection.values[property.key] !== undefined)
      .map((property) => ({
        omaUri:
          property.address ??
          `./Device/Vendor/MSFT/Policy/Config/${selection.identifier}/${property.key}`,
        value: selection.values[property.key],
        format: windowsFormat(property, selection.values[property.key]),
      })),
  );

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
  Object.assign({}, ...draft.selections.map((selection) => selection.values));

export type ExportArtifact = {
  readonly fileName: string;
  readonly contentType: string;
  readonly content: string;
  readonly kind: "mobileconfig" | "declarations" | "syncml" | "android-policy";
};

export const buildArtifact = (draft: Draft): ExportArtifact => {
  if (draft.platform === "apple") {
    const declarations = buildDeclarations(draft);
    if (
      declarations.length > 0 &&
      draft.selections.every((selection) => selection.kind === "declaration")
    )
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

export const artifactToConfigurations = (draft: Draft): Record<string, unknown> => {
  if (draft.platform === "apple") {
    if (
      draft.selections.length > 0 &&
      draft.selections.every((selection) => selection.kind === "declaration")
    )
      return Object.fromEntries(
        draft.selections.map((selection) => [
          `mttx.apple.declaration.${identifierSafe(selection.identifier).slice(0, 40)}`,
          { kind: selection.identifier, configuration: selection.values },
        ]),
      );
    const content = buildMobileconfig(draft);
    const bytes = new TextEncoder().encode(content);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { "mttx.apple.custom.designer": { content: btoa(binary), draft } };
  }
  if (draft.platform === "windows") {
    return {
      "mttx.windows.custom.designer": {
        nodes: buildWindowsNodes(draft).map((node) => ({
          omaUri: node.omaUri,
          value: node.value,
          format: node.format,
        })),
        draft,
      },
    };
  }
  return {};
};
