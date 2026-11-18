import { isServer } from "@solidjs/web";

/**
 * Warm data before a dashboard route renders.
 *
 * Solid Router calls a route's `preload` on hover, focus, touch and navigation
 * intent. The page then reads the same TanStack Query key synchronously from
 * cache, so no loading skeleton is shown on the common path. Preloading is a
 * browser-only concern: SSR has no authenticated API transport here, and a
 * failed preload must never block navigation, so every loader is settled.
 */
export const preloadPage = (loaders: ReadonlyArray<() => Promise<unknown>>): Promise<void> => {
  if (isServer) return Promise.resolve();

  return Promise.allSettled(loaders.map((load) => load())).then(() => undefined);
};
