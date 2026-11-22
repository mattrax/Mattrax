import { cloudflare } from "@cloudflare/vite-plugin";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { PageFileSystemRouter } from "filesystem-routing";
import { fileRoutes } from "filesystem-routing/vite";
import fs from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { apiWorker } from "../cloud/cloudflare.config.ts";
import { docsRoutesFromBuildFiles, docsRoutesFromSourceFiles } from "./src/lib/public-routes.ts";

const routesDir = path.resolve("src/routes");

const extensions = ["js", "jsx", "ts", "tsx"];

/**
 * Self-host target: build and run the dashboard as plain Solid SSR on Node
 * instead of a Worker on workerd. `apps/docker` and the Dockerfile load the
 * `dist/server` bundle directly, so this mode leaves the Cloudflare plugin out
 * and builds the server entry (`src/server/index.ts`) that Cloudflare normally
 * owns. Bindings (secrets, the API client) come from `src/server/bindings.ts`,
 * which resolves them per runtime, so no `cloudflare:workers` import needs
 * aliasing.
 */
const nodeTarget = process.env.MATTRAX_TARGET?.toLowerCase() === "node";

/**
 * Identifies the bundle a browser is running. A deploy from CI uses the commit
 * SHA; a local production build falls back to the time the config was read.
 * The value is compiled into the server bundle so every response can advertise
 * it and `GET /version` agrees with the HTML the tab is running.
 */
const buildId =
  process.env.MATTRAX_BUILD_ID?.trim() ||
  process.env.CF_VERSION_METADATA_ID?.trim() ||
  process.env.GITHUB_SHA?.trim() ||
  `local-${Date.now()}`;

const serverDirectory = fileURLToPath(new URL("./src/server/", import.meta.url));

const docsSourceDirectory = fileURLToPath(new URL("../../docs/", import.meta.url));

const docsBuildDirectory = fileURLToPath(new URL("../../doc_build/", import.meta.url));

/**
 * Pages whose `route.preload` returns early for `intent === "initial"`.
 *
 * They only warm the client cache for a later navigation, but the SSR router
 * still imports each route config, which puts a second copy of the page module
 * into the Worker. Resolving them to an empty config in the server environment
 * keeps preloading on the client and the Worker small. Add a page here only
 * when its preload is a no-op for the initial (server-rendered) load.
 */
const clientOnlyPreloadRoutes = [
  "routes/(dashboard)/t/[tenantId]/applications/[applicationId].tsx",
  "routes/(dashboard)/t/[tenantId]/dashboards/[dashboardId].tsx",
  "routes/(dashboard)/t/[tenantId]/devices/[deviceId].tsx",
  "routes/(dashboard)/t/[tenantId]/groups/[groupId].tsx",
  "routes/(dashboard)/t/[tenantId]/groups/new.tsx",
  "routes/(dashboard)/t/[tenantId]/policies/[policyId]/assignments.tsx",
  "routes/(dashboard)/t/[tenantId]/policies/[policyId]/deployment.tsx",
  "routes/(dashboard)/t/[tenantId]/policies/[policyId]/design.tsx",
  "routes/(dashboard)/t/[tenantId]/policies/[policyId]/editor.tsx",
  "routes/(dashboard)/t/[tenantId]/policies/[policyId]/index.tsx",
  "routes/(dashboard)/t/[tenantId]/scripts/[scriptId].tsx",
  "routes/(dashboard)/t/[tenantId]/scripts/new.tsx",
  "routes/(dashboard)/t/[tenantId]/settings/administrators.tsx",
  "routes/(dashboard)/t/[tenantId]/settings/attributes.tsx",
  "routes/(dashboard)/t/[tenantId]/settings/audit.tsx",
  "routes/(dashboard)/t/[tenantId]/settings/billing.tsx",
  "routes/(dashboard)/t/[tenantId]/settings/storage.tsx",
  "routes/(dashboard)/t/[tenantId]/settings/delivery.tsx",
  "routes/(dashboard)/t/[tenantId]/settings/enrollment.tsx",
  "routes/(dashboard)/t/[tenantId]/settings/identity/directory.tsx",
  "routes/(dashboard)/t/[tenantId]/settings/identity/domains.tsx",
  "routes/(dashboard)/t/[tenantId]/settings/migration/index.tsx",
  "routes/(dashboard)/t/[tenantId]/settings/migration/[migrationId].tsx",
  "routes/(dashboard)/t/[tenantId]/settings/identity/index.tsx",
  "routes/(dashboard)/t/[tenantId]/settings/index.tsx",
  "routes/(dashboard)/t/[tenantId]/settings/integrations.tsx",
  "routes/(dashboard)/t/[tenantId]/settings/legal.tsx",
  "routes/(dashboard)/t/[tenantId]/settings/management.tsx",
];

