import { Schema } from "effect";
import {
  collectionProperties,
  type Collection,
  type PlatformId,
  type Property,
} from "./catalog";
import {
  valueKey as storageValueKey,
  type PolicyValue,
  type Selection,
} from "./build";

/**
 * CIS benchmark templates.
 *
 * The committed source templates live in `data/cis`. They are deliberately
 * small: a benchmark id, our own short descriptions of the controls, and the
 * catalogue setting (or settings) that implement each control. CIS prose is
 * never copied; only the control reference and our own wording ship here.
 *
 * `pnpm cis:templates` validates every mapping against the committed
 * catalogue and writes the assets under `apps/web/public/catalog/cis`. The
 * generator is the source of truth, so a catalogue update is caught by
 * `pnpm cis:check` rather than surfacing as a silent no-op in the designer.
 */

export const CIS_SOURCE_FORMAT = 1;

export const CIS_PLATFORMS = ["apple", "windows", "android"] as const;

export const CisPlatform = Schema.Literals(CIS_PLATFORMS);

export type CisPlatform = typeof CisPlatform.Type;

export const CisBenchmark = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  source: Schema.String,
  os: Schema.optional(Schema.String),
});

export type CisBenchmark = typeof CisBenchmark.Type;

export const CisMappingSource = Schema.Struct({
  /** Catalogue collection id, for example `windows/settings/device-lock`. */
  collection: Schema.String,
  /** Catalogue property key. */
  setting: Schema.String,
  /**
   * Windows OMA-URI. Required when the same property key appears more than once
   * in a collection (one per firewall profile, for example).
   */
  address: Schema.optional(Schema.String),
  value: Schema.Json,
});

export type CisMappingSource = typeof CisMappingSource.Type;

export const CisControlSource = Schema.Struct({
  /** CIS recommendation reference, for example `2.3.10.10`. */
  id: Schema.String,
  /** Benchmark profile the recommendation belongs to. */
  level: Schema.optional(Schema.Literals(["L1", "L2"])),
  /** Short, our own wording. */
  title: Schema.String,
  /** One or two sentences in our own words. */
  description: Schema.String,
  /** Why a control has no mapping, or a caveat about the mapping. */
  note: Schema.optional(Schema.String),
  mappings: Schema.Array(CisMappingSource),
});

export type CisControlSource = typeof CisControlSource.Type;

export const CisTemplateSource = Schema.Struct({
  format: Schema.Literal(CIS_SOURCE_FORMAT),
  /** Stable slug, also the generated file name. */
  id: Schema.String,
  platform: CisPlatform,
  benchmark: CisBenchmark,
  /** Our own overview of what the template covers. */
  description: Schema.String,
  controls: Schema.Array(CisControlSource),
});

export type CisTemplateSource = typeof CisTemplateSource.Type;

const CisDisplayValue = Schema.String;

export const CompiledCisSetting = Schema.Struct({
  collection: Schema.String,
  collectionName: Schema.String,
  setting: Schema.String,
  settingName: Schema.String,
  /** The exact key a designer selection stores (`address` on Windows). */
  valueKey: Schema.String,
  address: Schema.optional(Schema.String),
  value: Schema.Json,
  displayValue: CisDisplayValue,
});

export type CompiledCisSetting = typeof CompiledCisSetting.Type;

export const CompiledCisControl = Schema.Struct({
  id: Schema.String,
  level: Schema.optional(Schema.Literals(["L1", "L2"])),
  title: Schema.String,
  description: Schema.String,
  note: Schema.optional(Schema.String),
  mapped: Schema.Boolean,
  settings: Schema.Array(CompiledCisSetting),
});

export type CompiledCisControl = typeof CompiledCisControl.Type;

export const CompiledCisStats = Schema.Struct({
  controls: Schema.Number,
  mapped: Schema.Number,
  settings: Schema.Number,
});

export type CompiledCisStats = typeof CompiledCisStats.Type;

export const CompiledCisTemplate = Schema.Struct({
  format: Schema.Literal(CIS_SOURCE_FORMAT),
  id: Schema.String,
  platform: CisPlatform,
  benchmark: CisBenchmark,
  description: Schema.String,
  stats: CompiledCisStats,
  controls: Schema.Array(CompiledCisControl),
});

