import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the `~/*` path alias from `tsconfig.json` for modules that
      // import server helpers.
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The ADMX parser uses the platform DOMParser (Node has none). Reuse the
    // domain package's xmldom test polyfill rather than adding the CommonJS
    // dependency to the web app.
    setupFiles: ["../../packages/enterprise-domain/src/admx/test-dom.ts"],
  },
});
