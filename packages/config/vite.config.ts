import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import { lintConfig } from "./oxlint.config.ts";

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
    ],
  },
  lint: {
    ...lintConfig,
    ignorePatterns: [
      ...(lintConfig.ignorePatterns ?? []),
      "**/dist/**",
      "**/.cloudflare/**",
      "**/doc_build/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "pnpm-lock.yaml",
      "apps/web/public/catalog/windows/**",
    ],
    // Type-aware rules stay on; compiler diagnostics are already covered by the
    // repository `tsc -b` build, and linting test fixtures through a production
    // tsconfig produces false errors.
    options: { typeAware: true, typeCheck: false },
  },
  test: {
    // Tests inject dependencies through Effect layers instead of mocking
    // imports, so a fresh module graph per file is wasted work. Measured on
    // the full suite with 4 workers: 53s with isolation, 9s without. Keep new
    // tests free of module-level state that leaks between files in a worker.
    isolate: false,
    projects: [
      // One project for all node tests replaces 34 near-identical per-package
      // configs. It also picks up src tests that a stale include glob used to
      // skip (packages/dm-android/src/policy.test.ts).
      {
        extends: true,
        test: {
          name: "node",
          globals: true,
          environment: "node",
          setupFiles: [`${repository}/packages/enterprise-domain/src/admx/test-dom.ts`],
          include: [
            "apps/*/src/**/*.test.ts",
            "apps/*/tests/**/*.test.ts",
            "packages/*/src/**/*.test.ts",
            "packages/*/tests/**/*.test.ts",
          ],
          exclude: [
            "apps/web/**",
            "apps/docker/src/cron.test.ts",
            "packages/config/tests/no-vitest-mocking.test.ts",
            "packages/enterprise-api/tests/appleByod.test.ts",
            "packages/enterprise-api/tests/appleByodRateLimit.test.ts",
            "packages/enterprise-api/tests/invitations.test.ts",
            "packages/enterprise-backend/tests/storageValidationCache.test.ts",
            "packages/enterprise-tokens/src/tokens.test.ts",
            "packages/plist/src/tests/plist.test.ts",
            "**/node_modules/**",
            "**/dist/**",
          ],
        },
      },
      // The handful of node files that still use vi.mock/spyOn need a fresh
      // module graph so one file's replacement cannot leak into the next.
      {
        test: {
          name: "node-isolated",
          globals: true,
          environment: "node",
          isolate: true,
          setupFiles: [`${repository}/packages/enterprise-domain/src/admx/test-dom.ts`],
          include: [
            "apps/docker/src/cron.test.ts",
            "packages/config/tests/no-vitest-mocking.test.ts",
            "packages/enterprise-api/tests/appleByod.test.ts",
            "packages/enterprise-api/tests/appleByodRateLimit.test.ts",
            "packages/enterprise-api/tests/invitations.test.ts",
            "packages/enterprise-backend/tests/storageValidationCache.test.ts",
            "packages/enterprise-tokens/src/tokens.test.ts",
            "packages/plist/src/tests/plist.test.ts",
          ],
        },
      },
      // The web app needs the Solid plugin and two module-condition variants.
      `${repository}/apps/web/vitest.config.ts`,
    ],
  },
});
