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
      type: "static",
      dir: "./public",
      base: "/",
    },
    {
      name: "client",
      type: "spa",
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
      type: "http",
      base: "/api",
      handler: fileURLToPath(
        new URL("./src/routes/api/[...api].ts", import.meta.url)
      ),
      target: "server",
    },
  ],
  server: {
    // vercel: {
    //   regions: ["iad1"],
    // },
    // This is to ensure Stripe pulls in the Cloudflare Workers version not the Node version.
    // TODO: We could probs PR this to the Vercel Edge preset in Nitro.
    exportConditions: ["worker"],
    unenv: {
      inject: {
        process: undefined,
      },
    },
    esbuild: {
      options: {
        /// Required for `@paralleldrive/cuid2` to work.
        /// https://github.com/paralleldrive/cuid2/issues/62
        target: "es2020",
      },
    },
  },
});

// TODO: Remove this hackery

const workerCode = path.join("dist", "_worker.js", "index.js");
const routesJson = path.join("dist", "_routes.json");
process.on("exit", () => {
  if (!fs.existsSync(workerCode)) {
    console.warn("Skipping Cloudflare env patching...");
    return;
  }

  // Cloudflare doesn't allow access to env outside the handler.
  // So we ship the env with the worker code.
  fs.writeFileSync(
    workerCode,
    `const process={env:${JSON.stringify(
      process.env
    )}};globalThis.process=process.env;${fs.readFileSync(workerCode)}`
  );

  // Replace Nitro's config so Cloudflare will serve the HTML from the CDN instead of the worker (they can do "304 Not Modified" & ETag caching).
  // fs.writeFileSync(
  //   routesJson,
  //   JSON.stringify({
  //     version: 1,
  //     include: ["/api/*"],
  //     exclude: [],
  //   })
  // );
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
        return `/${entry}`;
      } else if (meta.isDirectory()) {
        return `/${entry}/(.*)`;
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
