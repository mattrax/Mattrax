import {
  CLASS_FUNCTIONS,
  classSites,
  COLOR_ROOTS,
  tokensOf,
  utilityOf,
  variantOf,
} from "../lib/classes.ts";
import { isUnder } from "../lib/paths.ts";
import { ratcheted } from "../lib/ratchet.ts";
import type { Visitor } from "../lib/ratchet.ts";

const ROOTS = COLOR_ROOTS.split("|")
  .toSorted((a, b) => b.length - a.length)
  .join("|");

const COLOR_UTILITY = new RegExp(`^(${ROOTS})-(.+)$`);

const ARBITRARY_COLOR =
  /^\[(?:color:|#|(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\()/;

const SIDE = "left|right|top|bottom|center";

const NOT_A_COLOR = new RegExp(
  `^(?:${[
    String.raw`\d[\d./%]*`,
    String.raw`\(.+\)`,
    "[2-9]?x[sl]|xs|sm|md|lg|base|px",
    "none|hidden|inner|inset|auto|clone|slice",
    "[xytrblse]",
    String.raw`[xy]-(?:\d.*|px|reverse)`,
    String.raw`offset-\d.*`,
    "spacing-.+",
    `${SIDE}|(?:${SIDE})-(?:${SIDE})`,
    "justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip",
    "solid|dashed|dotted|double|wavy|collapse|separate|from-font",
    "shadow-(?:none|[2-9]?x[sl]|xs|sm|md|lg)",
    "cover|contain|fixed|local|scroll|no-repeat|repeat(?:-.+)?",
    "(?:clip|origin|blend|size|position)-.+",
    "(?:linear|radial|conic|gradient)(?:-.+)?",
  ].join("|")})$`,
);

function isColor(value: string) {
  return value.startsWith("[")
    ? ARBITRARY_COLOR.test(value)
    : !NOT_A_COLOR.test(value);
}

export const noThemeOverrides = ratcheted<{
  functions?: string[];
  primitives?: string[];
  variants?: string[];
}>(
  {
    functions: { items: { type: "string" }, type: "array" },
    primitives: { items: { type: "string" }, type: "array" },
    variants: { items: { type: "string" }, type: "array" },
  },
  (
    file,
    {
      functions = CLASS_FUNCTIONS,
      primitives = ["src/design-system"],
      variants = ["dark"],
    },
    report,
  ): Visitor => {
    if (isUnder(file, primitives)) {
      return {};
    }
    return classSites(functions, (strings) => {
      for (const { node, text } of strings) {
        for (const token of tokensOf(text)) {
          const theme = variantOf(token)
            .split(":")
            .find((variant) => variants.includes(variant));
          const value = COLOR_UTILITY.exec(utilityOf(token))?.[2];
          if (theme && value && isColor(value)) {
            report({
              message: `${token} sets a color for the ${theme} theme at the call site. Use a token that changes with the theme, or add one.`,
              node,
            });
          }
        }
      }
    });
  },
);
