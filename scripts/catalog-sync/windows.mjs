import { cleanText, fetchJson, slugify, SourceError } from "./util.mjs";

const RELEASE = "https://github.com/royklo/IntuneSettingsCatalogData/releases/download/latest";

const isChoice = (type) =>
  type.includes("ChoiceSettingDefinition") || type.includes("ChoiceSettingCollectionDefinition");

const isCollection = (type) => type.includes("CollectionDefinition");

const mapType = (setting) => {
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

const enumValues = (setting) => {
  if (!setting.options?.length) return undefined;

  return setting.options.map((option) => ({
    value: String(option.optionValue?.value ?? option.itemId ?? option.name ?? ""),
    description: cleanText(option.displayName ?? option.name, 400) || undefined,
  }));
};

const extractDefault = (setting) => {
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

const omaUri = (setting) => `${setting.baseUri ?? ""}${setting.offsetUri ?? ""}`;

/** Best-effort Learn documentation link for a native CSP or Policy node. */
const learnUrl = (address) => {
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

const toProperty = (setting) => {
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

const categoryName = (categoryById, id) =>
  (id && categoryById.get(id)?.displayName) || "Uncategorised";

const rootName = (categoryById, id) => {
  const category = id ? categoryById.get(id) : undefined;

  return categoryName(categoryById, category?.rootCategoryId ?? id);
};

export const loadWindows = async () => {
  const [settings, categories] = await Promise.all([
    fetchJson(`${RELEASE}/settings.json`, "windows/settings.json"),
    fetchJson(`${RELEASE}/categories.json`, "windows/categories.json"),
  ]);

  if (!Array.isArray(settings) || !Array.isArray(categories)) {
    throw new SourceError(RELEASE, "expected settings and categories arrays");
  }

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const grouped = new Map();

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

  const used = new Set();
  const collections = [];

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
