import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import { lintConfig } from "./oxlint.config.ts";
import { isolatedTestFiles } from "./testing/isolated-tests.ts";

/** Workspace commands run from the repository root, not this package. */
const repository = fileURLToPath(new URL("../..", import.meta.url));

/** Node tests that replace modules or pin time need their own module graph. */
const nodeIsolatedTests = isolatedTestFiles.filter((file) => !file.startsWith("apps/web/"));

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
            ...nodeIsolatedTests,
            "**/node_modules/**",
            "**/dist/**",
          ],
        },
      },
      // Mocks and fake clocks leak through a shared module graph, so these
      // tests keep their own environment. Derived from source, not a list.
      {
        extends: true,
        test: {
          name: "node-isolated",
          globals: true,
          environment: "node",
          isolate: true,
          setupFiles: [`${repository}/packages/enterprise-domain/src/admx/test-dom.ts`],
          include: nodeIsolatedTests,
        },
      },
      // The web app needs the Solid plugin and two module-condition variants.
      `${repository}/apps/web/vitest.config.ts`,
    ],
  },
});
