import { fileURLToPath } from "node:url";

import config from "./packages/config/oxlint.config.ts";

/**
 * Repository oxlint config.
 *
 * The rules live in `@mattrax/config` so every app, package and tooling script
 * shares one policy; this file remains the root entry point oxlint discovers.
 * Type-aware rules stay on; compiler diagnostics are already covered by the
 * repository `tsc -b` build, and linting test fixtures through a production
 * tsconfig produces false errors.
 */
export default {
  ...config,
  jsPlugins: [
    "@shadcn/lint",
    {
      name: "testing",
      specifier: fileURLToPath(new URL("./packages/config/testing/plugin.ts", import.meta.url)),
    },
    {
      name: "design-system",
      specifier: fileURLToPath(
        new URL("./packages/config/design-system/plugin.ts", import.meta.url),
      ),
    },
  ],
  settings: {
    "design-system": { primitives: "packages/ui/src" },
    shadcn: { themeImports: ["^@mattrax/ui/"] },
  },
  rules: {
    ...config.rules,
    "design-system/classname-passthrough": "error",
    "design-system/closed-variants": "error",
    "design-system/complete-composition": "error",
    "design-system/icon-button-label": "error",
    "design-system/index-in-sync": ["error", { index: "packages/ui/INDEX.md" }],
    "design-system/known-tokens": "error",
    "design-system/layout-only-classname": "error",
    "design-system/no-boolean-variants": "error",
    "design-system/no-cross-surface-imports": "error",
    "design-system/no-deprecated": "error",
    // The web app intentionally keeps thin shims that mirror shared primitive names.
    "design-system/no-duplicate-primitives": [
      "error",
      {
        allow: [
          "badge",
          "button",
          "card",
          "dialog",
          "icons",
          "input",
          "passwordinput",
          "primitives",
          "sheet",
          "table",
          "tooltip",
        ],
      },
    ],
    "design-system/no-important": "error",
    "design-system/no-inline-style": "error",
    "design-system/no-raw-values": "error",
    "design-system/no-reach-in-selectors": "error",
    "design-system/no-rebuilt-primitives": "error",
    "design-system/no-template-classname": "error",
    "design-system/no-theme-overrides": "error",
    "design-system/one-way-imports": "error",
    "design-system/prefer-shorthand": "error",
    "design-system/primitive-naming": "error",
    "design-system/semantic-tokens-only": "error",
    "design-system/single-export-default": "error",
    "design-system/wrapped-libraries": "error",
    "shadcn/no-arbitrary-values": "error",
    "shadcn/no-inline-styles": "error",
    "shadcn/no-raw-colors": "error",
    // Input owns its look, but call sites may reserve room for an adornment.
    "shadcn/no-restyle": [
      "error",
      {
        allow: ["layout"],
        contracts: [{ pattern: "^Input$", allow: ["layout", "spacing"] }],
      },
    ],
    "shadcn/no-unknown-classes": "error",
    "shadcn/require-static-classes": "error",
  },
  overrides: [
    ...(config.overrides ?? []),
    {
      // Dependencies belong in the Effect service graph. Test doubles are
      // local recorders or injected layers, so there is no grandfathered set.
      files: ["**/*.test.ts", "**/*.test.tsx", "**/tests/**/*.{ts,tsx}"],
      rules: {
        "testing/no-vitest-mocking": [
          "error",
          {
            // Zero tolerance: test doubles are local recorders or injected
            // Effect layers, never replacements for imported modules.
            baseline: {},
            fn: true,
          },
        ],
      },
    },
    {
      // The docs theme is plain CSS driven by Rspress, not Tailwind. Utility
      // classes there are Rspress hooks Tailwind cannot see, and the theme
      // exports its components as named re-exports by design.
      files: ["docs/.config/theme/components/**/*.tsx"],
      rules: {
        "shadcn/no-unknown-classes": "off",
        "design-system/single-export-default": "off",
      },
    },
  ],
  options: {
    reportUnusedDisableDirectives: "error",
    typeAware: true,
    typeCheck: false,
  },
};

export { lintConfig } from "./packages/config/oxlint.config.ts";
