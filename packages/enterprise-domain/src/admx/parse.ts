import type {
  AdmxElement,
  AdmxElementKind,
  AdmxEnumItem,
  AdmxFile,
  AdmxPolicy,
  AdmxPolicyClass,
  AdmxPresentationPart,
  AdmxRegistryItem,
  AdmxRegistryValue,
} from "./types.js";
import {
  ADMX_LIMITS,
  AdmxImportError,
  attribute,
  boolAttribute,
  childrenNamed,
  firstChildNamed,
  parseXml,
  type XmlElement,
} from "./xml.js";

/**
 * ADMX/ADML parsing.
 *
 * Everything here is a pure function over text. The only failure mode is
 * `AdmxImportError`, which carries a code the UI can distinguish from an
 * unsupported template construct. Simple defects (a string the ADML forgot, a
 * dangling parent category) degrade the display instead of rejecting the file;
 * structural defects (unknown element type, missing element id, DTD) reject it.
 */

const MAX_UNRESOLVED_STRINGS = 20;

const MAX_WARNINGS = 20;

const STRING_REF = /^\$\(string\.([^)]+)\)$/;

const PRESENTATION_REF = /\$\(presentation\.([^)\s]+)\)/g;

const elementKind = (name: string): AdmxElementKind | undefined => {
  switch (name.toLowerCase()) {
    case "boolean":
      return "boolean";
    case "decimal":
      return "decimal";
    case "longdecimal":
      return "longDecimal";
    case "text":
      return "text";
    case "enum":
      return "enum";
    case "list":
      return "list";
    case "multitext":
      return "multiText";
    default:
      return undefined;
  }
};

const PRESENTATION_KINDS = new Set<string>([
  "text",
  "checkBox",
  "textBox",
  "decimalTextBox",
  "longDecimalTextBox",
  "dropdownList",
  "comboBox",
  "listBox",
  "multiTextBox",
]);

const isPresentationKind = (value: string): value is AdmxPresentationPart["kind"] =>
  PRESENTATION_KINDS.has(value);

/** UTF-8 size of a string, used for the upload budget. */
export const textByteLength = (value: string) => new TextEncoder().encode(value).length;

const localName = (value: string) => value.split(":").pop() ?? value;

type StringTable = ReadonlyMap<string, string>;

type PresentationTable = ReadonlyMap<string, readonly AdmxPresentationPart[]>;

const readStringTable = (root: XmlElement): StringTable => {
  const strings = new Map<string, string>();

  for (const table of childrenNamed(root, "resources"))
    for (const entry of childrenNamed(table, "stringTable"))
      for (const string of childrenNamed(entry, "string")) {
        const id = attribute(string, "id");

        if (id && !strings.has(id)) strings.set(id, string.text);
      }

  return strings;
};

const readPresentationTable = (root: XmlElement): PresentationTable => {
  const table = new Map<string, AdmxPresentationPart[]>();

  const resolve = (value: string | undefined) => value?.trim() ?? "";

  for (const resources of childrenNamed(root, "resources"))
    for (const presentations of childrenNamed(resources, "presentationTable"))
      for (const presentation of childrenNamed(presentations, "presentation")) {
        const id = attribute(presentation, "id");

        if (!id) continue;
        const parts = table.get(id) ?? [];

        for (const child of presentation.children) {
          const kind = child.name;

          if (!isPresentationKind(kind)) continue;

          const refId = attribute(child, "refId");
          const label = attribute(child, "label");
          const defaultItem = attribute(child, "defaultItem");
          const itemIndex = defaultItem === undefined ? undefined : Number(defaultItem);

          const items = childrenNamed(child, "item").map((item) =>
            resolve(attribute(item, "displayName") ?? item.text),
          );

          const part: AdmxPresentationPart = { kind };

          // Optional keys are only set when present, so a decoded model has no
          // accidental `undefined` entries when it is stored as JSON.
          Object.assign(part, {
            ...(refId ? { refId } : {}),
            ...(label ? { label } : {}),
            ...(child.text ? { text: child.text } : {}),
            ...(kind === "checkBox" ? { defaultChecked: boolAttribute(child, "defaultChecked") } : {}),
            ...(attribute(child, "defaultValue") !== undefined
              ? { defaultValue: attribute(child, "defaultValue") }
              : {}),
            ...(itemIndex !== undefined && Number.isFinite(itemIndex) ? { defaultItem: itemIndex } : {}),
            ...(items.length > 0 ? { items } : {}),
          });

          parts.push(part);
        }

        table.set(id, parts);
      }

  return table;
};

