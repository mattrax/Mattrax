import { nameOf } from "../lib/ast.ts";
import type { Node } from "../lib/ast.ts";
import { isUnder } from "../lib/paths.ts";
import { ratcheted } from "../lib/ratchet.ts";
import type { Visitor } from "../lib/ratchet.ts";

function isOpenType(node: Node | undefined): boolean {
  switch (node?.type) {
    case "TSStringKeyword":
    case "TSNumberKeyword": {
      return true;
    }
    case "TSUnionType":
    case "TSIntersectionType": {
      return (node.types ?? []).some(isOpenType);
    }
    case "TSParenthesizedType": {
      return isOpenType(node.typeAnnotation);
    }
    default: {
      return false;
    }
  }
}

export const closedVariants = ratcheted<{
  primitives?: string[];
  props?: string[];
}>(
  {
    primitives: { items: { type: "string" }, type: "array" },
    props: { items: { type: "string" }, type: "array" },
  },
  (
    file,
    { primitives = ["src/design-system"], props = ["variant", "size"] },
    report,
  ): Visitor => {
    if (!isUnder(file, primitives)) {
      return {};
    }
    return {
      TSPropertySignature(node: Node) {
        const name = nameOf(node.key);
        if (
          name &&
          props.includes(name) &&
          isOpenType(node.typeAnnotation?.typeAnnotation)
        ) {
          report({
            message: `${name} accepts any string or number, so nothing says which values exist. List the allowed values as a union, such as "primary" | "secondary".`,
            node,
          });
        }
      },
    };
  },
);
