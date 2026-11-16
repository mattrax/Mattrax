import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["rules/**/*.test.ts", "effect/rules/**/*.test.ts"],
    // This file is a standalone CLI probe (spawns pnpm/oxlint), not a Vitest
    // suite; running it from the workspace suite only yields "no tests".
    exclude: ["rules/require-readable-spacing-cli.test.ts"],
  },
});
