import type { Collection, Property, PropertyEnumValue, PropertyType } from "./catalog.ts";
import { cleanText, fetchJson, slugify, SourceError } from "./util.ts";

const RELEASE = "https://github.com/royklo/IntuneSettingsCatalogData/releases/download/latest";

/**
 * Entries in the release's `settings.json` / `categories.json`. Both files are
 * generated from Microsoft Graph, whose schema is the contract for these
 * optional fields.
 */
interface WindowsOption {
  optionValue?: { value?: unknown };
  itemId?: string;
  name?: string;
  displayName?: string;
}

interface WindowsSetting {
  "@odata.type"?: string;
  name?: string;
  id?: string;
  displayName?: string;
  description?: string;
  baseUri?: string;
  offsetUri?: string;
  valueDefinition?: {
    "@odata.type"?: string;
    minimumValue?: number;
    maximumValue?: number;
  };
  options?: WindowsOption[];
  defaultValue?: { value?: unknown };
  defaultOptionId?: string;
  applicability?: {
    platform?: string;
    configurationServiceProviderVersion?: string;
    minimumSupportedVersion?: string;
  };
  categoryId?: string;
  infoUrls?: string[];
}

interface WindowsCategory {
  id: string;
  displayName?: string;
  rootCategoryId?: string;
}

interface WindowsGroup {
  name: string;
  root: string;
  properties: Property[];
}

const isChoice = (type: string): boolean =>
  type.includes("ChoiceSettingDefinition") || type.includes("ChoiceSettingCollectionDefinition");

const isCollection = (type: string): boolean => type.includes("CollectionDefinition");

const mapType = (setting: WindowsSetting): PropertyType => {
  const type = setting["@odata.type"] ?? "";

  if (isChoice(type)) return "enum";

  if (type.includes("SettingGroupCollectionDefinition")) return "dictionary";

  if (isCollection(type)) return "array";

  const definition = setting.valueDefinition?.["@odata.type"] ?? "";

  if (definition.includes("Boolean")) return "boolean";

  if (definition.includes("Integer")) return "integer";

  if (definition.includes("String")) return "string";

  if (definition.includes("DateTime")) return "date";

  return "unknown";
};

const enumValues = (setting: WindowsSetting): PropertyEnumValue[] | undefined => {
  if (!setting.options?.length) return undefined;

  return setting.options.map((option) => ({
    value: String(option.optionValue?.value ?? option.itemId ?? option.name ?? ""),
    description: cleanText(option.displayName ?? option.name, 400) || undefined,
  }));
};

const extractDefault = (setting: WindowsSetting) => {
  const direct = setting.defaultValue;

  if (direct?.value !== undefined) return direct.value;

  if (setting.defaultOptionId && setting.options) {
    const option = setting.options.find(
      (candidate) => candidate.itemId === setting.defaultOptionId,
    );

    if (option) return option.optionValue?.value ?? option.displayName;
  }

  return undefined;
};

const omaUri = (setting: WindowsSetting): string =>
  `${setting.baseUri ?? ""}${setting.offsetUri ?? ""}`;

/** Best-effort Learn documentation link for a native CSP or Policy node. */
const learnUrl = (address: string): string | undefined => {
  const policy = address.match(/Vendor\/MSFT\/Policy\/Config\/([^/~]+)/);

  if (policy) {
    return `https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-${policy[1].toLowerCase()}`;
  }

  const csp = address.match(/Vendor\/MSFT\/([A-Za-z0-9]+)/);

  if (csp) {
    return `https://learn.microsoft.com/en-us/windows/client-management/mdm/${csp[1].toLowerCase()}-csp`;
  }

  return undefined;
};

const toProperty = (setting: WindowsSetting): Property | undefined => {
  const address = omaUri(setting);

  if (!address) return undefined;

  const type = mapType(setting);
  const min = setting.valueDefinition?.minimumValue;
  const max = setting.valueDefinition?.maximumValue;
  const cspVersion = setting.applicability?.configurationServiceProviderVersion;
  const minBuild = setting.applicability?.minimumSupportedVersion;

  return {
    key: setting.name ?? setting.id ?? address.split("/").pop() ?? address,
    name: cleanText(setting.displayName, 300) || setting.name || address,
    type,
    description: cleanText(setting.description, 1500),
    defaultValue: extractDefault(setting),
    enum: enumValues(setting),
    address,
    scope: /\/User\//i.test(address) ? "user" : "device",
    minOs: minBuild ? `${minBuild}+` : undefined,
    introducedIn: cspVersion ? `CSP ${cspVersion}` : undefined,
    min,
    max,
    source: setting.infoUrls?.[0] ?? learnUrl(address),
  };
};

const categoryName = (
  categoryById: Map<string, WindowsCategory>,
  id: string | undefined,
): string => (id && categoryById.get(id)?.displayName) || "Uncategorised";

const rootName = (categoryById: Map<string, WindowsCategory>, id: string | undefined): string => {
  const category = id ? categoryById.get(id) : undefined;

  return categoryName(categoryById, category?.rootCategoryId ?? id);
};

export const loadWindows = async (): Promise<Collection[]> => {
  const [settingsRaw, categoriesRaw] = await Promise.all([
    fetchJson(`${RELEASE}/settings.json`, "windows/settings.json"),
    fetchJson(`${RELEASE}/categories.json`, "windows/categories.json"),
  ]);

  if (!Array.isArray(settingsRaw) || !Array.isArray(categoriesRaw)) {
    throw new SourceError(RELEASE, "expected settings and categories arrays");
  }

  // Both entries are typed by the Graph shapes declared above; the array checks
  // are the parse-boundary guard for the release files.
  // SAFETY: the settings file is generated from Microsoft Graph, and the array
  // check above establishes the container being indexed.
  const settings = settingsRaw as WindowsSetting[];

  // SAFETY: the categories file shares that source and guard.
  const categories = categoriesRaw as WindowsCategory[];

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const grouped = new Map<string, WindowsGroup>();

  for (const setting of settings) {
    if (setting.applicability?.platform !== "windows10") continue;

    if (!(setting.baseUri ?? "").startsWith("./")) continue;

    const property = toProperty(setting);

    if (!property) continue;

    const categoryId = setting.categoryId ?? "";
    const name = categoryName(categoryById, categoryId);
    let group = grouped.get(name);

    if (!group) {
      group = { name, root: rootName(categoryById, categoryId), properties: [] };
      grouped.set(name, group);
    }

    group.properties.push(property);
  }

  const used = new Set<string>();
  const collections: Collection[] = [];

  for (const group of grouped.values()) {
    const properties = group.properties.sort((a, b) => a.name.localeCompare(b.name));
    let identifier = slugify(group.name) || "settings";

    while (used.has(identifier)) identifier = `${identifier}-x`;

    used.add(identifier);

    collections.push({
      id: `windows/settings/${identifier}`,
      platform: "windows",
      kind: "csp",
      surface: "settings",
      identifier,
      name: group.name,
      description: `Windows MDM settings in the ${group.name} category, applied as OMA-URI (SyncML) values.`,
      group: group.root === group.name ? undefined : group.root,
      properties,
      source:
        "https://learn.microsoft.com/en-us/windows/client-management/mdm/configuration-service-provider-reference",
    });
  }

  collections.sort((a, b) => a.name.localeCompare(b.name));

  return collections;
};
