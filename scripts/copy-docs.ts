import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();

const outputRoot = path.join(appRoot, ".cloudflare/output");

const versions = (await readdir(outputRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const version = versions.at(-1);

if (!version) {
  throw new Error(`No Cloudflare build output found in ${outputRoot}`);
}

const assets = path.join(outputRoot, version, "workers/default/assets");

const docs = path.join(assets, "docs");

const builtDocs = path.resolve(appRoot, "../../doc_build");

await rm(docs, { recursive: true, force: true });

await mkdir(docs, { recursive: true });

await cp(builtDocs, docs, { recursive: true });

console.log(`Copied docs into ${path.relative(appRoot, docs)}`);
