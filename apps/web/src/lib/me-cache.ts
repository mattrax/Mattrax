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

const decodeCachedMe = Schema.decodeUnknownOption(CachedMe);

/**
 * The dashboard shell needs the account and tenant list on every page. Cache it
 * per account so a reload paints immediately while TanStack Query refreshes in
 * the background. The account id check prevents one account's cache leaking
 * into another account's session on a shared browser.
 */
export function readMeCache(userId: string | undefined): CachedMe | undefined {
  if (!userId || typeof localStorage === "undefined") return undefined;

  try {
    const raw = localStorage.getItem(ME_CACHE_KEY);

    if (!raw) return undefined;

    const cached = Option.getOrUndefined(decodeCachedMe(JSON.parse(raw)));

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

  try {
    localStorage.setItem(
      ME_CACHE_KEY,
      JSON.stringify({
        userId: data.account.id,
        updatedAt: Date.now(),
        data,
      } satisfies CachedMe),
    );
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
  }
}
