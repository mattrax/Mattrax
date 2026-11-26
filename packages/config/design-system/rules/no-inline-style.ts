import { attributeName, elementOf, nameOf, rootOf, valueNode } from "../lib/ast.ts";
import type { Node } from "../lib/ast.ts";
import { ratcheted } from "../lib/ratchet.ts";

const COLOR =
  /^(?:#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(.+\))$/i;

function fixedStyleKey(property: Node) {
  const value = valueNode(property);
  const key =
    nameOf(property.key) ??
    (typeof property.key?.value === "string" ? property.key.value : "");
  const fixed =
    value?.type === "Literal" &&
    (typeof value.value === "string" || typeof value.value === "number");
  const color = typeof value?.value === "string" && COLOR.test(value.value);
  return fixed && !color && !key.startsWith("--") ? key : "";
}

export const noInlineStyle = ratcheted<{
  allow?: string[];
  exempt?: string[];
  motion?: string[];
}>(
  {
    allow: { items: { type: "string" }, type: "array" },
    exempt: { items: { type: "string" }, type: "array" },
    motion: { items: { type: "string" }, type: "array" },
  },
  (
    _file,
    { allow = [], exempt = ["next/og"], motion = ["motion", "m"] },
    report,
  ) => {
    let exempted = false;
    return {
      ImportDeclaration(node: Node) {
        if (exempt.includes(String(node.source?.value))) {
          exempted = true;
        }
      },
      JSXAttribute(node: Node) {
        const owner = node.parent ? rootOf(elementOf(node.parent)) : null;
        const style = valueNode(node)?.expression;
        if (
          exempted ||
          motion.includes(owner ?? "") ||
          attributeName(node) !== "style" ||
          style?.type !== "ObjectExpression"
        ) {
          return;
        }
        for (const property of style.properties ?? []) {
          const key = fixedStyleKey(property);
          if (key && !allow.includes(key)) {
            report({
              message: `style sets ${key} to a fixed value. Use a class or a token, and keep style for values computed at runtime.`,
              node: property,
            });
          }
        }
      },
    };
  },
);
