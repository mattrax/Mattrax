import path from "node:path";
import fs from "node:fs";
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
  build: {
    // Safari mobile has problems with newer syntax
    target: "es2015",
  },
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

const basePath = path.join(".vercel", "output");
process.on("exit", () => {
  const configPath = path.join(basePath, "config.json");
  const data = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const staticAssetsCacheHeaders = fs
    .readdirSync(path.join(basePath, "static"))
    .map((entry) => {
      const p = path.join(path.join(basePath, "static"), entry);
      const meta = fs.lstatSync(p);
      if (meta.isFile()) {
        return entry;
      } else if (meta.isDirectory()) {
        return `${entry}/(.*)`;
      } else {
        throw new Error(`Unexpected file type for file '${p}'!`);
      }
    })
    .map((src) => ({
      src,
      headers: {
        "cache-control": "public,max-age=31536000,immutable",
      },
      continue: true,
    }));

  if ("overrides" in data) delete data.overrides;
  data.routes = [
    ...staticAssetsCacheHeaders,
    {
      handle: "filesystem",
    },
    {
      src: "/api/(.*)",
      dest: "/__nitro",
    },
    {
      src: "/_server",
      dest: "/__nitro",
    },
    {
      src: "/(.*)",
      dest: "/index.html",
      headers: {
        "cache-control": "public,max-age=31536000,immutable",
      },
    },
  ];

  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
});
