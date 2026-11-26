#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Rebuild `spec-durations.json` from Playwright JSON reports.
 *
 * `e2e-shard.ts` balances shards by time, not test count. The weights come
 * from the last full browser run: every shard in CI writes a Playwright JSON
 * report (`test-results/playwright-report.json`) and this merges them into
 * one map of spec file to observed milliseconds. A spec missing from the map
 * (a new file) falls back to a per-test estimate in the shard script.
 *
 * Refresh it from a `main` run (the full suite, three-sample Lighthouse is
 * irrelevant here) after downloading the shard artifacts:
 *
 *   gh run download <run-id> -p 'playwright-durations-*' -D /tmp/e2e-reports
 *   pnpm e2e:durations /tmp/e2e-reports/shard-N/playwright-report.json
 *
 * The output is committed so every PR gets the same split without a warm-up
 * run. Failed tests are skipped: a 60s timeout is not a duration.
 */

const repository = path.resolve(import.meta.dirname, "../../..");
const output = path.join(import.meta.dirname, "spec-durations.json");

const reports = process.argv.slice(2);

if (reports.length === 0) {
  console.error("e2e-durations: pass one or more Playwright JSON report files");
  console.error("usage: pnpm e2e:durations <report.json...>");
  process.exit(64);
}

interface Result {
  status?: string;
  duration?: number;
}

interface Spec {
  file?: string;
  tests?: ReadonlyArray<{ results?: ReadonlyArray<Result> }>;
}

interface Suite {
  file?: string;
  specs?: ReadonlyArray<Spec>;
  suites?: ReadonlyArray<Suite>;
}

interface Report {
  config: { rootDir: string };
  suites: ReadonlyArray<Suite>;
}

/** Observed milliseconds per spec file; the largest report wins on overlap. */
const durations = new Map<string, number>();

const walk = (
  suite: Suite,
  report: Report,
  inherited: string | undefined,
  reportDurations: Map<string, number>,
): void => {
  const file = suite.file ?? inherited;

  for (const spec of suite.specs ?? []) {
    const owned = spec.file ?? file;

    if (owned === undefined) continue;

    // The report's rootDir is the `tests/e2e` directory on the machine that
    // produced it (a CI workspace path). Spec files are relative to it, so map
    // them onto this checkout's `tests/e2e` instead of leaking the CI prefix.
    const relative = path.relative(report.config.rootDir, path.resolve(report.config.rootDir, owned));

    if (relative.startsWith("..")) continue;

    const key = path.posix.join("tests/e2e", relative.split(path.sep).join("/"));

    for (const test of spec.tests ?? []) {
      // The first passing attempt is the cost of the test without a retry's
      // timeout inflating it. Tests with no passing attempt are left to the
      // count-based fallback.
      const passed = (test.results ?? []).find((result) => result.status === "passed");

      if (passed?.duration !== undefined) {
        reportDurations.set(key, (reportDurations.get(key) ?? 0) + passed.duration);
      }
    }
  }

  for (const child of suite.suites ?? []) walk(child, report, file, reportDurations);
};

for (const file of reports) {
  const report = JSON.parse(readFileSync(file, "utf8")) as Report;
  // Each shard owns a disjoint set of spec files, but a report can be passed
  // twice (a rerun, a cancelled shard); keep the larger total per file.
  const reportDurations = new Map<string, number>();

  for (const suite of report.suites) walk(suite, report, suite.file, reportDurations);

  for (const [file, duration] of reportDurations) {
    durations.set(file, Math.max(durations.get(file) ?? 0, duration));
  }
}

if (durations.size === 0) {
  console.error("e2e-durations: no passing test durations found in the reports");
  process.exit(1);
}

const sorted = Object.fromEntries([...durations.entries()].sort(([a], [b]) => a.localeCompare(b)));

writeFileSync(output, `${JSON.stringify(sorted, null, 2)}\n`);

const total = [...durations.values()].reduce((sum, value) => sum + value, 0);
console.log(
  `e2e-durations: wrote ${durations.size} spec files (${(total / 1000).toFixed(0)}s total) to ${path.relative(repository, output)}`,
);
