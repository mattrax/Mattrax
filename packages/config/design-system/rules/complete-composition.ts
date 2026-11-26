// Vendored from outtrue (MIT). Kept upstream-compatible.
// oxlint-disable typescript/unbound-method
import { elementName, elementOf, nameOf, rootOf } from "../lib/ast.ts";
import type { Node } from "../lib/ast.ts";
import { primitiveImports } from "../lib/classes.ts";
import { ratcheted } from "../lib/ratchet.ts";

type Part = string | string[];

interface Composition {
  missing: Part[];
  name: string;
  node: Node;
  opaque: boolean;
  opening: Node;
}

function isChildrenExpression(node: Node | undefined) {
  return (
    (node?.type === "Identifier" && nameOf(node) === "children") ||
    (node?.type === "MemberExpression" && nameOf(node.property) === "children")
  );
}

export const completeComposition = ratcheted<{
  alias?: Record<string, string>;
  parts?: Record<string, Part[]>;
  primitives?: string[];
}>(
  {
    alias: { additionalProperties: { type: "string" }, type: "object" },
    primitives: { items: { type: "string" }, type: "array" },
    parts: {
      additionalProperties: {
        items: {
          anyOf: [
            { type: "string" },
            { items: { type: "string" }, type: "array" },
          ],
        },
        type: "array",
      },
      type: "object",
    },
  },
  (
    file,
    { alias, parts = {}, primitives = ["@/design-system/components/"] },
    report,
  ) => {
    const open: Composition[] = [];
    const { collect, sources } = primitiveImports(primitives, file, alias);
    return {
      ImportDeclaration: collect,
      JSXElement(node: Node) {
        const opening = node.openingElement;
        const name = opening ? elementName(elementOf(opening)) : "";
        for (const composition of open) {
          composition.missing = composition.missing.filter(
            (part) => !(Array.isArray(part) ? part : [part]).includes(name),
          );
          const family = new Set([
            composition.name,
            ...(parts[composition.name] ?? []).flat(),
          ]);
          if (
            node.parent === composition.node &&
            name[0] !== name[0]?.toLowerCase() &&
            !family.has(name)
          ) {
            composition.opaque = true;
          }
        }
        const required = parts[name];
        if (
          opening &&
          required &&
          sources.has(rootOf(elementOf(opening)) ?? "")
        ) {
          open.push({
            missing: [...required],
            name,
            node,
            opaque: false,
            opening,
          });
        }
      },
      "JSXElement:exit"(node: Node) {
        const composition = open.at(-1);
        if (composition?.node !== node) {
          return;
        }
        open.pop();
        if (composition.opaque || composition.missing.length === 0) {
          return;
        }
        const listed = composition.missing
          .map((part) => (Array.isArray(part) ? part.join(" or ") : part))
          .join(", ");
        report({
          message: `<${composition.name}> is missing ${listed}. Use every required part, as in the component's full example.`,
          node: composition.opening,
        });
      },
      JSXExpressionContainer(node: Node) {
        for (const composition of open) {
          if (
            isChildrenExpression(node.expression) ||
            (node.parent === composition.node &&
              (node.expression?.type === "Identifier" ||
                node.expression?.type === "MemberExpression"))
          ) {
            composition.opaque = true;
          }
        }
      },
      JSXSpreadAttribute(node: Node) {
        const composition = open.at(-1);
        if (composition && node.parent === composition.opening) {
          composition.opaque = true;
        }
      },
    };
  },
);
