import * as path from "node:path";
import { defineConfig } from "@solidjs/start/config";
import { loadEnv } from "vite";
import Icons from "unplugin-icons/vite";
import IconsResolver from "unplugin-icons/resolver";
import AutoImport from "unplugin-auto-import/vite";
import { visualizer } from "rollup-plugin-visualizer";

const monorepoRoot = path.join(__dirname, "..");

process.env = {
  ...process.env,
  ...loadEnv("production", monorepoRoot, ""),
};

export default defineConfig({
  envDir: monorepoRoot,
  plugins: [
    AutoImport({
      resolvers: [
        IconsResolver({
          prefix: "Icon",
          extension: "jsx",
        }),
      ],
      dts: "./src/auto-imports.d.ts",
    }),
    Icons({
      compiler: "solid",
    }),
    visualizer({
      // TODO: Different file for server vs client builds
      emitFile: !process.env.VERCEL,
    }),
  ],
  ssr: {
    noExternal: ["@kobalte/core"],
  },
  start: {
    // Solid Start SSR is soooooo broken.
    // From router context errors on HMR to constant hydration mismatches.
    ssr: false,
    server: {
      vercel: {
        regions: ["iad1"],
      },
    },
  },
});
