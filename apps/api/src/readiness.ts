/**
 * Readiness probes.
 *
 * Liveness (`/api/health`) must stay cheap: it proves the Worker is running but
 * says nothing about dependencies. Readiness (`/api/ready`) performs a cheap
 * `SELECT 1` through the existing Db layer so a bad Hyperdrive/MySQL
 * configuration is visible to the load balancer before it sends real traffic.
 *
 * The probe is bounded: a wedged database returns 503 instead of holding the
 * request open. The underlying query is not cancelled (the driver has no
 * request-scoped abort here), but it cannot delay the readiness response.
 */

export type ReadinessBody = {
  readonly status: "ok" | "unavailable";
  readonly version: string;
  readonly deploymentId: string | null;
  readonly checks: {
    readonly database: "ok" | "error";
    readonly latencyMs: number;
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
  readonly version: string;
  readonly deploymentId?: string | null;
  /** Defaults to 2s: long enough for a warm connection, short enough to fail fast. */
  readonly timeoutMs?: number;
  readonly now?: () => number;
};

const DEFAULT_TIMEOUT_MS = 2_000;

export const checkReadiness = async ({
  checkDatabase,
  version,
  deploymentId,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = Date.now,
}: ReadinessOptions): Promise<ReadinessResult> => {
  const startedAt = now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      checkDatabase(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("readiness check timed out")), timeoutMs);
      }),
    ]);

    return {
      httpStatus: 200,
      body: {
        status: "ok",
        version,
        deploymentId: deploymentId ?? null,
        checks: { database: "ok", latencyMs: Math.max(0, Math.round(now() - startedAt)) },
      },
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.message === "readiness check timed out";

    return {
      httpStatus: 503,
      body: {
        status: "unavailable",
        version,
        deploymentId: deploymentId ?? null,
        checks: { database: "error", latencyMs: Math.max(0, Math.round(now() - startedAt)) },
        reason: timedOut ? "timeout" : "check_failed",
      },
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};
