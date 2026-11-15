import { cloudflare } from "@cloudflare/vite-plugin";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { PageFileSystemRouter } from "filesystem-routing";
import { fileRoutes } from "filesystem-routing/vite";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { apiWorker } from "../api/cloudflare.config.ts";

const routesDir = path.resolve("src/routes");
const extensions = ["js", "jsx", "ts", "tsx"];

// Local dev normally runs over HTTP. Set `DEV_HTTPS=1` to serve HTTPS with the
// self-signed certificate from `scripts/dev-cert.mjs`; the API's `ORIGIN` must
// then be `https://localhost:9050` as well.
const certDir = path.resolve(".certs");

const httpsEnabled =
  process.env.DEV_HTTPS === "1" &&
  fs.existsSync(path.join(certDir, "localhost.pem")) &&
  fs.existsSync(path.join(certDir, "localhost-key.pem"));

const https = httpsEnabled
  ? {
      key: fs.readFileSync(path.join(certDir, "localhost-key.pem")),
      cert: fs.readFileSync(path.join(certDir, "localhost.pem")),
    }
  : undefined;

export default defineConfig({
  server: {
    port: 9050,
    https,
    allowedHosts: ["dev.otbeaumont.me"],
  },
  // Rolldown's build report feeds `@rolldown/perf-kit` and the module-graph
  // commands. It is opt-in: the client sourcemaps land in the served asset
  // directory, so a normal production build must not emit them.
  build: process.env.MATTRAX_PERF_REPORT === "1"
    ? {
        sourcemap: true,
        rolldownOptions: { devtools: { mode: "report" as const } },
      }
    : {},
  resolve: {
    tsconfigPaths: true,
  },
  // Pre-bundle the client's critical dependencies once. SSR dependency
  // discovery is disabled by the `mattraxe:stable-ssr-deps` plugin below.
  optimizeDeps: {
    holdUntilCrawlEnd: true,
    include: [
      "solid-js",
      "@solidjs/web",
      "@solidjs/router",
      "@solidjs/meta",
      "@tanstack/solid-query",
      "@kobalte/core/dropdown-menu",
      "@kobalte/core/dialog",
      "@kobalte/core/tooltip",
      "@kobalte/core/polymorphic",
      "effect",
      "posthog-js",
      "@yielded/auth",
    ],
  },
  plugins: [
    // Start mode with SSR: the plugin owns the client entry, the document shell
    // and the server render. `externalServer` hands the Worker entry to us so
    // the same bundle can answer the API and MDM service-binding proxies.
    solid({
      ssr: true,
      start: {
        externalServer: true,
        app: "./src/app.tsx",
        document: "./src/Document.tsx",
        middleware: "./src/server/middleware.ts",
      },
      // The Cloudflare plugin owns the `ssr` environment, including in dev, so
      // its Worker runtime (with `cloudflare:workers` bindings) executes server
      // functions instead of the plugin's Node middleware.
      serverFunctions: { devMiddleware: false },
    }),
    // File-based routes. The client never needs the HTTP method handlers; the
    // server environment answers `GET`/`POST`/… for `/api/*`, `/mdm/*` and
    // friends through `createAPIHandler`.
    fileRoutes({
      routers: {
        client: new PageFileSystemRouter({ dir: routesDir, extensions }),
        ssr: new PageFileSystemRouter({ dir: routesDir, extensions, httpMethods: true }),
      },
      buildInputs: "client",
      // Split each route into its own client chunk. The earlier single-bundle
      // workaround was for a streaming-SSR manifest bug that dropped the
      // `?pick=` module id during hydration; the route chunks now ship the
      // same manifest shape and the navigation/account Playwright suites cover
      // the signed-in shell.
      codeSplitting: true,
    }),
    // Map the Worker to Solid's `ssr` environment so the server render and the
    // API proxies run in workerd, with service bindings available.
    cloudflare({
      viteEnvironment: { name: "ssr" },
      auxiliaryWorkers: [{ config: apiWorker }],
      // Apply `public/_redirects` and the non-hashed `public/_headers` rules in
      // dev so legacy redirects and the docs/icon policy can be exercised
      // without a production deploy. Hashed build assets (and therefore the
      // immutable /assets/* rules) only exist after `vp build`.
      experimental: { headersAndRedirectsDevModeSupport: true },
    }),
    tailwindcss(),
    {
      // The Cloudflare plugin enables SSR dependency discovery for its worker
      // environment. On a cold CI checkout that optimizer can rewrite its
      // manifest mid-request, which breaks the first page load. This post hook
      // runs after the plugin and turns discovery off; SSR deps are ESM and can
      // be loaded directly.
      name: "mattraxe:stable-ssr-deps",
      enforce: "post",
      config: () => ({
        ssr: { optimizeDeps: { noDiscovery: true, include: [] } },
        environments: {
          ssr: {
            optimizeDeps: {
              noDiscovery: true,
              include: [],
              exclude: [
                "effect",
                "@yielded/auth",
                // Keep the WebAuthn verifier in the same module graph as
                // `@yielded/auth`: its `PasskeyProtocol` service is an Effect
                // Context key, and a second prebundled copy never satisfies it.
                "@yielded/auth-simplewebauthn",
                "@yielded/auth-simplewebauthn/Server",
                "@mattrax/enterprise-domain",
                "@mattrax/plist",
                "@mattrax/dm-apple",
                "@mattrax/management-backend-enterprise",
              ],
            },
          },
        },
      }),
    },
  ],
});
