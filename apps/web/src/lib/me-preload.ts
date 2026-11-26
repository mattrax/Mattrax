import type { MeResponse } from "@mattrax/enterprise-domain/client";
import { readClientPreloadedMe } from "~/lib/session-store";
import { writeMeCache } from "~/lib/me-cache";

/**
 * The browser's preloaded shell is static for the life of the tab. Decoding the
 * full membership payload again for every observer would repeat schema work on
 * every navigation; keep the one decode and let account-id checks reject a
 * payload from a previous session in this tab.
 */
let browserPreload: MeResponse | undefined;

/** The SSR preload skips the queryFn, so persist it once for the next cold load. */
let persistedPreloadFor: string | undefined;

export function readBrowserPreloadedMe(): MeResponse | undefined {
  // Only a present payload is cached. The session script is a sibling of the
  // hydration root, so an early observer can legitimately read before it has
  // run; the next one must see the payload rather than a cached "no session".
  if (browserPreload === undefined) browserPreload = readClientPreloadedMe();

  return browserPreload;
}

export function persistBrowserPreloadedMe(data: MeResponse): void {
  if (persistedPreloadFor === data.account.id) return;

  persistedPreloadFor = data.account.id;
  writeMeCache(data);
}

/**
 * Drop the tab-lifetime preload. Clear it on sign-out and a full cross-tab
 * cache reset, not on every session commit: a token refresh or MFA completion
 * for the same account has no reason to re-read the document payload.
 */
export function resetMePreload(): void {
  browserPreload = undefined;
  persistedPreloadFor = undefined;
}

/** Test seam: the last persisted cache, so tests can prove no stale re-seed. */
export function peekMePreloadFor(): string | undefined {
  return persistedPreloadFor;
}
