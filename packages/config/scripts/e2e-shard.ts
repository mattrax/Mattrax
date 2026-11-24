#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Pick the spec files a browser-suite shard runs.
 *
 * Playwright's `--shard` divides the suite into contiguous slices of the
 * spec-file list, so a shard's size is whatever falls inside its slice. With
 * 17-test files next to 1-test files that drifts: eight slices held 33, 38,
 * 25, 27, 30, 44, 17 and 29 tests, and the slowest spec decides the suite's
 * wall clock no matter how many runners exist. Adding shards therefore does
 * not shorten a run once a handful of specs dominate one slice.
 *
 * This walks the file list Playwright itself resolves, asks it for each file's
 * test count, and assigns files longest-first to the currently smallest shard.
 * Test counts are only a proxy for runtime, but the split re-balances on every
 * run: a spec that grows moves to a lighter shard instead of inflating a fixed
 * one. Every spec file is assigned to exactly one shard, and a file added to
 * `tests/e2e` is picked up without editing anything.
 *
 * Usage: `e2e-shard.ts <shard>/<total>` prints one repository-relative spec
 * path per line, sorted.
 */

const repository = path.resolve(import.meta.dirname, "../../..");

const requested = process.argv[2] ?? "";
const match = /^(?<current>[1-9]\d*)\/(?<total>[1-9]\d*)$/.exec(requested);

if (!match?.groups) {
  console.error(`e2e-shard: expected "<shard>/<total>", got "${requested}"`);
  process.exit(64);
}

const current = Number(match.groups.current);
const total = Number(match.groups.total);

if (current > total) {
  console.error(`e2e-shard: shard ${current} is outside ${total} shards`);
  process.exit(64);
}

/** The subset of Playwright's JSON listing this needs. */
interface Suite {
  file?: string;
  specs?: Array<{ tests?: ReadonlyArray<unknown> }>;
  suites?: ReadonlyArray<Suite>;
}

interface Listing {
  config: { rootDir: string };
  suites: ReadonlyArray<Suite>;
  errors: ReadonlyArray<unknown>;
}

// `--list` loads the suite without starting a server or running a test, and
// the JSON reporter is the only listing format stable enough to parse.
const listed = execFileSync("pnpm", ["exec", "playwright", "test", "--list", "--reporter=json"], {
  cwd: repository,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["ignore", "pipe", "inherit"],
});

const listing = JSON.parse(listed) as Listing;

if (listing.errors.length > 0) {
  console.error("e2e-shard: Playwright could not list every spec");
  console.error(JSON.stringify(listing.errors, null, 2));
  process.exit(1);
}

/** Tests per spec file; nested `describe` suites inherit their file. */
const counts = new Map<string, number>();

const count = (suite: Suite, file: string | undefined): void => {
  const owned = suite.file ?? file;

  if (owned === undefined) throw new Error("a listed suite has no file");

  const tests = (suite.specs ?? []).reduce((sum, spec) => sum + (spec.tests?.length ?? 0), 0);

  if (tests > 0) counts.set(owned, (counts.get(owned) ?? 0) + tests);

  for (const child of suite.suites ?? []) count(child, owned);
};

for (const suite of listing.suites) count(suite, suite.file);

if (counts.size === 0) {
  console.error("e2e-shard: Playwright listed no tests");
  process.exit(1);
}

const shards = Array.from({ length: total }, () => ({ tests: 0, files: [] as string[] }));

// Ties break on the path so every shard computes the same split, and shards of
// equal size are filled in order so the assignment is reproducible.
const ordered = [...counts.entries()].sort(
  ([pathA, a], [pathB, b]) => b - a || pathA.localeCompare(pathB),
);

for (const [file, tests] of ordered) {
  let target = shards[0]!;

  for (const shard of shards) if (shard.tests < target.tests) target = shard;

  target.tests += tests;
  target.files.push(path.relative(repository, path.join(listing.config.rootDir, file)));
}

const files = shards[current - 1]?.files.sort() ?? [];

// An empty shard would leave Playwright with no filter, which runs the whole
// suite instead of nothing, so refuse rather than duplicate every test.
if (files.length === 0) {
  console.error(`e2e-shard: shard ${current}/${total} has no spec files`);
  process.exit(1);
}

process.stdout.write(`${files.join("\n")}\n`);
