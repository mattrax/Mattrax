import { attributeName, elementName, elementOf } from "../lib/ast.ts";
import type { Node } from "../lib/ast.ts";
import { ratcheted } from "../lib/ratchet.ts";

export const noDeprecated = ratcheted<{
  components?: Record<string, string>;
  imports?: Record<string, string>;
  props?: Record<string, string>;
}>(
  {
    components: { additionalProperties: { type: "string" }, type: "object" },
    imports: { additionalProperties: { type: "string" }, type: "object" },
    props: { additionalProperties: { type: "string" }, type: "object" },
  },
  (_file, { components = {}, imports = {}, props = {} }, report) => ({
    ImportDeclaration(node: Node) {
      const source = node.source?.value;
      const replacement = typeof source === "string" ? imports[source] : null;
      if (replacement) {
        report({
          message: `${String(source)} is deprecated. Import from ${replacement}.`,
          node: node.source ?? node,
        });
      }
    },
    JSXOpeningElement(node: Node) {
      const name = elementName(elementOf(node));
      const component = components[name];
      if (component) {
        report({
          message: `<${name}> is deprecated. Use ${component}.`,
          node,
        });
      }
      for (const attribute of node.attributes ?? []) {
        const prop = attributeName(attribute);
        const replacement = prop ? props[`${name}.${prop}`] : null;
        if (replacement) {
          report({
            message: `${prop} on <${name}> is deprecated. Use ${replacement}.`,
            node: attribute,
          });
        }
      }
    },
  }),
);
