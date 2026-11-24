import { Effect, Option, Schema } from "effect";
import { CatalogueService, runCatalogue } from "~/lib/catalogue-service";
import {
  ADMX_LIMITS,
  AdmxImportError,
  decodeText,
  readAdmxZip,
} from "@mattrax/enterprise-domain/admx";
import type {
  AdmxCatalogueIndex,
  AdmxDiscoveredPolicy,
  AdmxElement,
  AdmxInputFile,
} from "@mattrax/enterprise-domain/admx";
import type { Collection, Property, PropertyType } from "./catalog";
import { ADMX_STATE_KEY } from "./build";
import type { AdmxSelectionTemplate, Selection, SelectionTemplate } from "./build";

/**
 * The designer's view of an imported ADMX policy.
 *
 * The domain module parses templates and builds Policy CSP payloads; this file
 * turns a discovered policy into the collection shape the designer already
 * renders, and reads picked files (including zips) into text. No ADMX logic is
 * duplicated here.
 */

const ADMX_COLLECTION_PREFIX = "admx:";

const ADMX_INGESTION_DOCS =
  "https://learn.microsoft.com/en-us/windows/client-management/win32-and-centennial-app-policy-configuration";

export const ADMX_CATALOGUE_INDEX_URL = "/catalog/windows/admx.json";

export const isAdmxCollectionId = (id: string) => id.startsWith(ADMX_COLLECTION_PREFIX);

/** Stable id for one policy. It never changes across re-imports of the file. */
export const admxPolicyCollectionId = (policy: AdmxDiscoveredPolicy) =>
  `${ADMX_COLLECTION_PREFIX}${policy.source}:${policy.appName}:${policy.policy.name}`;

const AdmxCatalogueEntryValue = Schema.Struct({
  area: Schema.String,
  scope: Schema.Literals(["device", "user"]),
  collectionId: Schema.String,
  policyName: Schema.String,
});

const AdmxCatalogueIndexFile = Schema.Struct({
  version: Schema.Literal(1),
  policies: Schema.Record(Schema.String, Schema.Array(AdmxCatalogueEntryValue)),
});

const propertyType = (kind: AdmxElement["kind"]): PropertyType => {
  switch (kind) {
    case "boolean":
      return "boolean";
    case "decimal":
      return "integer";
    case "longDecimal":
      // 64-bit values can exceed Number's safe integer range.
      return "string";
    case "enum":
      return "enum";
    case "list":
    case "multiText":
      return "array";
    case "text":
      return "string";
  }
};

const enumValue = (element: AdmxElement["items"]) =>
  element?.flatMap((item) =>
    item.value.kind === "delete" || item.value.kind === "boolean"
      ? []
      : [{ value: item.value.value, description: item.displayName }],
  ) ?? [];

type MutableProperty = { -readonly [K in keyof Property]: Property[K] };

const elementProperty = (policy: AdmxDiscoveredPolicy, element: AdmxElement): Property => {
  const type = propertyType(element.kind);

  const property: MutableProperty = {
    key: element.id,
    valueKey: element.id,
    name: element.label,
    type,
    description:
      element.kind === "list" || element.kind === "multiText"
        ? [policy.policy.description, "Enter the entries as a JSON array of strings."]
            .filter(Boolean)
            .join(" ")
        : policy.policy.description,
    address: policy.omaUri,
    scope: policy.scope,
    category: "Settings",
  };

  if (element.required) property.required = true;

  if (type === "enum") {
    const options = enumValue(element.items);

    if (options.length > 0) property.enum = options;

    if (element.defaultItem !== undefined) {
      const fallback = options[element.defaultItem];

      if (fallback) property.defaultValue = fallback.value;
    }
  }

  if (type === "integer") {
    const min = element.minValue === undefined ? undefined : Number(element.minValue);
    const max = element.maxValue === undefined ? undefined : Number(element.maxValue);

    if (min !== undefined && Number.isFinite(min)) property.min = min;

    if (max !== undefined && Number.isFinite(max)) property.max = max;

    if (element.defaultValue !== undefined) {
      const value = Number(element.defaultValue);

      if (Number.isFinite(value)) property.defaultValue = value;
    }
  }

  if (element.kind === "longDecimal") {
    property.pattern = String.raw`^-?\d+$`;

    if (element.defaultValue !== undefined) property.defaultValue = element.defaultValue;
  }

  return property;
};

const stateProperty = (policy: AdmxDiscoveredPolicy): Property => ({
  key: "admxState",
  valueKey: ADMX_STATE_KEY,
  name: "Policy state",
  type: "enum",
  description:
    "Enabled writes the template's enabled value and the elements you set. Disabled writes its disabled value. Remove the setting to leave it not configured.",
  address: policy.omaUri,
  scope: policy.scope,
  category: "Policy state",
  defaultValue: "enabled",
  enum: [
    { value: "enabled", description: "Enabled" },
    { value: "disabled", description: "Disabled" },
  ],
});

