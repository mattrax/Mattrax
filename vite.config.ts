import "dotenv/config";
import { defineConfig } from "@solidjs/start/config";
import Icons from "unplugin-icons/vite";
import IconsResolver from "unplugin-icons/resolver";
import AutoImport from "unplugin-auto-import/vite";
import { visualizer } from "rollup-plugin-visualizer";
import "./src/env";

export default defineConfig({
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
});
