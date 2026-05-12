import { defineConfig, loadEnv } from "vite";
import { solidStart } from "@solidjs/start/config";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    solidStart(),
    cloudflare({
      viteEnvironment: { name: "ssr" },
      config:
        mode === "development"
          ? { vars: { ...process.env, ...loadEnv("development", "../../", "") } as any }
          : undefined,
    }),
  ],
}));
