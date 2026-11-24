import { fileURLToPath } from "node:url";
import solidPlugin from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the ~/* path alias from tsconfig.json for modules that import
      // server helpers.
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    // The ADMX parser uses the platform DOMParser (Node has none). Reuse the
    // domain package's xmldom test polyfill rather than adding the CommonJS
    // dependency to the web app.
    setupFiles: ["../../packages/enterprise-domain/src/admx/test-dom.ts"],
    projects: [
      {
        extends: true,
        plugins: [solidPlugin({ ssr: true })],
        oxc: { jsx: { importSource: "@solidjs/web" } },
        resolve: {
          conditions: ["node", "development"],
          alias: {
            "solid-js/web": fileURLToPath(
              new URL("./node_modules/@solidjs/web/dist/server.js", import.meta.url),
            ),
          },
        },
        test: {
          name: "server",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        plugins: [solidPlugin()],
        resolve: {
          conditions: ["development", "browser"],
        },
        ssr: {
          noExternal: true,
        },
        test: {
          name: "browser",
          environment: "happy-dom",
          include: ["src/**/*.test.tsx"],
        },
      },
    ],
  },
});
