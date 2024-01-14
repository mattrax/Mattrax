import { defineConfig } from "@solidjs/start/config";
import Icons from "unplugin-icons/vite";
import IconsResolver from "unplugin-icons/resolver";
import AutoImport from "unplugin-auto-import/vite";
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
  ],
});
