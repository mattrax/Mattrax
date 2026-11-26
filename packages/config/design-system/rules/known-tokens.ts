import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CLASS_FUNCTIONS,
  classSites,
  COLOR_ROOTS,
  PALETTE,
  tokensOf,
  utilityOf,
} from "../lib/classes.ts";
import { ratcheted } from "../lib/ratchet.ts";

const DEFAULT_STEPS = [
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "950",
];

const THEME_COLOR = /--color-([a-z][a-z-]*?)-(\d{1,4})\s*:/g;

const RELATIVE_IMPORT = /@import\s+(?:url\()?["'](\.[^"']+\.css)["']/g;

const themes = new Map<string, Map<string, Set<string>>>();

function stylesheets(paths: string[], seen = new Map<string, string>()) {
  for (const path of paths) {
    if (seen.has(path) || !existsSync(path)) {
      continue;
    }
    const css = readFileSync(path, "utf8");
    seen.set(path, css);
    stylesheets(
      [...css.matchAll(RELATIVE_IMPORT)].map(([, source = ""]) =>
        join(dirname(path), source),
      ),
      seen,
    );
  }
  return seen;
}

function themeScales(cwd: string, files: string[], defaults: boolean) {
  const sheets = stylesheets(files.map((file) => join(cwd, file)));
  const key = [
    defaults,
    ...[...sheets.keys()].map((path) => `${path}:${statSync(path).mtimeMs}`),
  ].join("\n");
  const cached = themes.get(key);
  if (cached) {
    return cached;
  }
  const scales = new Map<string, Set<string>>();
  if (defaults && sheets.size > 0) {
    for (const scale of PALETTE) {
      scales.set(scale, new Set(DEFAULT_STEPS));
    }
  }
  for (const css of sheets.values()) {
    for (const [, scale = "", step = ""] of css.matchAll(THEME_COLOR)) {
      scales.set(scale, (scales.get(scale) ?? new Set()).add(step));
    }
  }
  themes.set(key, scales);
  return scales;
}

export const knownTokens = ratcheted<{
  defaults?: boolean;
  functions?: string[];
  theme?: string[];
}>(
  {
    defaults: { type: "boolean" },
    functions: { items: { type: "string" }, type: "array" },
    theme: { items: { type: "string" }, type: "array" },
  },
  (
    _file,
    {
      defaults = true,
      functions = CLASS_FUNCTIONS,
      theme = ["src/app/globals.css"],
    },
    report,
    cwd,
  ) => {
    const scales = themeScales(cwd, theme, defaults);
    if (scales.size === 0) {
      return {};
    }
    const token = new RegExp(
      `^(?:${COLOR_ROOTS})-(${[...scales.keys()].join("|")})-(\\d{1,4})(?:/.+)?$`,
    );
    return classSites(functions, (strings) => {
      for (const { node, text } of strings) {
        for (const written of tokensOf(text)) {
          const [, scale = "", step = ""] =
            token.exec(utilityOf(written)) ?? [];
          const steps = scales.get(scale);
          if (steps && !steps.has(step)) {
            const listed = [...steps]
              .toSorted((a, b) => Number(a) - Number(b))
              .join(", ");
            report({
              message: `${written} names a step the theme does not define, so it renders nothing. ${scale} has ${listed}.`,
              node,
            });
          }
        }
      }
    });
  },
);
