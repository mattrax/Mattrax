import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["dist/**", ".cloudflare/**", "pnpm-lock.yaml"],
  },
  lint: {
    ignorePatterns: ["dist/**", ".cloudflare/**", "scripts/**"],
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    projects: ["apps/*/vitest.config.ts", "packages/*/vitest.config.ts"],
  },
});
