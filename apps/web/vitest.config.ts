import { fileURLToPath } from "node:url";
import solidPlugin from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

const enrollmentSsrTests = [
  "src/components/enrollment/enrollment-platforms.test.ts",
  "src/components/enrollment/enrollment-states.test.ts",
];

// These files still replace imports with vi.mock/spyOn. A module mock is
// registered per worker, so running them in a shared module graph lets one
// file's replacement leak into another. Keep just these files isolated;
// everything else injects dependencies through Effect layers.
const mockedTests = [
  "src/components/dashboard/preview.test.ts",
  "src/components/dashboard/widget.test.ts",
  "src/components/mdm/persisted-state.test.ts",
  "src/components/mdm/table.component.test.tsx",
  "src/components/onboarding-checklist.test.tsx",
  "src/lib/auth-http.test.ts",
  "src/lib/auth-passkey.test.ts",
  "src/lib/enterprise.test.ts",
  "src/lib/entity-summary.test.ts",
  "src/lib/me-cache.test.ts",
  "src/lib/me-preload.test.ts",
  "src/lib/me-query.test.ts",
  "src/components/settings/section-tabs-nav.test.ts",
  "src/lib/passkey-sign-in.test.ts",
  "src/lib/posthog.test.ts",
  "src/lib/session-presence.test.ts",
  "src/lib/theme.test.ts",
  "src/routes/(dashboard)/t/[tenantId]/devices/device-async.test.tsx",
  "src/routes/login.test.tsx",
  "src/routes/register.test.tsx",
];

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
