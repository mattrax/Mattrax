/**
 * A tiny in-isolate memo for readiness probes.
 *
 * `/api/ready` is polled by load balancers and uptime checks. The storage probe
 * writes, reads and deletes an object, so running it on every poll is real
 * (billable) work for no extra signal. Caching the promise for a short window
 * also coalesces concurrent polls in the same isolate into one probe.
 *
 * The cache is deliberately per isolate: no two Workers share it, and a new
 * isolate probes fresh. That is enough to stop a poller from continuously
 * mutating the bucket.
 *
 * Failures are cached for the same window. A probe that is timing out should
 * not be retried on every poll from the same isolate; the next poll after the
 * TTL observes recovery.
 */
export type ProbeCache<T> = {
  get(probe: () => Promise<T>): Promise<T>;
  clear(): void;
};

export const createProbeCache = <T>(ttlMs: number, now: () => number = Date.now): ProbeCache<T> => {
  let cached: { readonly at: number; readonly result: Promise<T> } | undefined;

  return {
    get(probe) {
      const at = now();

      if (cached && at - cached.at < ttlMs) return cached.result;

      const result = probe();
      cached = { at, result };

      return result;
    },
    clear() {
      cached = undefined;
    },
  };
};
