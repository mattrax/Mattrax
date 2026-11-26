// Vendored from outtrue (MIT). Kept upstream-compatible.
// oxlint-disable quality/no-known-value-widening
import { elementOf, nameOf, stringAttribute, valueNode } from "../lib/ast.ts";
import type { Node } from "../lib/ast.ts";
import {
  classAttribute,
  classStrings,
  tokensOf,
  utilityOf,
} from "../lib/classes.ts";
import { isUnder, primitivesByName } from "../lib/paths.ts";
import { ratcheted } from "../lib/ratchet.ts";
import type { Visitor } from "../lib/ratchet.ts";

const ELEMENTS: Record<string, string> = {
  button: "Button",
  input: "Input",
  "input[type=checkbox]": "Checkbox",
  "input[type=file]": "",
  "input[type=hidden]": "",
  "input[type=radio]": "Radio",
  "input[type=range]": "Slider",
  textarea: "Textarea",
};

const OVERLAY = "Dialog";

export const noRebuiltPrimitives = ratcheted<{
  elements?: Record<string, string>;
  overlay?: string;
  primitives?: string[];
}>(
  {
    elements: { additionalProperties: { type: "string" }, type: "object" },
    overlay: { type: "string" },
    primitives: { items: { type: "string" }, type: "array" },
  },
  (
    file,
    { elements, overlay, primitives = ["src/design-system"] },
    report,
    cwd,
  ): Visitor => {
    if (isUnder(file, primitives)) {
      return {};
    }
    const existing = primitivesByName(cwd, primitives);
    const exists = (component: string) =>
      component === "" || existing.has(component.toLowerCase());
    const replacements =
      elements ??
      Object.fromEntries(
        Object.entries(ELEMENTS).filter(([, component]) => exists(component)),
      );
    const layer = overlay ?? (exists(OVERLAY) ? OVERLAY : "");
    return {
      JSXOpeningElement(node: Node) {
        const tag = nameOf(elementOf(node));
        if (!tag || tag !== tag.toLowerCase()) {
          return;
        }
        const type = stringAttribute(node, "type");
        const replacement =
          (type === null ? undefined : replacements[`${tag}[type=${type}]`]) ??
          replacements[tag];
        if (replacement) {
          report({
            message: `<${tag}> rebuilds a primitive the design system already has. Use ${replacement}.`,
            node,
          });
        }
        const attribute = classAttribute(node);
        if (!(layer && attribute)) {
          return;
        }
        const utilities = new Set(
          classStrings(valueNode(attribute)).flatMap(({ text }) =>
            tokensOf(text).map(utilityOf),
          ),
        );
        if (utilities.has("fixed") && utilities.has("inset-0")) {
          report({
            message: `fixed inset-0 on <${tag}> builds an overlay by hand. Use ${layer}.`,
            node: attribute,
          });
        }
      },
    };
  },
);