const bytesOverLimit = (value: string, limit: number) => textByteLength(value) > limit;

const parseRegistryValue = (element: XmlElement | undefined): AdmxRegistryValue | undefined => {
  if (!element) return undefined;

  switch (element.name.toLowerCase()) {
    case "decimal": {
      const value = element.attributes.value;

      return value === undefined ? undefined : { kind: "decimal", value };
    }

    case "longdecimal": {
      const value = element.attributes.value;

      return value === undefined ? undefined : { kind: "longDecimal", value };
    }

    case "string":
      return { kind: "string", value: element.attributes.value ?? "" };

    case "boolean": {
      const value = element.attributes.value;

      return value === undefined ? undefined : { kind: "boolean", value };
    }

    case "delete":
      return { kind: "delete" };

    default:
      return undefined;
  }
};

const parseRegistryItem = (element: XmlElement): AdmxRegistryItem | undefined => {
  const valueName = attribute(element, "valueName");

  if (!valueName) return undefined;
  const value = parseRegistryValue(firstChildNamed(element, "value")?.children[0]);

  if (!value) return undefined;
  const key = attribute(element, "key");

  return { ...(key ? { key } : {}), valueName, value };
};

const resolveString = (
  raw: string | undefined,
  strings: StringTable,
  unresolved: string[],
  fallback: string,
) => {
  if (!raw) return fallback;
  const match = STRING_REF.exec(raw.trim());

  if (!match) return raw.trim();
  const id = match[1]!;
  const value = strings.get(id);

  if (value !== undefined) return value;

  if (unresolved.length < MAX_UNRESOLVED_STRINGS && !unresolved.includes(id)) unresolved.push(id);

  return id;
};

const displayNameFor = (
  element: XmlElement,
  strings: StringTable,
  unresolved: string[],
  fallback: string,
) => resolveString(attribute(element, "displayName"), strings, unresolved, fallback);

const presentationParts = (policy: XmlElement, presentations: PresentationTable) => {
  const raw = attribute(policy, "presentation");

  if (!raw) return [];

  const parts: AdmxPresentationPart[] = [];
  const seen = new Set<string>();

  for (const match of raw.matchAll(PRESENTATION_REF)) {
    const id = match[1]!;

    if (seen.has(id)) continue;
    seen.add(id);

    for (const part of presentations.get(id) ?? []) parts.push(part);
  }

  return parts;
};

const categoryLabel = (
  category: XmlElement | undefined,
  name: string,
  strings: StringTable,
  unresolved: string[],
) => {
  if (!category) return name;
  const displayName = attribute(category, "displayName");

  if (!displayName) return name;

  return displayNameFor(category, strings, unresolved, name);
};

const resolveCategoryPath = (
  parentRef: string | undefined,
  categories: ReadonlyMap<string, { name: string; displayName: string; parent?: string }>,
  warnings: string[],
) => {
  const names: string[] = [];
  const displayNames: string[] = [];
  const seen = new Set<string>();
  let current = parentRef;

  while (current) {
    if (seen.has(current)) {
      if (warnings.length < MAX_WARNINGS)
        warnings.push(`Category "${current}" is its own ancestor; the path was cut short.`);

      break;
    }

    seen.add(current);

    const category = categories.get(current) ?? categories.get(localName(current));

    if (!category) {
      if (warnings.length < MAX_WARNINGS)
        warnings.push(`Category "${current}" is referenced but not defined.`);

      break;
    }

    names.unshift(category.name);
    displayNames.unshift(category.displayName);
    current = category.parent;
  }

  return { names, displayNames };
};

