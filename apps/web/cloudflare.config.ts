import { bindings, defineConfig } from "cf/config";
import type { InferEnv, UnwrapConfig } from "cf/config";

export const webWorker = {
  name: "mattrax",
  compatibilityDate: "2026-10-06",
  compatibilityFlags: ["nodejs_compat"],
  entrypoint: new URL("./src/server/index.ts", import.meta.url).pathname,
  domains: ["e.mattrax.app"],
  previewUrls: false,
  // Workers Logs + real-time Issues for dashboard and proxy failures.
  observability: { enabled: true, issues: { enabled: true } },
  // The web Worker is global: it renders the public shell and owns the /api,
  // /mdm and /scim proxies, while docs and static assets come from the edge
  // closest to the visitor. Only requests that need it cross to us-east-1,
  // where the API Worker is pinned in the region nearest the database. Pinning
  // the web Worker there too would add a transatlantic round trip to every page
  // load without making the proxy faster than the API hop it already makes.
  placement: { mode: "off" as const },
  // `robots.txt` and `sitemap.xml` are generated per request so they advertise
  // the origin the visitor actually used; self-hosted, preview and custom
  // domains never inherit `mattrax.app`. Everything else still comes straight
  // from the asset layer.
  assets: { runWorkerFirst: ["/robots.txt", "/sitemap.xml"] },
  env: {
    API: bindings.worker({ worker: "mattrax-api" }),
    /** Optional fast path; see `useBootstrapSecret` below. */
    /**
     * Must be byte-identical to `mattrax-api`'s `AUTH_SECRET`: this Worker uses
     * it to verify the short-lived SSR bootstrap token, so authenticated HTML
     * needs no service-binding call on a warm token. A missing or mismatched
     * secret falls back to bootstrap and logs one error per isolate, which
     * Workers Issues groups. Self-hosted deployments inherit it from
     * `AUTH_SECRET` via `apps/selfhost`.
     */
    /** Public PostHog project key and ingestion host, injected into the HTML shell. */
    POSTHOG_KEY: bindings.secret(),
    POSTHOG_HOST: bindings.text("https://us.i.posthog.com"),
  },
};

export type WebConfig = UnwrapConfig<typeof webWorker>;

export type WebEnv = InferEnv<WebConfig>;

/**
 * Keeping `AUTH_SECRET` byte-identical to the API's lets this Worker verify the
 * SSR bootstrap token without a service-binding call. `cf deploy` refuses to
 * ship a declared secret that has no value, so the binding is only reserved
 * when the deploy supplies it; without it authenticated HTML falls back to
 * bootstrap and logs one error per isolate.
 */
const useBootstrapSecret = Boolean(process.env.AUTH_SECRET);

export default defineConfig({
  worker: useBootstrapSecret
    ? {
        ...webWorker,
        env: { ...webWorker.env, AUTH_SECRET: bindings.secret() },
      }
    : webWorker,
});