export type CompiledCisTemplate = typeof CompiledCisTemplate.Type;

export const CisTemplateSummary = Schema.Struct({
  id: Schema.String,
  platform: CisPlatform,
  benchmark: CisBenchmark,
  description: Schema.String,
  stats: CompiledCisStats,
  file: Schema.String,
});

export type CisTemplateSummary = typeof CisTemplateSummary.Type;

export const CisTemplateIndex = Schema.Struct({
  format: Schema.Literal(CIS_SOURCE_FORMAT),
  templates: Schema.Array(CisTemplateSummary),
});

export type CisTemplateIndex = typeof CisTemplateIndex.Type;

/** Catalogue collections, indexed by id, for one platform. */
export interface CisCatalogue {
  readonly platform: PlatformId;
  readonly collections: ReadonlyMap<string, Collection>;
}

export type CisCatalogues = Readonly<Record<PlatformId, CisCatalogue>>;

export class CisTemplateError extends Error {
  readonly problems: ReadonlyArray<string>;

  constructor(problems: ReadonlyArray<string>) {
    super(problems.join("\n"));
    this.name = "CisTemplateError";
    this.problems = problems;
  }
}

const isRecord = (value: Schema.Json): value is Schema.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPlainObject = (value: Schema.Json): value is Schema.JsonObject => {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
};

