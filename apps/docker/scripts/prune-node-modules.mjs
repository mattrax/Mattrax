import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Remove files the runtime never reads from a deployed `node_modules` tree.
 *
 * Type declarations, source maps, package readmes/changelogs, tests, examples
 * and docs account for thousands of files and a meaningful share of the
 * unpacked layer. Docker layers are additive, so this must run before the
 * stage ends; a later delete would only add another layer.
 *
 * Licences are deliberately kept: they are part of the dependency's
 * distribution terms.
 */
const [root] = process.argv.slice(2);

if (!root) throw new Error("usage: prune-node-modules.mjs <node_modules>");

const files = new Set([
  ".npmignore",
  ".gitignore",
  ".editorconfig",
  ".eslintrc",
  ".eslintrc.js",
  ".prettierrc",
]);

const removableFile = (name) =>
  files.has(name) ||
  name.endsWith(".map") ||
  name.endsWith(".d.ts") ||
  name.endsWith(".d.mts") ||
  name.endsWith(".d.cts") ||
  /^(readme|changelog|history|changes)(\..*)?$/i.test(name);

const removableDirectory = (name) =>
  /^(test|tests|__tests__|spec|specs|example|examples|docs?|coverage)$/i.test(name);

const prune = async (directory) => {
  let removedFiles = 0;
  let removedBytes = 0;

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (removableDirectory(entry.name)) {
        for (const nested of await readdir(absolute, { withFileTypes: true, recursive: true })) {
          if (nested.isFile()) {
            removedBytes += (await stat(path.join(nested.parentPath, nested.name))).size;
            removedFiles += 1;
          }
        }

        await rm(absolute, { recursive: true, force: true });
        continue;
      }

      if (entry.name === ".bin" || entry.name === ".cache") {
        await rm(absolute, { recursive: true, force: true });
        continue;
      }

      const nested = await prune(absolute);
      removedFiles += nested.files;
      removedBytes += nested.bytes;
      continue;
    }

    if (removableFile(entry.name)) {
      removedBytes += (await stat(absolute)).size;
      await rm(absolute, { force: true });
      removedFiles += 1;
    }
  }

  return { files: removedFiles, bytes: removedBytes };
};

const result = await prune(root);

console.log(
  `Pruned ${result.files} files (${(result.bytes / 1024 / 1024).toFixed(1)} MiB) from ${root}`,
);
