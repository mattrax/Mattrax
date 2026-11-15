import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Guardrail for the theme's single source of truth.
 *
 * Colour decisions live in `app.css` (semantic tokens) and
 * `styles/radix-colors.css` (the vendored Radix scales). A component that names
 * `white/[0.06]`, `#08080a` or `rgba(...)` is dark-only by construction and is
 * exactly how the dashboard regressed before: those literals cannot follow the
 * light theme. This test fails on any new one.
 *
 * Deliberate exceptions are listed with a reason. Adding one should be a
 * conscious decision, not a shortcut.
 */
const SRC = join(import.meta.dirname, "..");

const ALLOWED = new Map<string, string>([
  ["app.css", "the semantic token file itself"],
  ["styles/radix-colors.css", "the vendored Radix scale layer"],
  ["styles/base.css", "vendored shadcn primitives; their colours come from tokens"],
  [
    "Document.tsx",
    "the no-JavaScript notice must render without the stylesheet, so it carries light-dark() values",
  ],
  ["lib/theme.ts", "owns the `theme-color` meta values and the pre-hydration bootstrap script"],
]);

const PATTERNS = [
  { name: "white/black utility", pattern: /(?:\b|-)(?:white|black)\/(?:\[?\d|\[)/ },
  {
    name: "white/black solid utility",
    pattern:
      /\b(?:bg|text|border|ring|fill|stroke|from|to|via|decoration|divide|shadow)-(?:white|black)\b/,
  },
  { name: "hex colour", pattern: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/ },
  { name: "rgb()/rgba()", pattern: /\brgba?\(/ },
  { name: "hsl()/hsla()", pattern: /\bhsla?\(/ },
  { name: "oklch()/oklab()", pattern: /\bokl(?:ch|ab)\(/ },
];

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);

    const name = relative(SRC, path);

    if (!/\.(?:ts|tsx|css)$/.test(entry.name)) return [];

    if (/\.test\.(?:ts|tsx)$/.test(entry.name)) return [];

    if (name.startsWith("..")) return [];

    if (name.includes("node_modules")) return [];

    return [name];
  });

describe("theme colour literal guardrail", () => {
  test("no raw colour literals outside the token files", () => {
    const violations: string[] = [];

    for (const name of sourceFiles(SRC)) {
      if (ALLOWED.has(name)) continue;

      const contents = readFileSync(join(SRC, name), "utf8");
      const lines = contents.split("\n");

      for (const [index, line] of lines.entries()) {
        for (const { name: patternName, pattern } of PATTERNS) {
          if (!pattern.test(line)) continue;

          violations.push(`${name}:${index + 1} (${patternName}) ${line.trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("every allowlisted exception still exists and still needs it", () => {
    for (const [name, reason] of ALLOWED) {
      expect(reason.length, `${name} needs a documented reason`).toBeGreaterThan(10);
      expect(readFileSync(join(SRC, name), "utf8").length, `${name} is missing`).toBeGreaterThan(0);
    }
  });
});
