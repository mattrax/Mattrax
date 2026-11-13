import { defineConfig } from "vite-plus";
import { antiSlopLint } from "./oxlint.config.ts";

export default defineConfig({
  fmt: {
    // The split policy catalogue is generated JSON with a deterministic compact
    // shape; reformatting it would change the bytes the build script checks.
    ignorePatterns: [
      "**/dist/**",
      "**/.cloudflare/**",
      "**/doc_build/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "pnpm-lock.yaml",
      "apps/web/public/catalog/windows/**",
      "tools/oxlint/anti-slop/**",
    ],
  },
  lint: {
    ...antiSlopLint,
    ignorePatterns: [
      ...antiSlopLint.ignorePatterns,
      "**/dist/**",
      "**/.cloudflare/**",
      "**/doc_build/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "pnpm-lock.yaml",
      "apps/web/public/catalog/windows/**",
    ],
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    projects: ["apps/*/vitest.config.ts", "packages/*/vitest.config.ts"],
  },
});
