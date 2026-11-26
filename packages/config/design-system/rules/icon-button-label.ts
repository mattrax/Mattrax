import { attributeName, elementName, elementOf } from "../lib/ast.ts";
import type { Node } from "../lib/ast.ts";
import { ratcheted } from "../lib/ratchet.ts";

export const iconButtonLabel = ratcheted<{
  components?: string[];
  icons?: string;
  labels?: string[];
}>(
  {
    components: { items: { type: "string" }, type: "array" },
    icons: { type: "string" },
    labels: { items: { type: "string" }, type: "array" },
  },
  (
    _file,
    {
      components = ["Button"],
      icons = "^Icon|Icon$|^svg$",
      labels = ["aria-label", "aria-labelledby"],
    },
    report,
  ) => {
    const icon = new RegExp(icons);
    return {
      JSXElement(node: Node) {
        const opening = node.openingElement;
        const name = opening ? elementName(elementOf(opening)) : "";
        if (!(opening && components.includes(name))) {
          return;
        }
        const attributes = opening.attributes ?? [];
        if (
          attributes.some(
            (attribute) =>
              attribute.type === "JSXSpreadAttribute" ||
              labels.includes(attributeName(attribute) ?? ""),
          )
        ) {
          return;
        }
        const content = (node.children ?? []).filter(
          (child) =>
            !(
              child.type === "JSXText" &&
              typeof child.value === "string" &&
              child.value.trim() === ""
            ),
        );
        const iconOnly =
          content.length > 0 &&
          content.every(
            (child) =>
              child.type === "JSXElement" &&
              child.openingElement !== undefined &&
              icon.test(elementName(elementOf(child.openingElement))),
          );
        if (iconOnly) {
          report({
            message: `<${name}> holds only an icon, so a screen reader has nothing to announce. Add an aria-label that names the action.`,
            node: opening,
          });
        }
      },
    };
  },
);
