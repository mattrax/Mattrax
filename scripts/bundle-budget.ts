#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

/**
 * Cloudflare rejects a Worker whose compressed upload passes the plan's script
 * limit (3 MiB on the free plan, 10 MiB on paid). Local gzip is a close enough
 * proxy; a 2.5 MiB budget leaves room for the wasm module and for differences
 * in the platform's compressor.
 *
 * Run before `cf deploy` so an accidental dependency cannot take production
 * down at upload time.
 */
const BUDGET = 2.5 * 1024 * 1024;

const root = path.resolve(import.meta.dirname, "..");

const workers = new Map<string, string>([
  ["cloud", path.join(root, "apps/cloud/.cloudflare/output/v0/workers/default/bundle")],
  ["web", path.join(root, "apps/web/.cloudflare/output/v0/workers/default/bundle")],
]);

const selected = process.argv.slice(2);

if (selected.length === 0) selected.push(...workers.keys());

const compressedSize = async (directory: string): Promise<number> => {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  let total = 0;

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.endsWith(".map")) continue;

    total += gzipSync(await readFile(path.join(entry.parentPath, entry.name))).byteLength;
  }

  return total;
};

let failed = false;

for (const name of selected) {
  const directory = workers.get(name);

  if (!directory) {
    console.error(`bundle-budget: unknown worker "${name}"`);
    process.exitCode = 1;
    continue;
  }

  const size = await compressedSize(directory);
  const status = size <= BUDGET ? "ok" : "OVER BUDGET";

  console.log(
    `bundle-budget: ${name} ${(size / 1024 / 1024).toFixed(2)} MiB gzip / ${(BUDGET / 1024 / 1024).toFixed(2)} MiB budget (${status})`,
  );

  if (size > BUDGET) failed = true;
}

if (failed) process.exitCode = 1;
