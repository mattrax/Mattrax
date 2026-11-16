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

const root = fileURLToPath(new URL("..", import.meta.url));
const isString = Schema.is(Schema.String);
const lock = parse(await readFile(path.join(root, "pnpm-lock.yaml"), "utf8"));

const dependenciesOf = (importer) => ({
  ...importer.dependencies,
  ...importer.optionalDependencies,
});

const queue = [];

for (const [project, importer] of Object.entries(lock.importers ?? {})) {
  // The workspace root only holds build tooling; it is not shipped.
  if (project === ".") continue;

  for (const [name, dependency] of Object.entries(dependenciesOf(importer))) {
    const version = dependency.version;

    if (!version || version.startsWith("link:")) continue;
    queue.push({ name, version });
  }
}

const reached = new Map();
const seen = new Set();

while (queue.length > 0) {
  const dependency = queue.pop();
  const key = `${dependency.name}@${dependency.version}`;

  if (seen.has(key)) continue;

  seen.add(key);

  if (dependency.name.startsWith("@mattrax/")) continue;

  const snapshot = lock.snapshots?.[key];

  if (!snapshot) continue;

  reached.set(key, { name: dependency.name, version: dependency.version });

  for (const [name, child] of Object.entries({
    ...snapshot.dependencies,
    ...snapshot.optionalDependencies,
  })) {
    // Snapshot dependencies are plain version strings; importer entries are
    // `{ specifier, version }` objects.
    const version = isString(child) ? child : child?.version;

    if (!version || version.startsWith("link:")) continue;
    queue.push({ name, version });
  }
}

const storeEntries = await readdir(path.join(root, "node_modules/.pnpm"));
const storeByPackage = new Map();

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

const readLicenceText = async (directory) => {
  let entries;

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

const declaredLicence = (manifest) => {
  if (isString(manifest.license)) return manifest.license;

  if (manifest.license?.type) return manifest.license.type;

  if (Array.isArray(manifest.licenses))
    return manifest.licenses
      .map((entry) => (isString(entry) ? entry : entry?.type))
      .filter(isString)
      .join(" OR ");

  return "UNKNOWN";
};

const repositoryUrl = (manifest) => {
  const repository = manifest.repository;

  if (isString(repository)) return repository;

  return repository?.url;
};

const packages = [];
const texts = new Map();

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
  let manifest;

  try {
    manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  } catch {
    continue;
  }

  const text = await readLicenceText(directory);
  const digest = text ? createHash("sha256").update(text).digest("hex") : undefined;

  if (digest) texts.set(digest, text);

  const entry = {
    name,
    version: manifest.version ?? version,
    license: declaredLicence(manifest),
  };

  const repository = repositoryUrl(manifest);

  if (repository) entry.repository = repository;

  if (digest) entry.text = digest;

  packages.push(entry);
}

packages.sort((left, right) =>
  left.name === right.name
    ? left.version.localeCompare(right.version)
    : left.name.localeCompare(right.name),
);

const output = {
  packages,
  texts: Object.fromEntries([...texts].sort(([left], [right]) => left.localeCompare(right))),
};

const target = path.join(root, "apps/web/public/licenses.json");

await writeFile(target, `${JSON.stringify(output, null, 2)}\n`);

const withoutText = packages.filter((entry) => !entry.text).length;

console.log(
  `Generated licences for ${packages.length} packages (${texts.size} distinct notices, ${withoutText} without a bundled text) in ${path.relative(root, target)}`,
);
