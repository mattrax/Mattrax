import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["rules/**/*.test.ts", "effect/rules/**/*.test.ts"],
  },
});
