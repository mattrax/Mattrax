import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Collect the deployable pieces of a self-hosted install into one directory:
 *
 *   workers/api, workers/web   built Workers and their static assets
 *   migrations                 Drizzle migrations without editor snapshots
 *
 * Used by the Dockerfile, and runnable locally to reproduce an image layout.
 */
const [repository = path.resolve(import.meta.dirname, "../../.."), output = "dist"] =
  process.argv.slice(2);

const outputDirectory = path.resolve(repository, output);

const workerSources = {
  api: path.join(repository, "apps/api/.cloudflare/output/v0/workers/default"),
  web: path.join(repository, "apps/web/.cloudflare/output/v0/workers/default"),
};

await rm(outputDirectory, { recursive: true, force: true });

await mkdir(outputDirectory, { recursive: true });

const removeSourceMaps = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) await removeSourceMaps(absolute);
    else if (entry.name.endsWith(".map")) await rm(absolute);
  }
};

for (const [name, source] of Object.entries(workerSources)) {
  const target = path.join(outputDirectory, "workers", name);

  await cp(source, target, { recursive: true });
  await removeSourceMaps(target);
}

/**
 * Only `migration.sql` is needed at runtime. The snapshots next to it are
 * editor state and account for most of the migrations directory.
 */
const migrationsSource = path.join(repository, "apps/api/migrations");
const migrationsTarget = path.join(outputDirectory, "migrations");

await mkdir(migrationsTarget, { recursive: true });

for (const entry of await readdir(migrationsSource, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const target = path.join(migrationsTarget, entry.name);
  const migration = path.join(migrationsSource, entry.name, "migration.sql");

  try {
    const sql = await readFile(migration, "utf8");

    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "migration.sql"), sql);
  } catch (cause) {
    if (cause.code !== "ENOENT") throw cause;
  }
}

console.log(`Staged self-hosted runtime in ${outputDirectory}`);
