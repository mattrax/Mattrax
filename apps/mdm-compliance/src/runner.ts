import { Schema } from "effect";
import type {
  Check,
  CheckResult,
  CheckStatus,
  Platform,
  RunOptions,
  RunReport,
  RunSummary,
} from "./types.ts";
import { PLATFORMS } from "./types.ts";

export const SUITE_VERSION = "1.0.0";

const emptyCounts = () => ({ total: 0, passed: 0, failed: 0 });

const emptyByPlatform = (): RunSummary["byPlatform"] => ({
  apple: emptyCounts(),
  windows: emptyCounts(),
  android: emptyCounts(),
  scep: emptyCounts(),
});

export const filterChecks = (
  checks: ReadonlyArray<Check>,
  options: RunOptions = {},
): ReadonlyArray<Check> => {
  const platforms =
    options.platforms && options.platforms.length > 0 ? new Set(options.platforms) : undefined;

  const categories =
    options.categories && options.categories.length > 0 ? new Set(options.categories) : undefined;

  const search = options.search?.trim().toLowerCase();

  return checks.filter((check) => {
    if (platforms && !platforms.has(check.platform)) return false;

    if (categories && !categories.has(check.category)) return false;

    if (
      search &&
      ![check.id, check.name, check.description, check.category, check.platform]
        .join(" ")
        .toLowerCase()
        .includes(search)
    )
      return false;

    return true;
  });
};

const errorMessage = (error: Error | Schema.Json): string => {
  if (error instanceof Error) return error.message;

  if (Schema.is(Schema.String)(error)) return error;

  try {
    return JSON.stringify(error);
  } catch {
    return "Unserializable failure";
  }
};

function isPrimitiveThrown(value: unknown): value is bigint | symbol {
  return typeof value === "bigint" || typeof value === "symbol";
}

const describeFailure = (cause: unknown): string => {
  if (cause instanceof Error || Schema.is(Schema.Json)(cause)) return errorMessage(cause);

  if (isPrimitiveThrown(cause)) return String(cause);

  return "Unserializable failure";
};

const withTimeout = async <A>(
  work: Promise<A>,
  timeoutMs: number | undefined,
  name: string,
): Promise<A> => {
  if (!timeoutMs || timeoutMs <= 0) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Check timed out after ${timeoutMs}ms: ${name}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const PLATFORM_NAMES = new Map<Platform, string>([
  ["scep", "SCEP"],
  ["apple", "Apple"],
  ["windows", "Windows"],
  ["android", "Android"],
]);

const platformName = (platform: Platform): string => PLATFORM_NAMES.get(platform) ?? platform;

export async function runChecks(
  checks: ReadonlyArray<Check>,
  options: RunOptions = {},
  onResult?: (result: CheckResult) => void,
): Promise<RunReport> {
  const startedAt = new Date();
  const results: Array<CheckResult> = [];
  const byPlatform = emptyByPlatform();

  for (const check of checks) {
    byPlatform[check.platform].total++;
    const before = performance.now();
    let status: CheckResult["status"] = "passed";
    let error: string | undefined;
    // Protocol routes log expected malformed-request failures to console.error.
    // The report carries the useful failure, so keep CLI output deterministic.
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      await withTimeout(check.run(), options.timeoutMs, check.id);
    } catch (error_) {
      status = "failed";
      error = describeFailure(error_);
    } finally {
      console.error = originalConsoleError;
    }

    const durationMs = Math.round((performance.now() - before) * 100) / 100;

    if (status === "passed") byPlatform[check.platform].passed++;
    else byPlatform[check.platform].failed++;

    const base = {
      id: check.id,
      platform: check.platform,
      category: check.category,
      name: check.name,
      description: check.description,
      dayN: Boolean(check.dayN),
      status,
      durationMs,
    };

    const result: CheckResult = error === undefined ? base : { ...base, error };

    results.push(result);
    onResult?.(result);

    if (status === "failed" && options.failFast) break;
  }

  const finishedAt = new Date();
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;

  return {
    suite: "mdm-compliance",
    version: SUITE_VERSION,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    summary: {
      total: results.length,
      passed,
      failed,
      skipped,
      durationMs: Math.round((finishedAt.getTime() - startedAt.getTime()) * 100) / 100,
      byPlatform,
    },
    checks: results,
  };
}

const STATUS_BADGES = new Map<CheckStatus, string>([
  ["passed", "PASS"],
  ["failed", "FAIL"],
  ["skipped", "SKIP"],
]);

export const formatResult = (result: CheckResult, verbose = false): string => {
  const badge = STATUS_BADGES.get(result.status) ?? "SKIP";
  const dayN = result.dayN ? " [day-N]" : "";
  const line = `${badge}  ${result.id}${dayN}  ${result.name} (${result.durationMs}ms)`;

  if (result.status === "failed") return `${line}\n      ${result.error ?? "unknown failure"}`;

  if (verbose) return `${line}\n      ${result.description}`;

  return line;
};

export const formatReport = (report: RunReport, verbose = false): string => {
  const lines = [
    `MDM compliance suite ${report.version}`,
    `Started ${report.startedAt} · finished ${report.finishedAt}`,
    "",
  ];

  if (verbose) {
    for (const platform of PLATFORMS) {
      const checks = report.checks.filter((check) => check.platform === platform);

      if (checks.length === 0) continue;
      lines.push(`${platformName(platform)}`);

      for (const check of checks)
        lines.push(`  ${formatResult(check, true).replaceAll("\n", "\n  ")}`);
      lines.push("");
    }
  } else {
    for (const check of report.checks) lines.push(formatResult(check, false));

    if (report.checks.length > 0) lines.push("");
  }

  lines.push(
    `${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped · ${report.summary.total} checks · ${report.summary.durationMs}ms`,
  );

  for (const platform of PLATFORMS) {
    const counts = report.summary.byPlatform[platform];

    if (counts.total === 0) continue;
    lines.push(
      `  ${platformName(platform).padEnd(8)} ${String(counts.passed).padStart(3)} passed  ${String(counts.failed).padStart(3)} failed  ${String(counts.total).padStart(3)} total`,
    );
  }

  return lines.join("\n");
};
