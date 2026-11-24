import { Schema } from "effect";
import {
  APPLE_LOCK_SCREEN_MESSAGE_CONFIGURATION_KIND,
  WINDOWS_LAPS_CONFIGURATION_KIND,
  parseWindowsLapsPolicy,
  windowsLapsPolicyNodes,
} from "@mattrax/enterprise-domain";

export type PolicyConfigurationRow = {
  readonly policyId: string;
  readonly kind: string;
  readonly data: Schema.Json | undefined;
  /** Content hash stored with the configuration row. */
  readonly hash: string;
  /** Owning tenant. Optional for older call sites. */
  readonly organizationId?: string;
};

export type ConfigurationKind =
  | { readonly type: "device" }
  | { readonly type: "custom"; readonly id: string }
  | { readonly type: "certificate"; readonly id: string }
  | { readonly type: "declaration"; readonly id: string }
  | { readonly type: "application"; readonly id: string }
  | { readonly type: "windows"; readonly id: string }
  | { readonly type: "windows-laps" }
  | { readonly type: "android"; readonly id: string }
  | { readonly type: "lockScreenMessage" }
  | { readonly type: "unknown" };

const IDENTIFIER_PATTERN = /^[A-Za-z0-9]{1,20}$/;

export const parseConfigurationKind = (kind: string): ConfigurationKind => {
  if (kind === "mttx.apple.device") return { type: "device" };
  if (kind === APPLE_LOCK_SCREEN_MESSAGE_CONFIGURATION_KIND) return { type: "lockScreenMessage" };

  const android = /^mttx\.android\.policy\.(.+)$/.exec(kind);

  if (android?.[1] && IDENTIFIER_PATTERN.test(android[1]))
    return { type: "android", id: android[1] };

  const windows = /^mttx\.windows\.custom\.(.+)$/.exec(kind);

  if (windows?.[1] && IDENTIFIER_PATTERN.test(windows[1]))
    return { type: "windows", id: windows[1] };
  if (kind === WINDOWS_LAPS_CONFIGURATION_KIND) return { type: "windows-laps" };

  const match = /^mttx\.apple\.(custom|certificate|declaration|application)\.(.+)$/.exec(kind);

  if (!match) return { type: "unknown" };
  const [, group, id] = match;

  if (!IDENTIFIER_PATTERN.test(id)) return { type: "unknown" };

  switch (group) {
    case "custom":
      return { type: "custom", id };
    case "certificate":
      return { type: "certificate", id };
    case "declaration":
      return { type: "declaration", id };
    case "application":
      return { type: "application", id };
    default:
      return { type: "unknown" };
  }
};

export const isLegacyKind = (kind: string): boolean => {
  const parsed = parseConfigurationKind(kind);

  return parsed.type === "device" || parsed.type === "custom";
};

export const isCertificateKind = (kind: string): boolean =>
  parseConfigurationKind(kind).type === "certificate";

export const isApplicationKind = (kind: string): boolean =>
  parseConfigurationKind(kind).type === "application";

export const CATALOGUE_APPLICATION_ASSET_KIND = "catalogue-application";

export const catalogueApplicationAssetIdentifier = (applicationId: string): string =>
  `app.${applicationId}`;

export const parseCatalogueApplicationAssetIdentifier = (identifier: string): string | null =>
  identifier.startsWith("app.") && identifier.length > 4 ? identifier.slice(4) : null;

export const configurationDeclarationIdentifier = (policyId: string, kind: string): string =>
  `${policyId}:${kind}`;

export const splitConfigurationDeclarationIdentifier = (identifier: string) => {
  const [policyId, ...rest] = identifier.split(":");

  return { policyId: policyId ?? "", kind: rest.join(":") };
};

export const configurationAssetIdentifier = (policyId: string, kind: string): string =>
  `${policyId}.${kind}.asset`;

export const splitConfigurationAssetIdentifier = (
  identifier: string,
): { policyId: string; kind: string } | null => {
  const withoutSuffix = identifier.endsWith(".asset")
    ? identifier.slice(0, -".asset".length)
    : identifier;
  const separator = withoutSuffix.indexOf(".");

  if (separator <= 0) return null;

  return {
    policyId: withoutSuffix.slice(0, separator),
    kind: withoutSuffix.slice(separator + 1),
  };
};

const isJsonObject = Schema.is(Schema.JsonObject);
const JsonArray = Schema.Array(Schema.Json);
const asRecord = (value: Schema.Json | undefined): Schema.JsonObject | undefined =>
  isJsonObject(value) ? value : undefined;

export type WindowsPolicyNode = {
  omaUri: string;
  value: Schema.Json;
  format?: string;
};

/** Extract OMA-URI nodes from a Windows custom or structured LAPS policy. */
export const windowsPolicyNodes = (row: PolicyConfigurationRow): Array<WindowsPolicyNode> => {
  const configuration = parseConfigurationKind(row.kind);

  if (configuration.type === "windows-laps") {
    const policy = parseWindowsLapsPolicy(row.data);

    return policy
      ? windowsLapsPolicyNodes(policy).map((node) => ({
          omaUri: node.omaUri,
          value: node.value,
          format: node.format,
        }))
      : [];
  }

  if (configuration.type !== "windows") return [];
  const data = asRecord(row.data);
  const nodes = data === undefined ? [] : Schema.is(JsonArray)(data.nodes) ? data.nodes : [data];

  return nodes.flatMap((node) => {
    if (!isJsonObject(node)) return [];
    const omaUri = node.omaUri;

    if (!Schema.is(Schema.String)(omaUri)) return [];
    const result: WindowsPolicyNode = { omaUri, value: node.value };

    if (Schema.is(Schema.String)(node.format)) result.format = node.format;

    return [result];
  });
};
