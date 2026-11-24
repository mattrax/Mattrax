import { MeResponse } from "@mattrax/enterprise-domain/client";
import { Option, Schema } from "effect";

const ME_CACHE_KEY = "mattrax:me-cache:v1";

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const CachedMe = Schema.Struct({
  userId: Schema.String,
  updatedAt: Schema.Number,
  data: MeResponse,
});

type CachedMe = typeof CachedMe.Type;

export type MeCacheEntry = CachedMe;

const decodeCachedMe = Schema.decodeUnknownOption(CachedMe);

/**
 * The last stored value and its decoded form. `meQueryOptions` runs for every
 * shell, guard and `useCan` observer on a page; `getItem` still runs each time,
 * but re-parsing the same JSON is a synchronous cost paid during navigation.
 * Keying the memo on the raw string keeps it correct when another tab (or a
 * caller) rewrites storage.
 */
let lastRaw: string | null | undefined;
let lastDecoded: CachedMe | undefined;

const decodeStored = (raw: string | null): CachedMe | undefined => {
  if (raw === lastRaw) return lastDecoded;

  lastRaw = raw;

  if (!raw) {
    lastDecoded = undefined;

    return undefined;
  }

  try {
    lastDecoded = Option.getOrUndefined(decodeCachedMe(JSON.parse(raw)));
  } catch {
    // A partial write or foreign value is ignored until the next write.
    lastDecoded = undefined;
  }

  return lastDecoded;
};

/**
 * The dashboard shell needs the account and tenant list on every page. Cache it
 * per account so a reload paints immediately while TanStack Query refreshes in
 * the background. The account id check prevents one account's cache leaking
 * into another account's session on a shared browser.
 */
export function readMeCache(userId: string | undefined): CachedMe | undefined {
  if (!userId || typeof localStorage === "undefined") return undefined;

  try {
    const cached = decodeStored(localStorage.getItem(ME_CACHE_KEY));

    if (cached === undefined) return undefined;

    if (
      cached.userId !== userId ||
      cached.data?.account?.id !== userId ||
      !Array.isArray(cached.data?.tenants) ||
      Date.now() - cached.updatedAt > MAX_AGE_MS
    )
      return undefined;

    return cached;
  } catch {
    return undefined;
  }
}

export function writeMeCache(data: MeResponse): void {
  if (typeof localStorage === "undefined") return;

  const value: CachedMe = {
    userId: data.account.id,
    updatedAt: Date.now(),
    data,
  };

  try {
    const serialized = JSON.stringify(value);

    localStorage.setItem(ME_CACHE_KEY, serialized);

    // Keep the memo in step with this write, so an immediately following read
    // does not parse the payload we just serialised.
    lastRaw = serialized;
    lastDecoded = value;
  } catch {
    // Quota/private-mode failures only cost the instant-paint optimisation.
  }
}

export function clearMeCache(): void {
  if (typeof localStorage === "undefined") return;

  try {
    localStorage.removeItem(ME_CACHE_KEY);
  } catch {
    // Best effort.
  } finally {
    lastRaw = null;
    lastDecoded = undefined;
  }
}
