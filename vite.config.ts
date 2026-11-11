import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    // The split policy catalogue is generated JSON with a deterministic compact
    // shape; reformatting it would change the bytes the build script checks.
    ignorePatterns: [
      "dist/**",
      ".cloudflare/**",
      "pnpm-lock.yaml",
      "apps/web/public/catalog/windows/**",
    ],
  },
  lint: {
    ignorePatterns: ["dist/**", ".cloudflare/**", "scripts/**"],
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    projects: ["apps/*/vitest.config.ts", "packages/*/vitest.config.ts"],
  },
});
