import { Cause, Clock, Effect, Logger, Predicate, Schema } from "effect";
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

export const filterChecks = <Services>(
  checks: ReadonlyArray<Check<Services>>,
  options: RunOptions = {},
): ReadonlyArray<Check<Services>> => {
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

const describeFailure = (cause: unknown): string => {
  if (cause instanceof Error || Schema.is(Schema.Json)(cause)) return errorMessage(cause);

  if (Predicate.isBigInt(cause) || Predicate.isSymbol(cause)) return String(cause);

  return "Unserializable failure";
};

const isTimeoutCause = (cause: Cause.Cause<unknown>): boolean =>
  cause.reasons.some((reason) => Cause.isFailReason(reason) && Cause.isTimeoutError(reason.error));

const PLATFORM_NAMES = new Map<Platform, string>([
  ["scep", "SCEP"],
  ["apple", "Apple"],
  ["windows", "Windows"],
  ["android", "Android"],
]);

const platformName = (platform: Platform): string => PLATFORM_NAMES.get(platform) ?? platform;

export const runChecks = Effect.fnUntraced(function* <Services>(
  checks: ReadonlyArray<Check<Services>>,
  options: RunOptions = {},
  onResult?: (result: CheckResult) => void,
): Effect.fn.Return<RunReport, never, Services> {
  const startedAt = yield* Clock.currentTimeMillis;
  const results: Array<CheckResult> = [];
  const byPlatform = emptyByPlatform();

  for (const check of checks) {
    byPlatform[check.platform].total++;
    const before = yield* Clock.currentTimeMillis;
    const outcome = yield* check.run().pipe(
      // Protocol routes log expected malformed-request failures. Keep those
      // logs scoped to the check without mutating process-global console state.
      Effect.provide(Logger.layer([], { mergeWithExisting: false })),
      Effect.as({ status: "passed" as const }),
      options.timeoutMs && options.timeoutMs > 0
        ? Effect.timeout(options.timeoutMs)
        : (effect) => effect,
      Effect.catchCause((cause) =>
        isTimeoutCause(cause)
          ? Effect.succeed({
              status: "failed" as const,
              error: `Check timed out after ${options.timeoutMs}ms: ${check.id}`,
            })
          : Cause.hasInterrupts(cause)
            ? Effect.interrupt
            : Effect.succeed({
                status: "failed" as const,
                error: describeFailure(Cause.squash(cause)),
              }),
      ),
    );

    const after = yield* Clock.currentTimeMillis;
    const durationMs = after - before;
    const status = outcome.status;
    const error = "error" in outcome ? outcome.error : undefined;

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
    yield* Effect.sync(() => onResult?.(result));

    if (status === "failed" && options.failFast) break;
  }

  const finishedAt = yield* Clock.currentTimeMillis;
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;

  return {
    suite: "mdm-compliance",
    version: SUITE_VERSION,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    summary: {
      total: results.length,
      passed,
      failed,
      skipped,
      durationMs: finishedAt - startedAt,
      byPlatform,
    },
    checks: results,
  };
});

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
