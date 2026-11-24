import { fileURLToPath } from "node:url";
import solidPlugin from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    conditions: ["development", "browser"],
    alias: {
      // Mirror the `~/*` path alias from `tsconfig.json` for modules that
      // import server helpers.
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  ssr: {
    noExternal: true,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // The ADMX parser uses the platform DOMParser (Node has none). Reuse the
    // domain package's xmldom test polyfill rather than adding the CommonJS
    // dependency to the web app.
    setupFiles: ["../../packages/enterprise-domain/src/admx/test-dom.ts"],
  },
});
