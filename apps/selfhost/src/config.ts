import { readFile } from "node:fs/promises";
import path from "node:path";

/** A Worker module type, matching the manifest `cf build` writes. */
export type ModuleType =
  | "esm"
  | "cjs"
  | "json"
  | "text"
  | "wasm"
  | "data"
  | "python"
  | "python-requirement"
  | "sourcemap";

export interface ManifestModule {
  type: ModuleType;
  contents?: string | Uint8Array;
  [key: string]: unknown;
}

/** A fully expanded module, with its contents inlined for workerd. */
export interface WorkerModule {
  type: ModuleType;
  contents: string | Uint8Array;
  [key: string]: unknown;
}

export interface WorkerManifest {
  mainModule: string;
  modules: Record<string, ManifestModule>;
}

/**
 * A binding as declared in `worker.config.json`. Only `type` and the text
 * `value` are read by this runtime; everything else is forwarded to Miniflare
 * untouched.
 */
export interface Binding {
  type: string;
  value?: unknown;
  [key: string]: unknown;
}

export interface WorkerTrigger {
  type: string;
  schedule?: string;
  [key: string]: unknown;
}

export interface AssetsOptions {
  directory?: string;
  hasUserWorker?: boolean;
  notFoundHandling?: "none" | "404-page" | "single-page-application";
  [key: string]: unknown;
}

export interface WorkerConfig {
  name: string;
  compatibilityDate: string;
  triggers?: WorkerTrigger[];
  env?: Record<string, Binding>;
  manifest: WorkerManifest;
  assets?: AssetsOptions;
  // Deployment-only options (`placement`, `observability`, ...) are forwarded.
  [key: string]: unknown;
}

export interface WorkerDeployment {
  directory: string;
  config: WorkerConfig;
}

export type BindingEntry = [name: string, binding: Binding];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const MODULE_TYPES: readonly string[] = [
  "esm",
  "cjs",
  "json",
  "text",
  "wasm",
  "data",
  "python",
  "python-requirement",
  "sourcemap",
];

const isModuleType = (value: string): value is ModuleType => MODULE_TYPES.includes(value);

const parseModules = (value: unknown): Record<string, ManifestModule> => {
  if (!isRecord(value)) throw new Error("worker.config.json manifest.modules must be an object");

  const modules: Record<string, ManifestModule> = {};

  for (const [name, spec] of Object.entries(value)) {
    if (!isRecord(spec) || typeof spec.type !== "string")
      throw new Error(`worker.config.json module "${name}" is malformed`);

    if (!isModuleType(spec.type))
      throw new Error(`worker.config.json module "${name}" has an unknown type`);

    // The build manifest is partial: contents are inlined by `loadManifest`.
    modules[name] = { ...spec, type: spec.type };
  }

  return modules;
};

const parseBinding = (name: string, value: unknown): Binding => {
  if (!isRecord(value) || typeof value.type !== "string")
    throw new Error(`worker.config.json binding "${name}" is missing a type`);

  if (value.type === "text" && typeof value.value !== "string")
    throw new Error(`worker.config.json binding "${name}" is missing a text value`);

  return { ...value, type: value.type };
};

const parseBindings = (value: unknown): Record<string, Binding> => {
  if (!isRecord(value)) throw new Error("worker.config.json env must be an object");

  const bindings: Record<string, Binding> = {};

  for (const [name, spec] of Object.entries(value)) bindings[name] = parseBinding(name, spec);

  return bindings;
};

const parseTriggers = (value: unknown): WorkerTrigger[] => {
  if (!Array.isArray(value)) throw new Error("worker.config.json triggers must be an array");

  return value.map((trigger: unknown): WorkerTrigger => {
    if (!isRecord(trigger) || typeof trigger.type !== "string")
      throw new Error("worker.config.json trigger is malformed");

    if (trigger.type === "scheduled" && typeof trigger.schedule !== "string")
      throw new Error("worker.config.json scheduled trigger is missing a schedule");

    return {
      ...trigger,
      type: trigger.type,
      ...(typeof trigger.schedule === "string" ? { schedule: trigger.schedule } : {}),
    };
  });
};

const parseAssets = (value: unknown): AssetsOptions => {
  if (!isRecord(value)) throw new Error("worker.config.json assets must be an object");

  // The build config may omit `directory`; the runtime supplies the staged one.
  return {
    ...value,
    ...(typeof value.directory === "string" ? { directory: value.directory } : {}),
    ...(typeof value.hasUserWorker === "boolean" ? { hasUserWorker: value.hasUserWorker } : {}),
  };
};

const parseWorkerConfig = (value: unknown): WorkerConfig => {
  if (!isRecord(value)) throw new Error("worker.config.json must contain an object");

  if (typeof value.name !== "string") throw new Error("worker.config.json is missing a name");

  if (typeof value.compatibilityDate !== "string")
    throw new Error("worker.config.json is missing a compatibilityDate");

  if (!isRecord(value.manifest) || typeof value.manifest.mainModule !== "string")
    throw new Error("worker.config.json is missing a manifest");

  return {
    ...value,
    name: value.name,
    compatibilityDate: value.compatibilityDate,
    manifest: {
      mainModule: value.manifest.mainModule,
      modules: parseModules(value.manifest.modules),
    },
    ...(value.env === undefined ? {} : { env: parseBindings(value.env) }),
    ...(value.triggers === undefined ? {} : { triggers: parseTriggers(value.triggers) }),
    ...(value.assets === undefined ? {} : { assets: parseAssets(value.assets) }),
  };
};

/**
 * Read the deployment configuration written by `cf build`
 * (`worker.config.json`) so the self-hosted runtime follows
 * `cloudflare.config.ts` instead of drifting from it.
 */
export const readWorkerConfig = async (directory: string): Promise<WorkerDeployment> => {
  const raw = await readFile(path.join(directory, "worker.config.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);

  return { directory, config: parseWorkerConfig(parsed) };
};

export const findBinding = (config: WorkerConfig, type: string): BindingEntry | undefined =>
  Object.entries(config.env ?? {}).find(([, spec]) => spec.type === type);
