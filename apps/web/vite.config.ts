import { cloudflare } from "@cloudflare/vite-plugin";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { PageFileSystemRouter } from "filesystem-routing";
import { fileRoutes } from "filesystem-routing/vite";
import path from "node:path";
import { defineConfig } from "vite";
import { apiWorker } from "../api/cloudflare.config.ts";

const routesDir = path.resolve("src/routes");
const extensions = ["js", "jsx", "ts", "tsx"];

export default defineConfig({
  server: {
    port: 9050,
    allowedHosts: ["dev.otbeaumont.me"],
  },
  resolve: {
    tsconfigPaths: true,
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
    }),
    // Map the Worker to Solid's `ssr` environment so the server render and the
    // API proxies run in workerd, with service bindings available.
    cloudflare({
      viteEnvironment: { name: "ssr" },
      auxiliaryWorkers: [{ config: apiWorker }],
    }),
    tailwindcss(),
  ],
});
