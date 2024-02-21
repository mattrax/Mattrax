import { defineConfig } from "vite";
import Icons from "unplugin-icons/vite";
import IconsResolver from "unplugin-icons/resolver";
import AutoImport from "unplugin-auto-import/vite";
import { visualizer } from "rollup-plugin-visualizer";
import solid from "vite-plugin-solid";
import { createHtmlPlugin } from "vite-plugin-html";
import tsconfigPaths from "vite-tsconfig-paths";

// Make sure env validation runs
import { monorepoRoot } from "./loadEnv";
import "@mattrax/api";

export default defineConfig((config) => ({
  envDir: monorepoRoot,
  build: {
    // Safari mobile has problems with newer syntax
    target: "es2015",
  },
  plugins: [
    solid(),
    tsconfigPaths({
      // If this isn't set Vinxi hangs on startup
      root: ".",
    }),
    // Vinxi/Nitro doesn't play nice with this plugin
    ...(config.mode === "development"
      ? [createHtmlPlugin({ minify: true })]
      : []),
    AutoImport({
      resolvers: [IconsResolver({ prefix: "Icon", extension: "jsx" })],
      dts: "./src/auto-imports.d.ts",
    }),
    Icons({ compiler: "solid" }),
    !(process.env.VERCEL === "1")
      ? visualizer({ brotliSize: true, gzipSize: true })
      : undefined,
  ],
  ssr: { noExternal: ["@kobalte/core"] },
}));
