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
      "@yielded/auth/EmailDelivery",
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
      // Eagerly import route modules instead of wrapping every page in
      // `lazy()`. The streaming SSR manifest in this Vite/Solid RC combination
      // does not always serialize the `?pick=` module id the client needs, which
      // leaves hydration detached and duplicates the signed-in shell. One
      // dashboard bundle is a fair trade for deterministic hydration.
      codeSplitting: false,
    }),
    // Map the Worker to Solid's `ssr` environment so the server render and the
    // API proxies run in workerd, with service bindings available.
    cloudflare({
      viteEnvironment: { name: "ssr" },
      auxiliaryWorkers: [{ config: apiWorker }],
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
                "@yielded/auth/EmailDelivery",
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
