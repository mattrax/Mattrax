import type { Check, CheckResult, Platform, RunOptions, RunReport, RunSummary } from "./types.ts";
import { PLATFORMS } from "./types.ts";

export const SUITE_VERSION = "1.0.0";

const emptyByPlatform = (): RunSummary["byPlatform"] =>
  Object.fromEntries(
    PLATFORMS.map((platform) => [platform, { total: 0, passed: 0, failed: 0 }]),
  ) as RunSummary["byPlatform"];

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

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;

  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
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

const platformName = (platform: Platform): string =>
  platform === "scep"
    ? "SCEP"
    : platform === "apple"
      ? "Apple"
      : platform === "windows"
        ? "Windows"
        : "Android";

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
    } catch (cause) {
      status = "failed";
      error = errorMessage(cause);
    } finally {
      console.error = originalConsoleError;
    }

    const durationMs = Math.round((performance.now() - before) * 100) / 100;

    if (status === "passed") byPlatform[check.platform].passed++;
    else byPlatform[check.platform].failed++;

    const result: CheckResult = {
      id: check.id,
      platform: check.platform,
      category: check.category,
      name: check.name,
      description: check.description,
      dayN: Boolean(check.dayN),
      status,
      durationMs,
      ...(error ? { error } : {}),
    };

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

export const formatResult = (result: CheckResult, verbose = false): string => {
  const badge = result.status === "passed" ? "PASS" : result.status === "failed" ? "FAIL" : "SKIP";
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
