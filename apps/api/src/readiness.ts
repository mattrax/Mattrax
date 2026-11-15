/**
 * Readiness probes.
 *
 * Liveness (`/api/health`) must stay cheap: it proves the Worker is running but
 * says nothing about dependencies. Readiness (`/api/ready`) proves the three
 * dependencies a request actually needs:
 *
 * - `database`: a cheap `SELECT 1` through the existing Db layer.
 * - `storage`: put + head + delete of a probe object, so a missing binding, a
 *   read-only bucket/volume or a broken R2 token fails before traffic arrives.
 * - `mailer`: the transport is configured, or the deployment explicitly opted
 *   out of email (`skipped`), which reports as degraded rather than healthy.
 *
 * Every check is bounded independently: a wedged dependency returns 503
 * instead of holding the probe open. The underlying promise is not cancelled
 * (the drivers have no request-scoped abort here), but it cannot delay the
 * response.
 */

export type ReadinessCheckState = "ok" | "degraded" | "skipped";

export type ReadinessBody = {
  readonly status: "ok" | "degraded" | "unavailable";
  readonly version: string;
  readonly deploymentId: string | null;
  readonly checks: {
    /** Kept as a literal for backward compatibility with existing probes. */
    readonly database: "ok" | "error";
    readonly latencyMs: number;
    readonly storage?: ReadinessCheckState | "error";
    readonly mailer?: ReadinessCheckState | "error";
  };
  readonly reason?: "timeout" | "check_failed";
};

export type ReadinessResult = {
  readonly httpStatus: 200 | 503;
  readonly body: ReadinessBody;
};

export type ReadinessOptions = {
  /** Runs the cheap dependency check; rejects when the dependency is down. */
  readonly checkDatabase: () => Promise<void>;
  /**
   * Probes object storage. Return `skipped` only for a deployment that
   * intentionally has no object storage (none ship today); a missing binding
   * should throw.
   */
  readonly checkStorage?: () => Promise<ReadinessCheckState>;
  /** Probes the mail transport; `skipped` means email is intentionally off. */
  readonly checkMailer?: () => Promise<ReadinessCheckState>;
  readonly version: string;
  readonly deploymentId?: string | null;
  /** Per-check deadline. Defaults to 2s: enough for a warm hop, short enough to fail fast. */
  readonly timeoutMs?: number;
  readonly now?: () => number;
};

const DEFAULT_TIMEOUT_MS = 2_000;

type MutableChecks = {
  -readonly [Key in keyof ReadinessBody["checks"]]: ReadinessBody["checks"][Key];
};

type MutableBody = { -readonly [Key in keyof ReadinessBody]: ReadinessBody[Key] };

type CheckOutcome = {
  readonly status: ReadinessCheckState | "error";
  readonly timedOut: boolean;
};

/**
 * Run one check with its own deadline. Errors never leak dependency detail to
 * the probe caller: a load balancer only needs pass/fail, and a driver message
 * can contain credentials or addresses.
 */
const runCheck = async (
  check: (() => Promise<ReadinessCheckState>) | undefined,
  timeoutMs: number,
): Promise<CheckOutcome | undefined> => {
  if (!check) return undefined;

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const status = await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("readiness check timed out")), timeoutMs);
      }),
    ]);

    return { status, timedOut: false };
  } catch (error) {
    return {
      status: "error",
      timedOut: error instanceof Error && error.message === "readiness check timed out",
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export const checkReadiness = async ({
  checkDatabase,
  checkStorage,
  checkMailer,
  version,
  deploymentId,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = Date.now,
}: ReadinessOptions): Promise<ReadinessResult> => {
  const startedAt = now();

  const [database, storage, mailer] = await Promise.all([
    runCheck(async () => {
      await checkDatabase();

      return "ok" as const;
    }, timeoutMs),
    runCheck(checkStorage, timeoutMs),
    runCheck(checkMailer, timeoutMs),
  ]);

  const outcomes = [database, storage, mailer].filter(
    (outcome): outcome is CheckOutcome => outcome !== undefined,
  );

  const unavailable = outcomes.some((outcome) => outcome.status === "error");

  const degraded = outcomes.some(
    (outcome) => outcome.status === "skipped" || outcome.status === "degraded",
  );

  const timedOut = outcomes.some((outcome) => outcome.timedOut);

  const checks: MutableChecks = {
    database: database?.status === "error" ? "error" : "ok",
    latencyMs: Math.max(0, Math.round(now() - startedAt)),
  };

  if (storage) checks.storage = storage.status;

  if (mailer) checks.mailer = mailer.status;

  const body: MutableBody = {
    status: unavailable ? "unavailable" : degraded ? "degraded" : "ok",
    version,
    deploymentId: deploymentId ?? null,
    checks,
  };

  if (unavailable) body.reason = timedOut ? "timeout" : "check_failed";

  return { httpStatus: unavailable ? 503 : 200, body };
};
