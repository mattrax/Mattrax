import { fileURLToPath } from "node:url";
import solidPlugin from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";
import { isolatedTestFiles } from "../../packages/config/testing/isolated-tests.ts";

const enrollmentSsrTests = [
  "src/components/enrollment/enrollment-platforms.test.ts",
  "src/components/enrollment/enrollment-states.test.ts",
];

// Module mocks and fake clocks leak through a shared module graph, so these
// files keep their own worker environment. The list is derived from source;
// everything else injects dependencies through Effect layers.
const mockedTests = isolatedTestFiles
  .filter((file) => file.startsWith("apps/web/"))
  .map((file) => file.slice("apps/web/".length));

const browserResolve = {
  conditions: ["development", "browser"],
};

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
    // The suite injects dependencies rather than mocking modules, so file
    // isolation only re-transforms the same graph (53s -> 9s without it).
    isolate: false,
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
        resolve: browserResolve,
        ssr: {
          noExternal: true,
        },
        test: {
          name: "web",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: [...enrollmentSsrTests, ...mockedTests],
        },
      },
      {
        extends: true,
        plugins: [solidPlugin()],
        resolve: browserResolve,
        ssr: {
          noExternal: true,
        },
        test: {
          name: "web-isolated",
          environment: "node",
          isolate: true,
          include: mockedTests,
        },
      },
    ],
  },
});
