import { fileURLToPath } from "node:url";
import solidPlugin from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

const enrollmentSsrTests = [
  "src/components/enrollment/enrollment-platforms.test.ts",
  "src/components/enrollment/enrollment-states.test.ts",
];

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
          name: "enrollment-ssr",
          environment: "node",
          include: enrollmentSsrTests,
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
          name: "web",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: enrollmentSsrTests,
        },
      },
    ],
  },
});
