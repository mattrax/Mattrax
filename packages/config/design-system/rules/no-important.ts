import {
  CLASS_FUNCTIONS,
  classSites,
  tokensOf,
  variantOf,
} from "../lib/classes.ts";
import { ratcheted } from "../lib/ratchet.ts";

export const noImportant = ratcheted<{
  allow?: string[];
  functions?: string[];
}>(
  {
    allow: { items: { type: "string" }, type: "array" },
    functions: { items: { type: "string" }, type: "array" },
  },
  (_file, { allow = [], functions = CLASS_FUNCTIONS }, report) => {
    const allowed = allow.map((pattern) => new RegExp(pattern));
    return classSites(functions, (strings) => {
      for (const { node, text } of strings) {
        for (const token of tokensOf(text)) {
          const utility = token.slice(variantOf(token).length);
          if (
            (utility.startsWith("!") || utility.endsWith("!")) &&
            !allowed.some((pattern) => pattern.test(utility))
          ) {
            report({
              message: `${token} forces a style with !important. Change the class it is fighting, or add a variant to the component.`,
              node,
            });
          }
        }
      }
    });
  },
);
