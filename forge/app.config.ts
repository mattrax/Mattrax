import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "vinxi";
import { type Plugin } from "vite";
import viteConfigFileRaw from "./vite.config";

let viteConfigFile: any = undefined;

export default createApp({
  routers: [
    {
      name: "public",
      mode: "static",
      dir: "./public",
      base: "/",
    },
    {
      name: "client",
      mode: "spa",
      handler: "./index.html",
      target: "browser",
      plugins: (configEnv) => {
        if (!viteConfigFile) {
          if (typeof viteConfigFileRaw === "function") {
            viteConfigFile = viteConfigFileRaw(configEnv);
          } else {
            viteConfigFile = viteConfigFileRaw;
          }
        }

        return [
          // Due to Vite's plugin execution order this will not be injected by `inject-vite-config`
          ...(("plugins" in viteConfigFile && viteConfigFile?.plugins) || []),
          {
            name: "inject-vite-config",
            config: () => viteConfigFile,
          } satisfies Plugin,
        ];
      },
    },
    {
      name: "server",
      base: "/api",
      mode: "handler",
      handler: fileURLToPath(
        new URL("./src/routes/api/[...api].ts", import.meta.url)
      ),
      target: "server",
    },
  ],
  server: {
    vercel: {
      regions: ["iad1"],
    },
  },
});

// TODO: Remove this hack.
// TODO: It's to serve the SPA from the CDN while only routing API redirects to the Edge Functions.
// TODO: This issue comes down to a limitation in Nitro only allowing one present/adapter but it could possible by worked around in Vinxi.
//
// TODO: https://github.com/unjs/nitro/issues/1158
// TODO: https://github.com/unjs/nitro/issues/1678
const basePath = path.join(".vercel", "output");
process.on("exit", () => {
  if (!fs.existsSync(basePath)) {
    console.warn("Skipping Vercel config patching...");
    return;
  }
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
