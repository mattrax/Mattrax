import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import { antiSlopLint } from "./oxlint.config.ts";

/** Workspace commands run from the repository root, not this package. */
const repository = fileURLToPath(new URL("../..", import.meta.url));

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
    projects: [
      `${repository}/apps/*/vitest.config.ts`,
      `${repository}/packages/*/vitest.config.ts`,
      `${repository}/tools/**/vitest.config.ts`,
    ],
  },
});
