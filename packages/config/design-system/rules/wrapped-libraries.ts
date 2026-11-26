import type { Node } from "../lib/ast.ts";
import { isUnder } from "../lib/paths.ts";
import { ratcheted } from "../lib/ratchet.ts";
import type { Visitor } from "../lib/ratchet.ts";

export const wrappedLibraries = ratcheted<{
  libraries?: string[];
  primitives?: string[];
}>(
  {
    libraries: { items: { type: "string" }, type: "array" },
    primitives: { items: { type: "string" }, type: "array" },
  },
  (
    file,
    {
      libraries = [
        "@base-ui/react",
        "@base-ui-components/react",
        "@radix-ui/",
        "radix-ui",
        "@headlessui/react",
        "@ark-ui/react",
        "react-aria-components",
      ],
      primitives = ["src/design-system"],
    },
    report,
  ): Visitor => {
    if (isUnder(file, primitives)) {
      return {};
    }
    const visit = (node: Node) => {
      const source = node.source?.value;
      const specifiers = node.specifiers ?? [];
      const typeOnly =
        node.importKind === "type" ||
        (specifiers.length > 0 &&
          specifiers.every((specifier) => specifier.importKind === "type"));
      if (typeof source !== "string" || typeOnly) {
        return;
      }
      const library = libraries.find(
        (name) =>
          source === name ||
          source.startsWith(name.endsWith("/") ? name : `${name}/`),
      );
      if (library) {
        report({
          message: `${source} is a library the design system wraps. Import the primitive from ${primitives[0]}, or add one there.`,
          node: node.source ?? node,
        });
      }
    };
    return { ImportDeclaration: visit, ImportExpression: visit };
  },
);
