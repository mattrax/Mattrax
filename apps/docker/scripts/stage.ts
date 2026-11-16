import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Collect the deployable pieces of a self-hosted install into one directory:
 *
 *   api       Node build of the API (shared runtime, Node adapters)
 *   web       Solid SSR Node server and its client assets
 *   migrations Drizzle migrations without editor snapshots
 *
 * Used by the Dockerfile, and runnable locally to reproduce an image layout.
 */
const [repository = path.resolve(import.meta.dirname, "../../.."), output = "dist"] =
  process.argv.slice(2);

const outputDirectory = path.resolve(repository, output);

const apiSource = path.join(repository, "apps/docker/dist/node");
const webServerSource = path.join(repository, "apps/web/dist/server");
const webClientSource = path.join(repository, "apps/web/dist/client");
const docsSource = path.join(repository, "doc_build");

await rm(outputDirectory, { recursive: true, force: true });

await mkdir(outputDirectory, { recursive: true });

const removeSourceMaps = async (directory: string): Promise<void> => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) await removeSourceMaps(absolute);
    else if (entry.name.endsWith(".map")) await rm(absolute);
  }
};

await cp(apiSource, path.join(outputDirectory, "api"), { recursive: true });

await cp(webServerSource, path.join(outputDirectory, "web", "server"), { recursive: true });

await cp(webClientSource, path.join(outputDirectory, "web", "client"), { recursive: true });

await cp(docsSource, path.join(outputDirectory, "web", "client", "docs"), { recursive: true });

await Promise.all([
  removeSourceMaps(path.join(outputDirectory, "api")),
  removeSourceMaps(path.join(outputDirectory, "web")),
]);

/**
 * Only `migration.sql` is needed at runtime. The snapshots next to it are
 * editor state and account for most of the migrations directory.
 */
const migrationsSource = path.join(repository, "apps/cloud/migrations");
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
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
  }
}

console.log(`Staged self-hosted runtime in ${outputDirectory}`);
