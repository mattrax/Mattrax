import { defineConfig, type OxlintConfig } from "oxlint";

/** Deeper chains are not readable; the rule points at the whole expression. */
const maxTernaryDepth: ["error", { maxDepth: number }] = ["error", { maxDepth: 2 }];

export const antiSlopLint = {
  ignorePatterns: [
    "**/node_modules/**",
    "**/dist/**",
    "**/.cloudflare/**",
    "**/doc_build/**",
    "**/test-results/**",
    "**/playwright-report/**",
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".continue/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".roo/**",
    ".windsurf/**",
    "tools/oxlint/anti-slop/**",
  ],
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    { name: "anti-slop-effect", specifier: "./tools/oxlint/anti-slop/effect/index.ts" },
  ],
  // `plugins` replaces oxlint's default set, so the defaults are listed again.
  plugins: ["eslint", "typescript", "unicorn", "oxc", "jsx-a11y"],
  rules: {
    // The codebase is strict everywhere else; a new `any` is never acceptable.
    // Tests exercise intentionally malformed input and third-party mocks, so
    // they are exempted below rather than peppering them with directives.
    "typescript/no-explicit-any": "error",
    "oxc/no-accumulating-spread": "error",
    "anti-slop/max-ternary-depth": maxTernaryDepth,
    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-layout-animating-transition": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-reprovide-ambient-service": "error",
    "anti-slop/no-runtime-typeof": ["error", { allowInTypeGuards: true }],
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-media-dimensions": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-manual-tagged-type": "error",
    "anti-slop-effect/no-service-constructor-imports": "error",
    "anti-slop-effect/prefer-effect-match": "error",
    "anti-slop-effect/prefer-tagged-error-handling": "error",
    // eslint-plugin-jsx-a11y's recommended set. SolidJS renders the same JSX
    // attributes these rules inspect, so they apply unchanged. Rules that are
    // off in the upstream recommendation, cannot see through Kobalte's
    // primitives, or assume React's `htmlFor` are disabled with a note.
    "jsx-a11y/alt-text": "error",
    "jsx-a11y/anchor-has-content": "error",
    "jsx-a11y/anchor-is-valid": "error",
    "jsx-a11y/aria-activedescendant-has-tabindex": "error",
    "jsx-a11y/aria-props": "error",
    "jsx-a11y/aria-proptypes": "error",
    "jsx-a11y/aria-role": "error",
    "jsx-a11y/aria-unsupported-elements": "error",
    "jsx-a11y/autocomplete-valid": "error",
    "jsx-a11y/click-events-have-key-events": "error",
    // Off upstream; the rule is advisory and flags decorative copy.
    "jsx-a11y/anchor-ambiguous-text": "off",
    // Off upstream. It cannot evaluate dynamic `children`, so the shared
    // `<Label>` primitive and Kobalte dialog labels report false positives.
    "jsx-a11y/control-has-associated-label": "off",
    // Solid renders labels with `for`, not React's `htmlFor`, and the shared
    // `<Label>` primitive forwards its control association through spread
    // props. The rule only understands `htmlFor`, so it reports every Solid
    // label; revisit once upstream supports `for`.
    "jsx-a11y/label-has-associated-control": "off",
    "jsx-a11y/heading-has-content": "error",
    "jsx-a11y/html-has-lang": "error",
    "jsx-a11y/iframe-has-title": "error",
    "jsx-a11y/img-redundant-alt": "error",
    "jsx-a11y/interactive-supports-focus": [
      "error",
      {
        tabbable: ["button", "checkbox", "link", "searchbox", "spinbutton", "switch", "textbox"],
      },
    ],
    "jsx-a11y/media-has-caption": "error",
    "jsx-a11y/mouse-events-have-key-events": "error",
    "jsx-a11y/no-access-key": "error",
    "jsx-a11y/no-aria-hidden-on-focusable": "error",
    "jsx-a11y/no-autofocus": "error",
    "jsx-a11y/no-distracting-elements": "error",
    "jsx-a11y/no-interactive-element-to-noninteractive-role": [
      "error",
      { tr: ["none", "presentation"], canvas: ["img"] },
    ],
    "jsx-a11y/no-noninteractive-element-interactions": "error",
    "jsx-a11y/no-noninteractive-element-to-interactive-role": "error",
    "jsx-a11y/no-noninteractive-tabindex": [
      "error",
      { tags: [], roles: ["tabpanel"], allowExpressionValues: true },
    ],
    "jsx-a11y/no-redundant-roles": "error",
    "jsx-a11y/no-static-element-interactions": "error",
    // `role="status"` and `role="group"` on styled divs are deliberate live
    // regions and Kobalte groups; replacing them with <output>/<fieldset>
    // changes layout. Keep the role, not the suggestion.
    "jsx-a11y/prefer-tag-over-role": "off",
    "jsx-a11y/role-has-required-aria-props": "error",
    "jsx-a11y/role-supports-aria-props": "error",
    "jsx-a11y/scope": "error",
    "jsx-a11y/tabindex-no-positive": "error",
  },
  overrides: [
    {
      files: ["**/*.test.ts", "**/*.test.tsx", "**/tests/**"],
      rules: { "typescript/no-explicit-any": "off" },
    },
  ],
} satisfies OxlintConfig;

export default defineConfig(antiSlopLint);
