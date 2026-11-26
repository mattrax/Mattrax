import { attributeName, isClassAttribute, valueNode } from "../lib/ast.ts";
import type { Node } from "../lib/ast.ts";
import {
  CLASS_FUNCTIONS,
  classSites,
  PLACEMENT_ROOTS,
  tokensOf,
  utilityOf,
} from "../lib/classes.ts";
import { ratcheted } from "../lib/ratchet.ts";

const COLOR =
  /^(?:#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(.+\))$/i;

const LENGTH = /^(-?\d*\.?\d+)(px|rem)$/;

const COLOR_INSIDE =
  /(?<!url\()#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{3,4})(?![\w-])|(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/i;

const ARBITRARY = /^([a-z][a-z\d-]*)-\[(.+)\](\/.+)?$/;

const ARBITRARY_PROPERTY = /^\[[a-z][a-z-]*:(.+)\]$/;

const SPACING_ROOTS = new Set([
  ...PLACEMENT_ROOTS,
  "p",
  "px",
  "py",
  "pt",
  "pr",
  "pb",
  "pl",
  "ps",
  "pe",
  "gap",
  "gap-x",
  "gap-y",
  "space-x",
  "space-y",
  "translate-x",
  "translate-y",
  "indent",
]);

function rawValueMessage(token: string, spacing: number) {
  const utility = utilityOf(token);
  const property = ARBITRARY_PROPERTY.exec(utility)?.[1];
  const match = ARBITRARY.exec(utility);
  if (!(match || property)) {
    return null;
  }
  const [, root = "", value = property ?? ""] = match ?? [];
  if (value.includes("var(") || value.startsWith("--")) {
    return null;
  }
  if (COLOR.test(value) || COLOR_INSIDE.test(value)) {
    return `${token} hardcodes a color. Use a color token, or add one to the theme.`;
  }
  const length = property ? null : LENGTH.exec(value);
  if (!length) {
    return null;
  }
  const [, amount = "", unit] = length;
  const pixels = Number(amount) * (unit === "rem" ? 16 : 1);
  const step = pixels / spacing;
  if (SPACING_ROOTS.has(root) && Number.isInteger(step * 4)) {
    const name = pixels === 1 ? "px" : String(step);
    return `${token} hardcodes a length. ${value} is ${token.replace(`[${value}]`, name)} on the spacing scale.`;
  }
  return `${token} hardcodes a length. Use a step from the scale, or add a token to the theme.`;
}

const TEXT_ATTRIBUTES = [
  "alt",
  "aria-description",
  "aria-label",
  "defaultValue",
  "label",
  "placeholder",
  "title",
  "value",
];

export const noRawValues = ratcheted<{
  functions?: string[];
  spacing?: number;
  text?: string[];
}>(
  {
    functions: { items: { type: "string" }, type: "array" },
    spacing: { type: "number" },
    text: { items: { type: "string" }, type: "array" },
  },
  (
    _file,
    {
      functions = CLASS_FUNCTIONS,
      spacing = 4,
      text: textAttributes = TEXT_ATTRIBUTES,
    },
    report,
  ) => {
    const sites = classSites(functions, (strings) => {
      for (const { node, text } of strings) {
        for (const token of tokensOf(text)) {
          const message = rawValueMessage(token, spacing);
          if (message) {
            report({ message, node });
          }
        }
      }
    });
    const reportColor = (node: Node | undefined) => {
      if (
        node?.type === "Literal" &&
        typeof node.value === "string" &&
        COLOR.test(node.value)
      ) {
        report({
          message: `${node.value} is a hardcoded color. Use a color token: a class, currentColor or a CSS variable.`,
          node,
        });
      }
    };
    return {
      ...sites,
      JSXAttribute(node: Node) {
        sites["JSXAttribute"]?.(node);
        if (
          isClassAttribute(node) ||
          textAttributes.includes(attributeName(node) ?? "")
        ) {
          return;
        }
        const value = valueNode(node);
        reportColor(value);
        const style = value?.expression;
        if (
          attributeName(node) === "style" &&
          style?.type === "ObjectExpression"
        ) {
          for (const property of style.properties ?? []) {
            reportColor(valueNode(property));
          }
        }
      },
    };
  },
);
