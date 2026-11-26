import {
  CLASS_FUNCTIONS,
  classSites,
  COLOR_ROOTS,
  PALETTE,
  tokensOf,
  utilityOf,
  variantOf,
} from "../lib/classes.ts";
import { isUnder } from "../lib/paths.ts";
import { ratcheted } from "../lib/ratchet.ts";
import type { Visitor } from "../lib/ratchet.ts";

export const semanticTokensOnly = ratcheted<{
  functions?: string[];
  primitives?: string[];
  scales?: string[];
  suggest?: Record<string, string>;
}>(
  {
    functions: { items: { type: "string" }, type: "array" },
    primitives: { items: { type: "string" }, type: "array" },
    scales: { items: { type: "string" }, type: "array" },
    suggest: { additionalProperties: { type: "string" }, type: "object" },
  },
  (
    file,
    {
      functions = CLASS_FUNCTIONS,
      primitives = ["src/design-system"],
      scales = PALETTE,
      suggest = {},
    },
    report,
  ): Visitor => {
    if (isUnder(file, primitives)) {
      return {};
    }
    const raw = new RegExp(
      `^(?:${COLOR_ROOTS})-(?:${scales.join("|")})-\\d{1,4}(?:/.+)?$`,
    );
    return classSites(functions, (strings) => {
      for (const { node, text } of strings) {
        for (const token of tokensOf(text)) {
          const utility = utilityOf(token);
          if (!raw.test(utility)) {
            continue;
          }
          const replacement = suggest[utility.replace(/\/.+$/, "")];
          report({
            message: replacement
              ? `${token} uses a raw token. Use the variable, ${variantOf(token)}${replacement}.`
              : `${token} uses a raw token, which says nothing about when to use it. Use the semantic variable for this role, or add one.`,
            node,
          });
        }
      }
    });
  },
);
