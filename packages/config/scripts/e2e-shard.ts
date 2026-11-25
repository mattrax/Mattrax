#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
 * test count, and assigns files longest-first to the currently lightest shard.
 * The weight is the spec file's observed duration from `spec-durations.json`
 * (rebuilt by `e2e-durations.ts` from a full run), falling back to the test
 * count times the median observed cost per test for a file the map has never
 * seen. Counts alone left the slowest shard at 159s against a 108-130s pack;
 * duration weights let the bin-packing balance actual time.
 *
 * Every spec file is assigned to exactly one shard, and a file added to
 * `tests/e2e` is picked up without editing anything. The split re-balances on
 * every run, so a spec that grows moves to a lighter shard instead of
 * inflating a fixed one.
 *
 * Usage:
 *   e2e-shard.ts <shard>/<total>   print that shard's spec paths, sorted
 *   e2e-shard.ts --summary <total> print every shard's test/time estimate
 */

const repository = path.resolve(import.meta.dirname, "../../..");

const requested = process.argv.slice(2);
const summary = requested[0] === "--summary";
const requestedShard = summary ? requested[1] : requested[0];
const match = /^(?<current>[1-9]\d*)\/(?<total>[1-9]\d*)$/.exec(requestedShard ?? "");
const summaryTotal = summary ? Number(requested[1]) : undefined;

if (summary ? !Number.isInteger(summaryTotal) || summaryTotal! < 1 : !match?.groups) {
  console.error(`e2e-shard: expected "<shard>/<total>" or "--summary <total>", got "${requested.join(" ")}"`);
  process.exit(64);
}

const current = summary ? 0 : Number(match!.groups!.current);
const total = summary ? summaryTotal! : Number(match!.groups!.total);

if (!summary && current > total) {
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
// the JSON reporter is the only listing format stable enough to parse. The
// CI step that calls this script also sets `PLAYWRIGHT_JSON_OUTPUT_FILE` for
// the run's own report; the reporter would then write the listing to that
// file and leave "Listing tests:" on stdout, so drop both output variables
// for this child process.
const { PLAYWRIGHT_JSON_OUTPUT_FILE: _jsonFile, PLAYWRIGHT_JSON_OUTPUT_NAME: _jsonName, ...listEnvironment } =
  process.env;

const listed = execFileSync("pnpm", ["exec", "playwright", "test", "--list", "--reporter=json"], {
  cwd: repository,
  encoding: "utf8",
  env: listEnvironment,
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

  if (tests > 0) {
    const key = path.relative(repository, path.join(listing.config.rootDir, owned));

    counts.set(key, (counts.get(key) ?? 0) + tests);
  }

  for (const child of suite.suites ?? []) count(child, owned);
};

for (const suite of listing.suites) count(suite, suite.file);

if (counts.size === 0) {
  console.error("e2e-shard: Playwright listed no tests");
  process.exit(1);
}

/**
 * Observed milliseconds per spec file. A missing or unreadable file is not an
 * error: the split falls back to test counts, which is the pre-weights
 * behaviour. That keeps a stale or hand-edited map from stopping CI.
 */
const durations = new Map<string, number>();

try {
  const parsed = JSON.parse(
    readFileSync(path.join(import.meta.dirname, "spec-durations.json"), "utf8"),
  ) as Record<string, number>;

  for (const [file, value] of Object.entries(parsed)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) durations.set(file, value);
  }
} catch {
  // No duration map yet; counts only.
}

/** Median observed cost of a single test, used for specs new to the map. */
const perTest = [...counts.entries()]
  .flatMap(([file, tests]) => {
    const duration = durations.get(file);

    return duration === undefined || tests === 0 ? [] : [duration / tests];
  })
  .sort((a, b) => a - b);

const fallbackPerTest = perTest.length > 0 ? perTest[Math.floor(perTest.length / 2)]! : 1;

const weigh = (file: string, tests: number): number => durations.get(file) ?? tests * fallbackPerTest;

interface Shard {
  tests: number;
  weight: number;
  files: string[];
}

const assign = (count: number): Shard[] => {
  const shards: Shard[] = Array.from({ length: count }, () => ({ tests: 0, weight: 0, files: [] }));

  // Ties break on the path so every shard computes the same split, and equal
  // shards are filled in order so the assignment is reproducible.
  const ordered = [...counts.entries()]
    .map(([file, tests]) => ({ file, tests, weight: weigh(file, tests) }))
    .sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));

  for (const spec of ordered) {
    let target = shards[0]!;

    for (const shard of shards) if (shard.weight < target.weight) target = shard;

    target.weight += spec.weight;
    target.tests += spec.tests;
    target.files.push(spec.file);
  }

  return shards;
};

const shards = assign(total);

if (summary) {
  const weighted = durations.size > 0;
  const weights = shards.map((shard) => shard.weight).sort((a, b) => a - b);
  const median = weights[Math.floor(weights.length / 2)] ?? 0;

  for (const [index, shard] of shards.entries()) {
    const timing = weighted ? `${Math.round(shard.weight / 1000)}s (model)` : "no duration map";
    console.log(
      `shard ${index + 1}/${total}: ${shard.tests} tests, ${timing} over ${shard.files.length} files`,
    );
  }

  const totalTests = shards.reduce((sum, shard) => sum + shard.tests, 0);
  const slowest = weights.at(-1) ?? 0;
  const spread = median > 0 ? ((slowest / median - 1) * 100).toFixed(0) : "0";

  console.log(
    weighted
      ? `total: ${totalTests} tests; slowest ${(slowest / 1000).toFixed(0)}s vs median ${(median / 1000).toFixed(0)}s (+${spread}%)`
      : `total: ${totalTests} tests; no duration map, weights are test counts`,
  );
  process.exit(0);
}

const files = shards[current - 1]?.files.sort() ?? [];

// An empty shard would leave Playwright with no filter, which runs the whole
// suite instead of nothing, so refuse rather than duplicate every test.
if (files.length === 0) {
  console.error(`e2e-shard: shard ${current}/${total} has no spec files`);
  process.exit(1);
}

process.stdout.write(`${files.join("\n")}\n`);
