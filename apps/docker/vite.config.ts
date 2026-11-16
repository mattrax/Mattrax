import { builtinModules } from "node:module";
import path from "node:path";
import { defineConfig } from "vite";

/**
 * Node build of the API for the self-hosted image. The shared runtime lives in
 * `@mattrax/cloud`; this bundle supplies the Node crypto, filesystem and SMTP
 * adapters so the container needs no Worker runtime.
 */

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

export default defineConfig({
  resolve: {
    alias: {
      // The API runtime is platform-neutral; the few packages that read the
      // bindings module get the process environment instead.
      "cloudflare:workers": path.resolve(import.meta.dirname, "src/cloudflareWorkersNode.ts"),
    },
  },
  ssr: {
    target: "node",
    noExternal: true,
  },
  build: {
    ssr: "src/node.ts",
    outDir: "dist/node",
    emptyOutDir: true,
    target: "node24",
    // The staged image ships the bundle only; smaller output boots faster and
    // leaves no source map naming internal paths.
    minify: true,
    rolldownOptions: {
      external: (id: string) => builtins.has(id) || id.startsWith("node:"),
    },
  },
});
