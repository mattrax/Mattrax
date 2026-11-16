import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { parse } from "yaml";

/**
 * Build the open-source licence inventory for the dashboard.
 *
 * The dependency graph comes from `pnpm-lock.yaml`: every non-dev dependency of
 * every workspace project, followed transitively through the lockfile
 * snapshots. Workspace packages are the product itself, not third-party
 * notices. For each package the installed `package.json` supplies the declared
 * SPDX licence and the package directory supplies the licence text that MIT,
 * BSD and Apache notices require us to reproduce.
 *
 * Output is deterministic: packages are sorted and identical texts are stored
 * once, keyed by their SHA-256.
 */

/** One entry in the generated inventory. */
interface LicenceEntry {
  name: string;
  version: string;
  license: string;
  repository?: string;
  text?: string;
}

interface LicenceOutput {
  packages: LicenceEntry[];
  texts: Record<string, string>;
}

const root = fileURLToPath(new URL("..", import.meta.url));

const isString = Schema.is(Schema.String);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The lockfile is parsed YAML; these helpers narrow each value it reads. */
const rawLock: unknown = parse(await readFile(path.join(root, "pnpm-lock.yaml"), "utf8"));

const lock = isRecord(rawLock) ? rawLock : {};

const importers = isRecord(lock.importers) ? lock.importers : {};

const snapshots = isRecord(lock.snapshots) ? lock.snapshots : {};

const dependenciesOf = (importer: unknown): [string, unknown][] => {
  const record = isRecord(importer) ? importer : {};
  const required = isRecord(record.dependencies) ? record.dependencies : {};
  const optional = isRecord(record.optionalDependencies) ? record.optionalDependencies : {};

  return Object.entries({ ...required, ...optional });
};

const importerVersion = (dependency: unknown): string | undefined =>
  isRecord(dependency) && isString(dependency.version) ? dependency.version : undefined;

const snapshotVersion = (dependency: unknown): string | undefined => {
  if (isString(dependency)) return dependency;

  return isRecord(dependency) && isString(dependency.version) ? dependency.version : undefined;
};

const queue: { name: string; version: string }[] = [];

for (const [project, importer] of Object.entries(importers)) {
  // The workspace root only holds build tooling; it is not shipped.
  if (project === ".") continue;

  for (const [name, dependency] of dependenciesOf(importer)) {
    const version = importerVersion(dependency);

    if (!version || version.startsWith("link:")) continue;
    queue.push({ name, version });
  }
}

const reached = new Map<string, { name: string; version: string }>();

const seen = new Set<string>();

while (queue.length > 0) {
  const dependency = queue.pop();

  if (!dependency) break;

  const key = `${dependency.name}@${dependency.version}`;

  if (seen.has(key)) continue;

  seen.add(key);

  if (dependency.name.startsWith("@mattrax/")) continue;

  const snapshot = snapshots[key];

  if (!isRecord(snapshot)) continue;

  reached.set(key, { name: dependency.name, version: dependency.version });

  const required = isRecord(snapshot.dependencies) ? snapshot.dependencies : {};
  const optional = isRecord(snapshot.optionalDependencies) ? snapshot.optionalDependencies : {};

  for (const [name, child] of Object.entries({ ...required, ...optional })) {
    // Snapshot dependencies are plain version strings; importer entries are
    // `{ specifier, version }` objects.
    const version = snapshotVersion(child);

    if (!version || version.startsWith("link:")) continue;
    queue.push({ name, version });
  }
}

const storeEntries = await readdir(path.join(root, "node_modules/.pnpm"));

const storeByPackage = new Map<string, string[]>();

for (const entry of storeEntries) {
  // Folder name: `<name>@<version>` followed by an optional peer suffix `(...)`
  // or `_<peer>`. Scoped names start with `@`, so skip that first character
  // when looking for the version separator.
  const at = entry.startsWith("@") ? entry.indexOf("@", 1) : entry.indexOf("@");

  if (at <= 0) continue;
  const name = entry.slice(0, at).replaceAll("+", "/");
  const versions = storeByPackage.get(name) ?? [];

  versions.push(entry);
  storeByPackage.set(name, versions);
}

const licenceFiles = /^(licen[cs]e|copying|notice)(\..*)?$/i;

const readLicenceText = async (directory: string): Promise<string | undefined> => {
  let entries: string[];

  try {
    entries = await readdir(directory);
  } catch {
    return undefined;
  }

  const file = entries.find((entry) => licenceFiles.test(entry));

  if (!file) return undefined;

  try {
    return (await readFile(path.join(directory, file), "utf8")).trim();
  } catch {
    return undefined;
  }
};

const declaredLicence = (manifest: Record<string, unknown>): string => {
  if (isString(manifest.license)) return manifest.license;

  if (isRecord(manifest.license) && isString(manifest.license.type)) return manifest.license.type;

  if (Array.isArray(manifest.licenses)) {
    const licenses: unknown[] = manifest.licenses;
    const values: string[] = [];

    for (const entry of licenses) {
      if (isString(entry)) values.push(entry);
      else if (isRecord(entry) && isString(entry.type)) values.push(entry.type);
    }

    return values.join(" OR ");
  }

  return "UNKNOWN";
};

const repositoryUrl = (manifest: Record<string, unknown>): string | undefined => {
  const repository = manifest.repository;

  if (isString(repository)) return repository;

  return isRecord(repository) && isString(repository.url) ? repository.url : undefined;
};

const packages: LicenceEntry[] = [];

const texts = new Map<string, string>();

for (const { name, version } of reached.values()) {
  const candidates = storeByPackage.get(name) ?? [];
  // Importer versions carry a parenthesised peer suffix; pnpm folder names
  // replace that suffix with `_`-joined encoded peer ids.
  const prefix = `${name.replaceAll("/", "+")}@${version.split("(")[0]}`;

  const directoryName =
    candidates.find((entry) => entry === prefix) ??
    candidates.find((entry) => entry.startsWith(`${prefix}(`) || entry.startsWith(`${prefix}_`));

  if (!directoryName) continue;

  const directory = path.join(root, "node_modules/.pnpm", directoryName, "node_modules", name);
  let manifest: unknown;

  try {
    // SAFETY: package.json is third-party metadata; every field read from the
    // parsed record is narrowed for type and stringness below.
    manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")) as unknown;
  } catch {
    continue;
  }

  const manifestRecord = isRecord(manifest) ? manifest : {};
  const text = await readLicenceText(directory);
  const digest = text ? createHash("sha256").update(text).digest("hex") : undefined;

  if (digest && text) texts.set(digest, text);

  const entry: LicenceEntry = {
    name,
    version: isString(manifestRecord.version) ? manifestRecord.version : version,
    license: declaredLicence(manifestRecord),
  };

  const repository = repositoryUrl(manifestRecord);

  if (repository) entry.repository = repository;

  if (digest) entry.text = digest;

  packages.push(entry);
}

packages.sort((left, right) =>
  left.name === right.name
    ? left.version.localeCompare(right.version)
    : left.name.localeCompare(right.name),
);

const output: LicenceOutput = {
  packages,
  texts: Object.fromEntries([...texts].sort(([left], [right]) => left.localeCompare(right))),
};

const target = path.join(root, "apps/web/public/licenses.json");

await writeFile(target, `${JSON.stringify(output, null, 2)}\n`);

const withoutText = packages.filter((entry) => !entry.text).length;

console.log(
  `Generated licences for ${packages.length} packages (${texts.size} distinct notices, ${withoutText} without a bundled text) in ${path.relative(root, target)}`,
);
