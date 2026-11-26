import { nameOf } from "../lib/ast.ts";
import type { Node } from "../lib/ast.ts";
import { isUnder } from "../lib/paths.ts";
import { ratcheted } from "../lib/ratchet.ts";
import type { Visitor } from "../lib/ratchet.ts";

export const noBooleanVariants = ratcheted<{
  names?: string[];
  primitives?: string[];
}>(
  {
    names: { items: { type: "string" }, type: "array" },
    primitives: { items: { type: "string" }, type: "array" },
  },
  (
    file,
    {
      names = [
        "primary",
        "secondary",
        "tertiary",
        "ghost",
        "outline",
        "outlined",
        "destructive",
        "danger",
        "small",
        "medium",
        "large",
        "compact",
        "sm",
        "md",
        "lg",
        "xl",
      ],
      primitives = ["src/design-system"],
    },
    report,
  ): Visitor => {
    if (!isUnder(file, primitives)) {
      return {};
    }
    return {
      TSPropertySignature(node: Node) {
        const name = nameOf(node.key) ?? "";
        const word = name.replace(/^(?:is|has)(?=[A-Z])/, "").toLowerCase();
        if (
          node.typeAnnotation?.typeAnnotation?.type === "TSBooleanKeyword" &&
          names.includes(word)
        ) {
          report({
            message: `${name} is a boolean for one look, so two of them can be on at once. Make it a value of a variant or size prop.`,
            node,
          });
        }
      },
    };
  },
);