/**
 * The designer collection for one imported policy.
 *
 * Returns `null` for a policy the translator cannot deliver; the review screen
 * lists those with their reason instead of pretending they can be added.
 */
export const admxPolicyCollection = (policy: AdmxDiscoveredPolicy): Collection | null => {
  if (!policy.omaUri || policy.unmappable) return null;

  const properties = policy.policy.elements.filter(
    (element) => !element.unsupported || element.unsupported.length === 0,
  );

  if (properties.length === 0 && policy.policy.elements.length > 0) return null;

  return {
    id: admxPolicyCollectionId(policy),
    platform: "windows",
    kind: "csp",
    surface: "ADMX import",
    identifier: policy.omaUri,
    name: policy.policy.displayName || policy.policy.name,
    description:
      policy.policy.description ||
      `${policy.source === "inbox" ? "Microsoft in-box" : "Vendor"} ADMX policy ${policy.policy.name}.`,
    group:
      policy.source === "inbox" ? `ADMX · ${policy.appName}` : `Imported ADMX · ${policy.appName}`,
    // The catalogue's Microsoft link is wrong for vendor templates; point at
    // the ingestion reference instead.
    source: policy.source === "inbox" ? undefined : ADMX_INGESTION_DOCS,
    properties: [
      stateProperty(policy),
      ...properties.map((element) => elementProperty(policy, element)),
    ],
  };
};

/** The template a selection stores so `buildWindowsNodes` can compile it. */
export const admxSelectionTemplate = (policy: AdmxDiscoveredPolicy): AdmxSelectionTemplate => ({
  provider: "admx",
  source: policy.source,
  appName: policy.appName,
  fileId: policy.fileId,
  policyName: policy.policy.name,
  scope: policy.scope,
  omaUri: policy.omaUri,
  ...(policy.source === "vendor" && policy.admxPayload ? { admx: policy.admxPayload } : {}),
  elements: policy.policy.elements.map((element) => ({
    id: element.id,
    kind: element.kind,
    ...(element.required ? { required: true } : {}),
  })),
});

export type AdmxSelection = { collection: Collection; template: SelectionTemplate };

/** Everything the designer needs to add one imported policy. */
export const admxPolicySelection = (policy: AdmxDiscoveredPolicy): AdmxSelection | null => {
  const collection = admxPolicyCollection(policy);

  if (!collection) return null;

  return { collection, template: admxSelectionTemplate(policy) };
};

/** Rebuild a collection from a saved selection, without a catalogue fetch. */
export const admxCollectionFromSelection = (selection: Selection): Collection | null => {
  if (!isAdmxCollectionId(selection.collectionId)) return null;

  return {
    id: selection.collectionId.split("#")[0] ?? selection.collectionId,
    platform: "windows",
    kind: selection.kind,
    surface: selection.surface,
    identifier: selection.identifier,
    name: selection.name,
    description: "",
    group: "ADMX import",
    properties: selection.properties,
  };
};

const parseCatalogueIndex = (value: Schema.Json): AdmxCatalogueIndex => {
  const decoded = Schema.decodeUnknownOption(AdmxCatalogueIndexFile)(value);

  if (Option.isNone(decoded)) throw new Error("The ADMX catalogue lookup is malformed.");

  return decoded.value;
};

/** Load the generated lookup through the Layer-owned catalogue cache. */
export const loadAdmxCatalogueIndex = () =>
  runCatalogue(
    CatalogueService.pipe(
      Effect.flatMap((service) => service.get(ADMX_CATALOGUE_INDEX_URL, AdmxCatalogueIndexFile)),
      Effect.map(parseCatalogueIndex),
    ),
  );

/** Read picked files into text, expanding any zip archives. */
export const readAdmxFiles = async (files: readonly File[]): Promise<AdmxInputFile[]> => {
  const output: AdmxInputFile[] = [];
  let total = 0;

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (/\.zip$/i.test(file.name)) {
      output.push(...(await readAdmxZip(bytes)));

      continue;
    }

    if (!/\.(admx|adml)$/i.test(file.name))
      throw new AdmxImportError(
        "unsupported-file",
        `${file.name} is not an .admx, .adml or .zip file.`,
      );

    if (bytes.length > ADMX_LIMITS.maxFileBytes)
      throw new AdmxImportError("file-too-large", `${file.name} is larger than 1 MiB.`);

    total += bytes.length;

    if (total > ADMX_LIMITS.maxBundleBytes)
      throw new AdmxImportError(
        "file-too-large",
        "The selected files total more than the 4 MiB import limit.",
      );

    output.push({ name: file.name, text: decodeText(bytes) });
  }

  return output;
};
