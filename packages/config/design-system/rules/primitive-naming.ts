import { posix } from "node:path";
import type { Node } from "../lib/ast.ts";
import { isUnder } from "../lib/paths.ts";
import { ratcheted } from "../lib/ratchet.ts";
import type { Visitor } from "../lib/ratchet.ts";

export const primitiveNaming = ratcheted<{
  banned?: string[];
  primitives?: string[];
}>(
  {
    banned: { items: { type: "string" }, type: "array" },
    primitives: { items: { type: "string" }, type: "array" },
  },
  (
    file,
    {
      banned = [
        "home",
        "landing",
        "pricing",
        "checkout",
        "dashboard",
        "pro",
        "premium",
        "primary",
        "secondary",
        "large",
        "small",
        "old",
        "v2",
      ],
      primitives = ["src/design-system/components"],
    },
    report,
  ): Visitor => {
    if (!isUnder(file, primitives)) {
      return {};
    }
    return {
      Program(program: Node) {
        const base = posix.basename(file).replace(/\..+$/, "");
        const words = base
          .replaceAll(/([a-z\d])([A-Z])/g, "$1-$2")
          .toLowerCase()
          .split(/[-_]/);
        const found = words.filter((word) => banned.includes(word));
        if (found.length === 0) {
          return;
        }
        const kept = words.filter((word) => !banned.includes(word)).join("-");
        report({
          message: `${base} is named after a page or a variant: ${found.join(", ")}. Name the primitive for what it is${kept ? `, ${kept},` : ""} and move the variant into a prop.`,
          node: program,
        });
      },
    };
  },
);
