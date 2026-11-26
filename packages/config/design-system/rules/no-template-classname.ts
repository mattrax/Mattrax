import { valueNode } from "../lib/ast.ts";
import { CLASS_FUNCTIONS, classSites } from "../lib/classes.ts";
import { ratcheted } from "../lib/ratchet.ts";

export const noTemplateClassname = ratcheted<{
  compose?: string;
  functions?: string[];
}>(
  {
    compose: { type: "string" },
    functions: { items: { type: "string" }, type: "array" },
  },
  (_file, { compose = "cn", functions = CLASS_FUNCTIONS }, report) =>
    classSites(functions, (_strings, attribute) => {
      const expression = valueNode(attribute)?.expression;
      if (
        attribute &&
        expression?.type === "TemplateLiteral" &&
        (expression.expressions ?? []).length > 0
      ) {
        report({
          message: `className is built with a template literal. Compose classes with ${compose}().`,
          node: attribute,
        });
      }
    }),
);