const decodeSource = (input: Schema.Json): CisTemplateSource => {
  if (!isRecord(input)) throw new CisTemplateError(["The template must be a JSON object."]);

  const platform = input.platform;

  if (platform !== "apple" && platform !== "windows" && platform !== "android")
    throw new CisTemplateError([
      `Unsupported platform ${JSON.stringify(platform)}; expected apple, windows or android.`,
    ]);

  try {
    return Schema.decodeUnknownSync(CisTemplateSource)(input);
  } catch (error) {
    throw new CisTemplateError([
      `The template does not match format ${CIS_SOURCE_FORMAT}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ]);
  }
};

/**
 * Resolve a mapping to a catalogue property.
 *
 * A property key can repeat inside one collection (the Windows firewall
 * exposes `EnableFirewall` per profile). Those mappings must name the address
 * so the generated asset applies the same setting the source author chose.
 */
type ResolvedProperty = { readonly property: Property } | { readonly problem: string };

const resolveProperty = (
  collection: Collection,
  mapping: CisMappingSource,
): ResolvedProperty => {
  const matches = collectionProperties(collection).filter(
    (property) => property.key === mapping.setting,
  );

  if (matches.length === 0)
    return { problem: `Unknown setting "${mapping.setting}" in "${collection.id}".` };

  if (mapping.address !== undefined) {
    const match = matches.find((property) => property.address === mapping.address);

    if (!match)
      return {
        problem: `Setting "${mapping.setting}" in "${collection.id}" has no address "${mapping.address}".`,
      };

    return { property: match };
  }

  if (matches.length > 1)
    return {
      problem: `Setting "${mapping.setting}" in "${collection.id}" is ambiguous; add "address".`,
    };

  return { property: matches[0]! };
};

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const enumScalar = (value: PolicyValue): string | undefined => {
  if (Schema.is(Schema.String)(value)) return value;

  if (Schema.is(Schema.Number)(value)) return String(value);

  if (Schema.is(Schema.Boolean)(value)) return value ? "true" : "false";

  return undefined;
};

const validateValue = (property: Property, value: PolicyValue): string | undefined => {
  if (value === undefined || value === null)
    return `"${property.key}" needs a value. The source file must provide one.`;

  if (property.enum && property.enum.length > 0) {
    const values = property.enum.map((option) => option.value);

    if (property.type === "array") {
      if (!Array.isArray(value)) return `"${property.key}" must be a list.`;

      for (const item of value) {
        const candidate = enumScalar(item);

        if (candidate === undefined || !values.includes(candidate))
          return `"${property.key}" may only contain ${values.join(", ")} (received ${JSON.stringify(item)}).`;
      }

      return undefined;
    }

    const scalar = enumScalar(value);
    const candidates = scalar === undefined ? [] : [scalar];

    if (Schema.is(Schema.Boolean)(value)) candidates.push(value ? "1" : "0");

    if (candidates.some((candidate) => values.includes(candidate))) return undefined;

    return `"${property.key}" must be one of ${values.join(", ")} (received ${JSON.stringify(value)}).`;
  }

  switch (property.type) {
    case "boolean":
      return Schema.is(Schema.Boolean)(value)
        ? undefined
        : `"${property.key}" must be a boolean.`;
    case "integer": {
      if (!Schema.is(Schema.Number)(value) || !Number.isInteger(value))
        return `"${property.key}" must be a whole number.`;

      if (property.min !== undefined && value < property.min)
        return `"${property.key}" must be at least ${property.min} (received ${value}).`;

      if (property.max !== undefined && value > property.max)
        return `"${property.key}" must be at most ${property.max} (received ${value}).`;

      return undefined;
    }

    case "real":
      return Schema.is(Schema.Number)(value)
        ? undefined
        : `"${property.key}" must be a number.`;
    case "string": {
      if (!Schema.is(Schema.String)(value)) return `"${property.key}" must be a string.`;

      if (property.pattern) {
        try {
          if (!new RegExp(property.pattern).test(value))
            return `"${property.key}" does not match ${property.pattern}.`;
        } catch {
          // A malformed catalogue pattern cannot be held against the template.
        }
      }

      return undefined;
    }

    case "data":
      return Schema.is(Schema.String)(value) && BASE64.test(value.replace(/\s/g, ""))
        ? undefined
        : `"${property.key}" must be a base64 string.`;
    case "date":
      return Schema.is(Schema.String)(value)
        ? undefined
        : `"${property.key}" must be a date string.`;
    case "array":
      return Array.isArray(value) ? undefined : `"${property.key}" must be a list.`;
    case "dictionary":
      return isPlainObject(value) ? undefined : `"${property.key}" must be an object.`;
    case "enum":
      return `"${property.key}" has an invalid enum constraint.`;
    case "unknown":
      return undefined;
  }
};

export const cisDisplayValue = (value: PolicyValue): string => {
  if (value === null) return "Empty";

  if (Schema.is(Schema.Boolean)(value)) return value ? "On" : "Off";

  if (Array.isArray(value)) return value.length === 0 ? "Empty list" : JSON.stringify(value);

  if (Schema.is(Schema.String)(value)) return value;

  if (Schema.is(Schema.Number)(value)) return String(value);

  return JSON.stringify(value);
};

/**
 * Compile one source template against the platform catalogue. Throws a
 * `CisTemplateError` containing every problem, so the generator reports all
 * stale or invalid mappings in one run.
 */
export const compileCisTemplate = (
  input: Schema.Json,
  catalogues: CisCatalogues,
): CompiledCisTemplate => {
  const source = decodeSource(input);
  const catalogue = catalogues[source.platform];
  const problems: string[] = [];
  const seenIds = new Set<string>();
  const appleKinds = new Set<Collection["kind"]>();

  const controls = source.controls.map((control): CompiledCisControl => {
    const controlProblems: string[] = [];

    if (seenIds.has(control.id))
      controlProblems.push(`Duplicate control id "${control.id}".`);
    seenIds.add(control.id);

    const settings: CompiledCisSetting[] = [];
    const seenSettings = new Set<string>();

    for (const mapping of control.mappings) {
      const collection = catalogue.collections.get(mapping.collection);

      if (!collection) {
        controlProblems.push(
          `${control.id}: unknown collection "${mapping.collection}" for ${source.platform}.`,
        );

        continue;
      }

      const resolved = resolveProperty(collection, mapping);

      if ("problem" in resolved) {
        controlProblems.push(`${control.id}: ${resolved.problem}`);

        continue;
      }

      if (source.platform === "apple") appleKinds.add(collection.kind);

      const property = resolved.property;

      if (source.platform === "windows" && property.address?.startsWith("./User/")) {
        controlProblems.push(
          `${control.id}: "${mapping.collection}/${property.key}" is user-scoped; CIS templates apply device scope only.`,
        );

        continue;
      }

      const invalid = validateValue(property, mapping.value);

      if (invalid) {
        controlProblems.push(`${control.id}: ${mapping.collection}/${invalid}`);

        continue;
      }

      const valueKey = storageValueKey(property, source.platform);
      const settingIdentity = `${collection.id}\u0000${valueKey}`;

      if (seenSettings.has(settingIdentity)) {
        controlProblems.push(
          `${control.id}: "${mapping.collection}/${property.key}" is mapped more than once.`,
        );

        continue;
      }

      seenSettings.add(settingIdentity);

      settings.push({
        collection: collection.id,
        collectionName: collection.name,
        setting: property.key,
        settingName: property.name,
        valueKey,
        ...(property.address === undefined ? {} : { address: property.address }),
        value: mapping.value,
        displayValue: cisDisplayValue(mapping.value),
      });
    }

    problems.push(...controlProblems);

    return {
      id: control.id,
      ...(control.level === undefined ? {} : { level: control.level }),
      title: control.title,
      description: control.description,
      ...(control.note === undefined ? {} : { note: control.note }),
      mapped: settings.length > 0,
      settings,
    };
  });

  if (source.platform === "apple" && appleKinds.size > 1)
    problems.push(
      "Apple templates cannot mix profile payloads and DDM declarations in one policy.",
    );

  if (problems.length > 0) throw new CisTemplateError(problems);

  return {
    format: CIS_SOURCE_FORMAT,
    id: source.id,
    platform: source.platform,
    benchmark: source.benchmark,
    description: source.description,
    stats: {
      controls: controls.length,
      mapped: controls.filter((control) => control.mapped).length,
      settings: controls.reduce((total, control) => total + control.settings.length, 0),
    },
    controls,
  };
};

export const cisTemplateSummary = (template: CompiledCisTemplate): CisTemplateSummary => ({
  id: template.id,
  platform: template.platform,
  benchmark: template.benchmark,
  description: template.description,
  stats: template.stats,
  file: `${template.id}.json`,
});

/** Build the index every CIS picker loads first. */
export const cisTemplateIndex = (templates: ReadonlyArray<CompiledCisTemplate>): CisTemplateIndex => ({
  format: CIS_SOURCE_FORMAT,
  templates: [...templates]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(cisTemplateSummary),
});

export const cisControlIds = (template: CompiledCisTemplate): string[] =>
  template.controls.filter((control) => control.mapped).map((control) => control.id);

export const cisMappedControlIds = (template: CompiledCisTemplate): ReadonlySet<string> =>
  new Set(cisControlIds(template));

const findCollection = (
  template: CompiledCisTemplate,
  id: string,
  collections: ReadonlyMap<string, Collection>,
) => {
  const collection = collections.get(id);

  if (!collection)
    throw new CisTemplateError([
      `"${template.id}" needs the "${id}" catalogue collection, but it was not loaded.`,
    ]);

  return collection;
};

const findProperty = (
  template: CompiledCisTemplate,
  setting: CompiledCisSetting,
  collection: Collection,
) => {
  const property = collectionProperties(collection).find(
    (candidate) =>
      candidate.key === setting.setting &&
      (setting.address === undefined || candidate.address === setting.address),
  );

  if (!property)
    throw new CisTemplateError([
      `"${template.id}" maps ${setting.collection}/${setting.setting}, but the loaded catalogue no longer exposes it.`,
    ]);

  const valueKey = storageValueKey(property, template.platform);

  if (valueKey !== setting.valueKey)
    throw new CisTemplateError([
      `"${template.id}" is stale for ${setting.collection}/${setting.setting}. Regenerate the CIS templates.`,
    ]);

  return property;
};

export type CisApplyResult = {
  readonly selections: Selection[];
  readonly collections: Collection[];
  readonly appliedControls: number;
  readonly appliedSettings: number;
  readonly controlIds: string[];
};

/**
 * Merge a compiled template into the selections of one platform.
 *
 * Only the settings the template names are written. Every other value already
 * on a selection is preserved, so applying a benchmark to a policy that also
 * has hand-tuned settings never removes them. A setting named by both the
 * template and the policy takes the template's value: the administrator
 * explicitly chose to apply the benchmark.
 */
export const applyCisTemplateToSelections = (options: {
  template: CompiledCisTemplate;
  controlIds: ReadonlyArray<string>;
  selections: ReadonlyArray<Selection>;
  collections: ReadonlyMap<string, Collection>;
}): CisApplyResult => {
  const { template } = options;
  const selected = new Set(options.controlIds);

  const controls = template.controls.filter(
    (control) => selected.has(control.id) && control.mapped,
  );

  if (controls.length === 0) {
    return {
      selections: [...options.selections],
      collections: [],
      appliedControls: 0,
      appliedSettings: 0,
      controlIds: [],
    };
  }

  if (template.platform === "apple") {
    const existingKinds = new Set(options.selections.map((selection) => selection.kind));

    const incomingKinds = new Set(
      controls.flatMap((control) =>
        control.settings.flatMap((setting) => {
          const collection = findCollection(template, setting.collection, options.collections);

          return [collection.kind];
        }),
      ),
    );

    if (
      (incomingKinds.has("profile") && existingKinds.has("declaration")) ||
      (incomingKinds.has("declaration") && existingKinds.has("profile"))
    )
      throw new CisTemplateError([
        "This policy already mixes Apple profiles and declarations. Remove one kind before applying the template.",
      ]);
  }

  const selections = options.selections.map((selection) => ({
    ...selection,
    values: { ...selection.values },
  }));

  const usedCollections = new Map<string, Collection>();
  const written = new Set<string>();
  let appliedControls = 0;

  for (const control of controls) {
    let applied = 0;

    for (const setting of control.settings) {
      const collection = findCollection(template, setting.collection, options.collections);
      findProperty(template, setting, collection);
      usedCollections.set(collection.id, collection);

      const selectionId = `${collection.id}#${collection.name}`;

      let selection = selections.find(
        (candidate) => candidate.collectionId.split("#")[0] === collection.id,
      );

      if (!selection) {
        selection = {
          collectionId: selectionId,
          identifier: collection.identifier,
          kind: collection.kind,
          surface: collection.surface,
          name: collection.name,
          properties: collectionProperties(collection),
          // Only the template's settings are written. Catalogue defaults stay
          // defaults: the editor still displays them, but applying a template
          // never turns an untouched default into a delivered value.
          values: {},
        };
        selections.push(selection);
      }

      selection.values[setting.valueKey] = setting.value;
      written.add(`${setting.collection}\u0000${setting.valueKey}`);
      applied += 1;
    }

    if (applied > 0) appliedControls += 1;
  }

  return {
    selections,
    collections: [...usedCollections.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    appliedControls,
    appliedSettings: written.size,
    controlIds: controls.map((control) => control.id),
  };
};

/** Unique catalogue collections a set of controls needs loaded. */
export const cisRequiredCollections = (
  template: CompiledCisTemplate,
  controlIds: ReadonlyArray<string>,
): string[] => {
  const selected = new Set(controlIds);
  const ids = new Set<string>();

  for (const control of template.controls) {
    if (!selected.has(control.id)) continue;

    for (const setting of control.settings) ids.add(setting.collection);
  }

  return [...ids].sort();
};

/**
 * Browser loaders. Assets are static and committed; the generator reads only
 * local files, so no request is made at build or test time.
 */
const fetchJson = async <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  url: string,
  label: string,
): Promise<S["Type"]> => {
  const response = await fetch(url);

  if (!response.ok) throw new Error(`Could not load ${label} (${response.status})`);

  return Schema.decodeUnknownSync(schema)(await response.json());
};

let indexPromise: Promise<CisTemplateIndex> | undefined;

const templatePromises = new Map<string, Promise<CompiledCisTemplate>>();

export const loadCisTemplateIndex = () => {
  indexPromise ??= fetchJson(CisTemplateIndex, "/catalog/cis/index.json", "CIS templates").catch(
    (error) => {
      indexPromise = undefined;
      throw error;
    },
  );

  return indexPromise;
};

export const loadCisTemplate = (summary: CisTemplateSummary) => {
  const file = summary.file;

  if (!/^[a-z0-9][a-z0-9.-]*\.json$/.test(file))
    return Promise.reject(new Error(`Invalid CIS template file ${JSON.stringify(file)}`));

  let promise = templatePromises.get(summary.id);

  if (!promise) {
    promise = fetchJson(
      CompiledCisTemplate,
      `/catalog/cis/${file}`,
      `${summary.benchmark.name} ${summary.benchmark.version}`,
    ).catch((error) => {
      templatePromises.delete(summary.id);
      throw error;
    });
    templatePromises.set(summary.id, promise);
  }

  return promise;
};

export const resetCisTemplateCache = () => {
  indexPromise = undefined;
  templatePromises.clear();
};
