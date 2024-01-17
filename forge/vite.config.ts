// import "dotenv/config";
import * as path from "node:path";
import { defineConfig, loadEnv } from "vite";
import Icons from "unplugin-icons/vite";
import IconsResolver from "unplugin-icons/resolver";
import AutoImport from "unplugin-auto-import/vite";
import { visualizer } from "rollup-plugin-visualizer";
import solid from "vite-plugin-solid";
import devServer from "@hono/vite-dev-server";
import { createHtmlPlugin } from "vite-plugin-html";
// import "./src/env";

const monorepoRoot = path.join(__dirname, "..");

process.env = {
  ...process.env,
  ...loadEnv("production", monorepoRoot, ""),
};

await import("./src/env");

export default defineConfig({
  envDir: monorepoRoot,
  plugins: [
    solid(),
    createHtmlPlugin({
      minify: true,
    }),
    devServer({
      entry: "./api/[[...route]].ts",
      include: [/^\/api/],
    }),
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
      emitFile: !process.env.VERCEL,
    }),
  ],
});
