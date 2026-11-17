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
  },
});