const elementLabel = (id: string, part: AdmxPresentationPart | undefined) => {
  if (!part) return id;

  return part.label ?? part.text ?? id;
};

const isBooleanTrue = (value: string | undefined) => value?.toLowerCase() === "true";

type ParsedElements = { elements: AdmxElement[]; unsupported: string[] };

const parseElements = (
  policy: XmlElement,
  parts: readonly AdmxPresentationPart[],
  strings: StringTable,
  unresolved: string[],
  warnings: string[],
): ParsedElements => {
  const container = firstChildNamed(policy, "elements");

  if (!container) return { elements: [], unsupported: [] };

  const elements: AdmxElement[] = [];
  const unsupported: string[] = [];
  const seen = new Set<string>();
  const partFor = (id: string) => parts.find((part) => part.refId === id);

  for (const child of container.children) {
    const kind = elementKind(child.name);

    if (!kind) {
      unsupported.push(`Unknown element <${child.name}>`);
      continue;
    }

    const id = attribute(child, "id");

    if (!id) {
      unsupported.push(`A <${child.name}> element has no id`);
      continue;
    }

    if (seen.has(id)) {
      unsupported.push(`Element id "${id}" is defined more than once`);
      continue;
    }

    seen.add(id);

    const part = partFor(id);
    const key = attribute(child, "key");
    const valueName = attribute(child, "valueName");
    const minValue = attribute(child, "minValue");
    const maxValue = attribute(child, "maxValue");
    const elementUnsupported: string[] = [];
    let items: AdmxEnumItem[] | undefined;

    if (kind === "enum" || kind === "list") {
      const parsed: AdmxEnumItem[] = [];

      for (const [index, item] of childrenNamed(child, "item").entries()) {
        const displayName =
          attribute(item, "displayName") !== undefined
            ? displayNameFor(item, strings, unresolved, `Item ${index + 1}`)
            : part?.items?.[index] ?? `Item ${index + 1}`;

        const valueElement = firstChildNamed(item, "value");

        if (firstChildNamed(item, "valueList")) {
          elementUnsupported.push(
            `Element "${id}" uses <valueList>, which the Policy CSP payload cannot express`,
          );
          continue;
        }

        const value = parseRegistryValue(valueElement?.children[0]);

        if (!value) {
          elementUnsupported.push(`Element "${id}" has an item without a value`);
          continue;
        }

        if (value.kind === "delete") {
          elementUnsupported.push(
            `Element "${id}" has an item that deletes a value, which the CSP payload cannot express`,
          );
          continue;
        }

        parsed.push({ displayName, value });
      }

      if (kind === "enum" && parsed.length === 0)
        elementUnsupported.push(`Enum element "${id}" has no values`);

      if (kind === "list" && parsed.length === 0)
        elementUnsupported.push(`List element "${id}" has no values`);

      if (parsed.length > 0) items = parsed;
    }

    if (kind === "boolean" && (firstChildNamed(child, "trueList") || firstChildNamed(child, "falseList")))
      elementUnsupported.push(
        `Boolean element "${id}" uses <trueList>/<falseList>, which is not supported`,
      );

    if (kind === "multiText" && warnings.length < MAX_WARNINGS)
      warnings.push(`Element "${id}" uses the deprecated <multiText> element.`);

    const element: AdmxElement = {
      id,
      kind,
      label: elementLabel(id, part),
      description: "",
      required: isBooleanTrue(attribute(child, "required")),
      ...(key ? { key } : {}),
      ...(valueName ? { valueName } : {}),
      ...(minValue ? { minValue } : {}),
      ...(maxValue ? { maxValue } : {}),
      ...(part?.defaultItem !== undefined ? { defaultItem: part.defaultItem } : {}),
      ...(part?.defaultValue !== undefined ? { defaultValue: part.defaultValue } : {}),
      ...(items ? { items } : {}),
      ...(elementUnsupported.length > 0 ? { unsupported: elementUnsupported } : {}),
    };

    if (elementUnsupported.length > 0) unsupported.push(...elementUnsupported);

    elements.push(element);
  }

  // Follow the ADML presentation order for display. Elements without a
  // presentation part keep their template order and move to the end.
  const order = new Map<string, number>();

  parts.forEach((part, index) => {
    if (part.refId && !order.has(part.refId)) order.set(part.refId, index);
  });

  elements.sort((left, right) => {
    const leftOrder = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    return leftOrder - rightOrder;
  });

  return { elements, unsupported };
};

