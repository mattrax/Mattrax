import { nameOf } from "../lib/ast.ts";
import type { Node } from "../lib/ast.ts";
import { isUnder } from "../lib/paths.ts";
import { ratcheted } from "../lib/ratchet.ts";
import type { Visitor } from "../lib/ratchet.ts";

const FUNCTIONS = [
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
];

export const classNamePassthrough = ratcheted<{ primitives?: string[] }>(
  { primitives: { items: { type: "string" }, type: "array" } },
  (file, { primitives = ["src/design-system"] }, report): Visitor => {
    if (!isUnder(file, primitives)) {
      return {};
    }
    const open: { declared: boolean; node: Node; used: boolean }[] = [];
    const enter = (node: Node) => {
      open.push({ declared: false, node, used: false });
    };
    const exit = (node: Node) => {
      const frame = open.pop();
      if (frame?.node === node && frame.declared && !frame.used) {
        report({
          message:
            "className is taken from the props and never reaches an element, so placing this component from outside does nothing. Merge it into the root element's classes.",
          node,
        });
      }
    };
    return {
      ...Object.fromEntries(
        FUNCTIONS.flatMap((type) => [
          [type, enter],
          [`${type}:exit`, exit],
        ]),
      ),
      Identifier(node: Node) {
        if (nameOf(node) !== "className") {
          return;
        }
        const { parent } = node;
        if (parent?.type === "TSPropertySignature") {
          return;
        }
        if (
          parent?.type === "Property" &&
          parent.parent?.type === "ObjectPattern"
        ) {
          const frame = open.at(-1);
          if (frame) {
            frame.declared = true;
          }
          return;
        }
        for (const frame of open) {
          frame.used = true;
        }
      },
    };
  },
);
