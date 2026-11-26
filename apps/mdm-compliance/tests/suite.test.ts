import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { allChecks } from "../src/checks/index.ts";
import { ScepCaCache } from "../src/harness/scep.ts";
import { filterChecks, runChecks } from "../src/runner.ts";

describe("MDM compliance suite", () => {
  it("passes every protocol check", async () => {
    const report = await Effect.runPromise(
      runChecks(allChecks, { timeoutMs: 30_000 }).pipe(Effect.provide(ScepCaCache.layer())),
    );

    const failures = report.checks
      .filter((check) => check.status === "failed")
      .map((check) => `${check.id}: ${check.error ?? "failed"}`);

    expect(failures).toEqual([]);
    expect(report.summary.total).toBeGreaterThanOrEqual(90);
    expect(report.summary.failed).toBe(0);
  }, 120_000);

  it("treats empty platform and category filters as unfiltered", () => {
    expect(filterChecks(allChecks, { platforms: [], categories: [] })).toHaveLength(
      allChecks.length,
    );
    expect(
      filterChecks(allChecks, { platforms: ["scep"] }).every((check) => check.platform === "scep"),
    ).toBe(true);
  });
});
