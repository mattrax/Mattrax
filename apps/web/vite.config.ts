import { defineConfig, loadEnv } from "vite";
import { solidStart } from "@solidjs/start/config";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const config = mode === "development"
    ? { vars: { ...process.env, ...loadEnv("development", "../../", "") } as any }
    : undefined;

  return {
    server: {
      port: 9050,
      allowedHosts: ["dev.otbeaumont.me"]
    },
    resolve: {
      tsconfigPaths: true,
    },
    plugins: [
      tailwindcss(),
      solidStart(),
      cloudflare({
        viteEnvironment: { name: "ssr" },
        auxiliaryWorkers: [{ configPath: "../api/wrangler.jsonc", config }],
        config,
      }),
      // TODO: Remove this AI slop
      {
          name: "solid-start-runtime-extension",
          resolveId(source) {
            if (source.endsWith("/@solidjs/start/dist/server/server-runtime.ts") || source.endsWith("/@solidjs/start/dist/server/server-fns-runtime.ts")) {
              return source.slice(0, -3) + ".js";
            }
          },
        },
    ],
  };
});