const emptyRouteConfig = "\0mattrax:client-only-preload";

/** Every file below a directory, as forward-slash paths relative to it. */
async function listFiles(directory: string): Promise<string[]> {
  if (!fs.existsSync(directory)) return [];

  const entries = await readdir(directory, { withFileTypes: true, recursive: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
    );
}

/**
 * Documentation routes for the sitemap.
 *
 * CI builds the docs before the web app, so production and CI read the rspress
 * output (`doc_build`), which stays correct if a page ever sets a custom route.
 * A plain dev checkout has no `doc_build`; the markdown sources produce the
 * same list there, so `/sitemap.xml` works in development too.
 */
async function listDocsRoutes(): Promise<string[]> {
  const built = docsRoutesFromBuildFiles(await listFiles(docsBuildDirectory));

  if (built.length > 0) return built;

  return docsRoutesFromSourceFiles(await listFiles(docsSourceDirectory));
}

/** Exposes the documentation route list to the Worker without a generated file. */
function docsRoutesModule(): Plugin {
  const id = "virtual:docs-routes";
  const resolvedId = `\0${id}`;
  let routes: Promise<string[]> | undefined;

  return {
    name: "mattraxe:docs-routes",
    resolveId(source) {
      if (source === id) return resolvedId;
    },
    async load(source) {
      if (source !== resolvedId) return;

      routes ??= listDocsRoutes();

      return `export default ${JSON.stringify(await routes)};`;
    },
  };
}

// Local dev normally runs over HTTP. Set `DEV_HTTPS=1` to serve HTTPS with the
// self-signed certificate from `apps/web/scripts/dev-cert.ts`; the API's `ORIGIN` must
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

export default defineConfig(({ command }) => ({
  server: {
    port: 9050,
    https,
    allowedHosts: ["dev.otbeaumont.me"],
  },
  // Rolldown's build report feeds `@rolldown/perf-kit` and the module-graph
  // commands. It is opt-in: the client sourcemaps land in the served asset
  // directory, so a normal production build must not emit them.
  build: {
    ...(process.env.MATTRAX_PERF_REPORT === "1"
      ? {
          sourcemap: true,
          rolldownOptions: { devtools: { mode: "report" as const } },
        }
      : {}),
    // The self-host build owns its layout because `apps/docker` stages
    // `dist/client` and `dist/server` side by side.
    ...(nodeTarget ? { outDir: "dist/client" } : {}),
  },
  ...(nodeTarget
    ? {
        // `vite build` builds the client and then the SSR bundle.
        builder: {},
        // The Node SSR build must be self-contained: `apps/docker` stages
        // only `dist/`, with no `node_modules`, so every dependency and
        // workspace package is bundled. `environments.ssr.resolve.noExternal`
        // is not honoured by this Vite version for the SSR build.
        ssr: { target: "node" as const, noExternal: true },
        environments: {
          ssr: {
            consumer: "server" as const,
            build: {
              outDir: "dist/server",
              ssr: true,
              copyPublicDir: false,
              rollupOptions: {
                input: {
                  // The same entry the Worker uses; `node.js` is its HTTP host.
                  server: path.join(serverDirectory, "index.ts"),
                  node: path.join(serverDirectory, "node.ts"),
                },
                output: { entryFileNames: "[name].js" },
              },
            },
          },
        },
      }
    : {}),
  resolve: {
    tsconfigPaths: true,
    alias: {
      // The auxiliary API Worker uses the same MySQL/passkey stack as apps/cloud.
      "aws-ssl-profiles": fileURLToPath(
        new URL("../cloud/aws-ssl-profiles.stub.ts", import.meta.url),
      ),
      tldts: fileURLToPath(new URL("../cloud/tldts.stub.ts", import.meta.url)),
      "iconv-lite": fileURLToPath(new URL("../cloud/iconv-lite.stub.ts", import.meta.url)),
    },
  },
  // Compile the deployment id into the server bundle. `deployment.ts` is the
  // only reader; the browser learns the running build from the document meta.
  define: {
    __MATTRAX_BUILD_ID__: JSON.stringify(buildId),
  },
  // Pre-bundle the client's critical dependencies once. SSR dependency
  // discovery is disabled by the `mattraxe:stable-ssr-deps` plugin below.
  optimizeDeps: {
    holdUntilCrawlEnd: true,
    // ui-sdk reads primitives from one core entry; pre-bundling the core apart
    // from the Solid adapter breaks its development identity checks.
    exclude: ["@ui-sdk/core"],
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
    {
      // Resolve the client-only preload configs to an empty route in the server
      // environment. The client keeps the real module and its navigations still
      // preload data before rendering.
      name: "mattrax:client-only-preload",
      enforce: "pre",
      resolveId(source) {
        if (this.environment.name !== "ssr") return;

        const [file, query] = source.split("?");

        if (!file || !query?.startsWith("pick=route&")) return;

        if (clientOnlyPreloadRoutes.some((route) => file.endsWith(route))) return emptyRouteConfig;
      },
      load(id) {
        if (id === emptyRouteConfig) return "export const route = undefined;";
      },
    },
    // Start mode with SSR: the plugin owns the client entry, the document shell
    // and the server render. `externalServer` hands the Worker entry to us so
    // the same bundle can answer the API and MDM service-binding proxies.
    solid({
      ssr: true,
      start: {
        // The Cloudflare plugin builds the server environment; the Node target
        // builds the same entry itself (see `environments.ssr` above). During
        // `vp dev` on Node there is no host to build for, so the plugin's own
        // middlewares serve the app — and run server functions.
        externalServer: !nodeTarget || command === "build",
        app: "./src/app.tsx",
        document: "./src/Document.tsx",
        middleware: "./src/server/middleware.ts",
      },
      // The Cloudflare plugin owns the `ssr` environment, including in dev, so
      // its Worker runtime (with `cloudflare:workers` bindings) executes server
      // functions instead of the plugin's Node middleware.
      serverFunctions: nodeTarget ? {} : { devMiddleware: false },
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
    // API proxies run in workerd, with service bindings available. The Node
    // target has no workerd: its SSR bundle is built by the config above.
    ...(nodeTarget
      ? []
      : [
          cloudflare({
            viteEnvironment: { name: "ssr" },
            auxiliaryWorkers: [{ config: apiWorker }],
            // Apply `public/_redirects` and the non-hashed `public/_headers`
            // rules in dev so legacy redirects and the docs/icon policy can be
            // exercised without a production deploy. Hashed build assets (and
            // therefore the immutable /assets/* rules) only exist after
            // `vp build`.
            experimental: { headersAndRedirectsDevModeSupport: true },
          }),
        ]),
    tailwindcss(),
    docsRoutesModule(),
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
                "@mattrax/mdm-apple",
              ],
            },
          },
        },
      }),
    },
  ],
}));
