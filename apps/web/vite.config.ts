import { defineConfig } from "vite";
import { solidStart } from "@solidjs/start/config";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { apiWorker } from "../api/cloudflare.config.ts";

export default defineConfig({
  server: {
    port: 9050,
    allowedHosts: ["dev.otbeaumont.me"],
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    solidStart(),
    cloudflare({
      viteEnvironment: { name: "ssr" },
      auxiliaryWorkers: [{ config: apiWorker }],
    }),
    // Solid Start ships TypeScript sources, so rewrite the runtime imports to
    // the compiled JavaScript files that Vite resolves.
    {
      name: "solid-start-runtime-extension",
      resolveId(source) {
        if (
          source.endsWith("/@solidjs/start/dist/server/server-runtime.ts") ||
          source.endsWith("/@solidjs/start/dist/server/server-fns-runtime.ts")
        ) {
          return source.slice(0, -3) + ".js";
        }
      },
    },
  ],
});
