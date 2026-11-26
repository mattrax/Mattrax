export type AppleByodRateLimitHeaders = Readonly<Record<string, string | string[] | undefined>>;

export type AppleByodRateLimiterOptions = {
  readonly now?: () => number;
  readonly windowMillis?: number;
  readonly limit?: number;
  readonly maxEntries?: number;
};

export type AppleByodRateLimiter = {
  readonly allow: (headers: AppleByodRateLimitHeaders) => boolean;
  readonly size: () => number;
};

type Counter = { count: number; resetAt: number };

const DEFAULT_WINDOW_MILLIS = 60_000;
const DEFAULT_LIMIT = 30;
const DEFAULT_MAX_ENTRIES = 10_000;
const BUCKET_MILLIS = 1_000;
const CLIENT_ADDRESS_MAX_LENGTH = 64;
const UNKNOWN_CLIENT_KEY = "unknown";

/**
 * The deployment boundary strips this header and writes back only the address
 * it verified using its configured proxy trust policy. Raw forwarding headers
 * are deliberately not read here.
 */
const verifiedClientKey = (headers: AppleByodRateLimitHeaders) => {
  const value = headers["x-mattrax-client-address"];
  const address = (Array.isArray(value) ? value[0] : value)
    ?.trim()
    .slice(0, CLIENT_ADDRESS_MAX_LENGTH);

  // Unknown callers share one conservative bucket. They never get a distinct
  // key from a spoofable forwarding header or an absent address.
  return address ? `ip:${address}` : UNKNOWN_CLIENT_KEY;
};

/**
 * Cheap per-isolate limiter for the public BYOD endpoint.
 *
 * Each client has one counter with its original fixed-window reset time. An
 * expiry-second index drops whole maps without scanning their keys, while a
 * request inspects only a fixed number of buckets. The client map is
 * hard-capped; once full, new clients fail closed until counters expire rather
 * than being evicted and having their limits reset.
 */
export const createAppleByodRateLimiter = ({
  now = Date.now,
  windowMillis = DEFAULT_WINDOW_MILLIS,
  limit = DEFAULT_LIMIT,
  maxEntries = DEFAULT_MAX_ENTRIES,
}: AppleByodRateLimiterOptions = {}): AppleByodRateLimiter => {
  // Include both endpoints of the window so adjacent expiry seconds cannot
  // share a ring slot while their counters are still live.
  const bucketCount = Math.max(1, Math.ceil(windowMillis / BUCKET_MILLIS)) + 1;
  const capacity = Math.max(0, Math.floor(maxEntries));
  const buckets: Array<Map<string, Counter> | undefined> = new Array(bucketCount);
  const bucketSeconds: Array<number | undefined> = new Array(bucketCount);
  let entries = 0;
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  return {
    allow(headers) {
      const key = verifiedClientKey(headers);
      // A wall-clock rollback must not make live counters expire early.
      const timestamp = Math.max(latestTimestamp, now());
      const second = Math.floor(timestamp / BUCKET_MILLIS);
      let existing: Counter | undefined;
      let existingIndex: number | undefined;

      latestTimestamp = timestamp;

      for (let index = 0; index < bucketCount; index += 1) {
        const bucketSecond = bucketSeconds[index];

        if (bucketSecond === undefined) continue;

        if (bucketSecond < second) {
          entries -= buckets[index]?.size ?? 0;
          buckets[index] = undefined;
          bucketSeconds[index] = undefined;
        } else {
          const candidate = buckets[index]?.get(key);

          if (candidate) {
            existing = candidate;
            existingIndex = index;
          }
        }
      }

      if (existing) {
        if (existing.resetAt > timestamp) {
          existing.count += 1;

          return existing.count <= limit;
        }

        // The expiry bucket can lag the exact reset instant by less than a
        // second. Remove only this stale counter instead of scanning the map.
        buckets[existingIndex as number]?.delete(key);
        entries -= 1;
      }

      if (entries >= capacity) return false;

      const resetAt = timestamp + windowMillis;
      const expirySecond = Math.floor(resetAt / BUCKET_MILLIS);
      const index = expirySecond % bucketCount;
      const bucket = buckets[index] ?? new Map<string, Counter>();

      if (bucketSeconds[index] !== undefined && bucketSeconds[index] !== expirySecond) return false;

      bucket.set(key, { count: 1, resetAt });
      buckets[index] = bucket;
      bucketSeconds[index] = expirySecond;
      entries += 1;

      return true;
    },
    size: () => entries,
  };
};