const parseClass = (policy: XmlElement, warnings: string[]): AdmxPolicyClass => {
  const value = attribute(policy, "class")?.toLowerCase();

  if (value === "user" || value === "machine" || value === "both") return value;

  if (warnings.length < MAX_WARNINGS)
    warnings.push(
      value
        ? `Policy "${attribute(policy, "name") ?? "unknown"}" has unknown class "${value}"; treated as machine.`
        : `Policy "${attribute(policy, "name") ?? "unknown"}" has no class; treated as machine.`,
    );

  return "machine";
};

export type ParseAdmxOptions = {
  readonly fileName?: string;
};

/**
 * Parse one ADMX file and its matching ADML file.
 *
 * `admlText` is optional: without it every label falls back to the string id,
 * which is ugly but unambiguous. Passing a malformed ADML is an error because
 * the file was explicitly provided and silently ignoring it would hide a
 * mismatched pair.
 */
export const parseAdmxFile = (
  admxText: string,
  admlText?: string,
  options: ParseAdmxOptions = {},
): AdmxFile => {
  if (bytesOverLimit(admxText, ADMX_LIMITS.maxFileBytes))
    throw new AdmxImportError(
      "file-too-large",
      `${options.fileName ?? "The ADMX file"} is larger than 1 MiB.`,
    );

  if (admlText !== undefined && bytesOverLimit(admlText, ADMX_LIMITS.maxFileBytes))
    throw new AdmxImportError("file-too-large", "The ADML file is larger than 1 MiB.");

  const admx = parseXml(admxText);

  if (admx.name.toLowerCase() !== "policydefinitions")
    throw new AdmxImportError(
      "wrong-root",
      `Expected <policyDefinitions> as the ADMX root, found <${admx.name}>.`,
    );

  const warnings: string[] = [];
  const unresolved: string[] = [];

  let strings: StringTable = new Map();
  let presentationTable: PresentationTable = new Map();

  if (admlText !== undefined && admlText.trim() !== "") {
    const adml = parseXml(admlText);

    if (adml.name.toLowerCase() !== "policydefinitionresources")
      throw new AdmxImportError(
        "wrong-root",
        `Expected <policyDefinitionResources> as the ADML root, found <${adml.name}>.`,
      );

    strings = readStringTable(adml);
    presentationTable = readPresentationTable(adml);
  } else if (warnings.length < MAX_WARNINGS) {
    warnings.push(
      "No matching ADML file was provided; policy and element labels fall back to their template ids.",
    );
  }

  const namespaceElement = firstChildNamed(
    firstChildNamed(admx, "policyNamespaces"),
    "target",
  );

  const categories = new Map<string, { name: string; displayName: string; parent?: string }>();

  for (const category of childrenNamed(firstChildNamed(admx, "categories"), "category")) {
    const name = attribute(category, "name");

    if (!name) {
      if (warnings.length < MAX_WARNINGS) warnings.push("A <category> without a name was ignored.");

      continue;
    }

    const parent = attribute(firstChildNamed(category, "parentCategory"), "ref");
    const label = categoryLabel(category, name, strings, unresolved);

    categories.set(name, { name, displayName: label, ...(parent ? { parent } : {}) });
  }

  const policiesElement = firstChildNamed(admx, "policies");
  const policyElements = childrenNamed(policiesElement, "policy");

  if (policyElements.length > ADMX_LIMITS.maxPoliciesPerFile)
    throw new AdmxImportError(
      "too-many-policies",
      `${options.fileName ?? "The ADMX file"} defines ${policyElements.length.toLocaleString()} policies; the limit is ${ADMX_LIMITS.maxPoliciesPerFile.toLocaleString()}.`,
    );

  const policies: AdmxPolicy[] = [];

  for (const policy of policyElements) {
    const name = attribute(policy, "name");

    if (!name) {
      if (warnings.length < MAX_WARNINGS) warnings.push("A <policy> without a name was ignored.");

      continue;
    }

    const className = parseClass(policy, warnings);
    const displayName = displayNameFor(policy, strings, unresolved, name);

    const description = resolveString(
      attribute(policy, "explainText"),
      strings,
      unresolved,
      "",
    );

    const parts = presentationParts(policy, presentationTable);
    const { elements, unsupported } = parseElements(policy, parts, strings, unresolved, warnings);
    const parentRef = attribute(firstChildNamed(policy, "parentCategory"), "ref");
    const { names, displayNames } = resolveCategoryPath(parentRef, categories, warnings);

    const valueContainer = (containerName: "enabledValue" | "disabledValue") => {
      const container = firstChildNamed(policy, containerName);

      if (!container) return undefined;

      const value = parseRegistryValue(container.children[0]);

      // The MDM payload is <enabled/>/<disabled/>; the template's own
      // enabledValue is informational, so an unusual value type is a warning
      // rather than a reason to refuse the policy.
      if (!value && warnings.length < MAX_WARNINGS)
        warnings.push(`<${containerName}> uses a value type this importer cannot display.`);

      return value;
    };

    const enabledValue = valueContainer("enabledValue");
    const disabledValue = valueContainer("disabledValue");

    const listValues = (containerName: "enabledList" | "disabledList") => {
      const container = firstChildNamed(policy, containerName);

      if (!container) return undefined;

      const items = childrenNamed(container, "item").flatMap((item) => {
        const parsed = parseRegistryItem(item);

        return parsed ? [parsed] : [];
      });

      if (items.length !== childrenNamed(container, "item").length && warnings.length < MAX_WARNINGS)
        warnings.push(`<${containerName}> contains an item this importer cannot display.`);

      return items.length > 0 ? items : undefined;
    };

    const enabledList = listValues("enabledList");
    const disabledList = listValues("disabledList");
    const key = attribute(policy, "key") ?? "";
    const valueName = attribute(policy, "valueName");
    const supportedOn = attribute(firstChildNamed(policy, "supportedOn"), "ref");

    if (!key && warnings.length < MAX_WARNINGS)
      warnings.push(`Policy "${name}" has no registry key; it can still be set through MDM.`);

    policies.push({
      name,
      className,
      displayName,
      description,
      key,
      ...(valueName ? { valueName } : {}),
      categoryPath: names,
      categoryDisplayPath: displayNames,
      presentations: parts,
      elements,
      ...(enabledValue ? { enabledValue } : {}),
      ...(disabledValue ? { disabledValue } : {}),
      ...(enabledList ? { enabledList } : {}),
      ...(disabledList ? { disabledList } : {}),
      ...(supportedOn ? { supportedOn } : {}),
      unsupported,
    });
  }

  const namespace = attribute(namespaceElement, "namespace");
  const prefix = attribute(namespaceElement, "prefix");

  return {
    fileName: options.fileName ?? "uploaded.admx",
    ...(namespace ? { namespace } : {}),
    ...(prefix ? { prefix } : {}),
    policies,
    unresolvedStrings: unresolved,
    warnings: warnings.slice(0, MAX_WARNINGS),
  };
};
