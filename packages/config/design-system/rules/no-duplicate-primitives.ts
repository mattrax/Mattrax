import type { Node } from "../lib/ast.ts";
import { componentKey, isUnder, primitivesByName } from "../lib/paths.ts";
import { ratcheted } from "../lib/ratchet.ts";
import type { Visitor } from "../lib/ratchet.ts";

const COMPONENT_FILE = /(?<!\.(?:test|spec|stories))\.[jt]sx$/;

export const noDuplicatePrimitives = ratcheted<{
  allow?: string[];
  primitives?: string[];
}>(
  {
    allow: { items: { type: "string" }, type: "array" },
    primitives: { items: { type: "string" }, type: "array" },
  },
  (
    file,
    { allow = [], primitives = ["src/design-system"] },
    report,
    cwd,
  ): Visitor => {
    if (!COMPONENT_FILE.test(file) || isUnder(file, primitives)) {
      return {};
    }
    const key = componentKey(file);
    const primitive = primitivesByName(cwd, primitives).get(key);
    if (!primitive || allow.includes(key)) {
      return {};
    }
    return {
      Program(program: Node) {
        report({
          message: `${file} has the same name as the primitive in ${primitive}. Use the primitive, or name this file for what it adds.`,
          node: program,
        });
      },
    };
  },
);
