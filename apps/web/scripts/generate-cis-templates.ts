#!/usr/bin/env node
/**
 * Validate and compile the CIS benchmark templates in `data/cis` into the
 * assets the policy designer loads.
 *
 *   apps/web/public/catalog/cis/index.json    benchmark summaries
 *   apps/web/public/catalog/cis/<id>.json     one compiled benchmark each
 *
 * Every mapping is checked against the committed catalogue: the collection and
 * setting must exist, the value must match the catalogue type and range, and a
 * repeated Windows property key must name its OMA-URI address. Nothing is
 * fetched from the network; the source templates and catalogues are the only
 * inputs.
 *
 *   pnpm cis:templates   write the generated assets
 *   pnpm cis:check       verify the committed assets are up to date
 *
 * Output is deterministic: sources are sorted by file name, controls keep the
 * order the source lists them in, and no timestamps are written.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Schema } from "effect";
import { PlatformData } from "../src/lib/policy-designer/catalog";
import {
  CisTemplateError,
  cisTemplateIndex,
  compileCisTemplate,
  type CisCatalogues,
  type CompiledCisTemplate,
} from "../src/lib/policy-designer/cis";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const DEFAULT_SOURCE = path.join(ROOT, "data/cis");

export const DEFAULT_OUT = path.join(ROOT, "apps/web/public/catalog/cis");

const CATALOGUE_FILES: Record<keyof CisCatalogues, string> = {
  apple: path.join(ROOT, "apps/web/public/catalog/apple.json"),
  android: path.join(ROOT, "apps/web/public/catalog/android.json"),
  windows: path.join(ROOT, "data/catalog/windows.json"),
};

export interface GenerateOptions {
  source?: string;
  out?: string;
}

interface CliOptions extends GenerateOptions {
  check: boolean;
}

const readJson = async (file: string): Promise<Schema.Json> =>
  Schema.decodeUnknownSync(Schema.Json)(JSON.parse(await readFile(file, "utf8")));

const loadCatalogues = async (): Promise<CisCatalogues> => {
  const catalogues = {} as Record<keyof CisCatalogues, CisCatalogues[keyof CisCatalogues]>;

  for (const platform of ["apple", "android", "windows"] as const) {
    const data = Schema.decodeUnknownSync(PlatformData)(await readJson(CATALOGUE_FILES[platform]));

    if (data.id !== platform)
      throw new Error(
        `${CATALOGUE_FILES[platform]} contains "${data.id}", expected "${platform}".`,
      );

    catalogues[platform] = {
      platform,
      collections: new Map(data.collections.map((collection) => [collection.id, collection])),
    };
  }

  return catalogues;
};

const readSources = async (source: string): Promise<Schema.Json[]> => {
  const names = (await readdir(source))
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(names.map((name) => readJson(path.join(source, name))));
};

/** Compile every source and reject duplicate template ids and file names. */
export const compileSources = async (
  sources: ReadonlyArray<Schema.Json>,
  catalogues: CisCatalogues,
): Promise<CompiledCisTemplate[]> => {
  const templates: CompiledCisTemplate[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const template = compileCisTemplate(source, catalogues);

    if (seen.has(template.id))
      throw new CisTemplateError([`Duplicate template id "${template.id}".`]);

    seen.add(template.id);
    templates.push(template);
  }

  return templates;
};

export interface GeneratedAssets {
  readonly files: Map<string, string>;
  readonly templates: CompiledCisTemplate[];
}

export const buildCisAssets = (templates: ReadonlyArray<CompiledCisTemplate>): GeneratedAssets => {
  const files = new Map<string, string>();

  for (const template of templates)
    files.set(`${template.id}.json`, `${JSON.stringify(template)}\n`);

  files.set("index.json", `${JSON.stringify(cisTemplateIndex(templates))}\n`);

  return { files, templates: [...templates] };
};

export const generateCisAssets = async (
  options: GenerateOptions = {},
): Promise<GeneratedAssets & { out: string }> => {
  const source = options.source ?? DEFAULT_SOURCE;
  const out = options.out ?? DEFAULT_OUT;
  const catalogues = await loadCatalogues();
  const templates = await compileSources(await readSources(source), catalogues);
  const assets = buildCisAssets(templates);

  await mkdir(out, { recursive: true });
  const existing = await readdir(out);

  for (const name of existing) {
    if (name.endsWith(".json") && !assets.files.has(name)) await rm(path.join(out, name));
  }

  for (const [name, contents] of assets.files) await writeFile(path.join(out, name), contents);

  return { ...assets, out };
};

/** Exit non-zero when the committed assets differ from a fresh build. */
export const checkCisAssets = async (options: GenerateOptions = {}): Promise<string[]> => {
  const source = options.source ?? DEFAULT_SOURCE;
  const out = options.out ?? DEFAULT_OUT;
  const catalogues = await loadCatalogues();
  const templates = await compileSources(await readSources(source), catalogues);
  const assets = buildCisAssets(templates);
  const existing = new Set(
    (await readdir(out).catch(() => [])).filter((name) => name.endsWith(".json")),
  );
  const problems: string[] = [];

  for (const [name, contents] of assets.files) {
    if (!existing.has(name)) {
      problems.push(`missing ${name}`);

      continue;
    }

    if ((await readFile(path.join(out, name), "utf8")) !== contents) problems.push(`stale ${name}`);
  }

  for (const name of existing) if (!assets.files.has(name)) problems.push(`unexpected ${name}`);

  return problems;
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = { check: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--check") options.check = true;
    else if (arg === "--source") options.source = path.resolve(argv[++index]!);
    else if (arg === "--out") options.out = path.resolve(argv[++index]!);
    else throw new Error(`Unknown argument ${arg}`);
  }

  return options;
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));

  if (options.check) {
    const problems = await checkCisAssets(options);

    if (problems.length > 0) {
      console.error(`The generated CIS templates are out of date:\n  ${problems.join("\n  ")}`);
      process.exit(1);
    }

    console.log("The generated CIS templates are up to date.");

    return;
  }

  const { templates, out } = await generateCisAssets(options);

  console.log(`Wrote ${templates.length} CIS templates to ${path.relative(ROOT, out)}`);

  for (const template of templates)
    console.log(
      `  ${template.id}: ${template.stats.mapped}/${template.stats.controls} controls mapped (${template.stats.settings} settings)`,
    );
};

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    if (error instanceof CisTemplateError) {
      console.error(`CIS template validation failed:\n  ${error.problems.join("\n  ")}`);
    } else console.error(error);

    process.exit(1);
  });
}
