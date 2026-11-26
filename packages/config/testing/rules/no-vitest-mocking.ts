// Bans Vitest's module/global mocking in tests: dependencies belong in the
// Effect service graph so tests provide a Layer instead of replacing an import.
// Existing call sites are ratcheted down with a per-file baseline.
import { nameOf } from "../../design-system/lib/ast.ts";
import type { Node } from "../../design-system/lib/ast.ts";
import { ratcheted } from "../../design-system/lib/ratchet.ts";
import type { Visitor } from "../../design-system/lib/ratchet.ts";

interface Options {
  /** Also report vi.fn when used as a dependency fake. */
  fn?: boolean;
  /** Extra vi methods to ban. */
  methods?: string[];
}

const ALWAYS = new Set([
  "mock",
  "doMock",
  "unstable_mockModule",
  "hoisted",
  "spyOn",
  "mocked",
  "stubGlobal",
  "unstubAllGlobals",
]);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

const propertyName = (node: Node | undefined): string | null => {
  if (!node) return null;
  return nameOf(node) ?? (typeof node.value === "string" ? node.value : null);
};

const isBinding = (node: Node | undefined, bindings: Set<string>) =>
  node?.type === "Identifier" && nameOf(node) !== null && bindings.has(nameOf(node)!);

export const noVitestMocking = ratcheted<Options>(
  {
    fn: { type: "boolean" },
    methods: { type: "array", items: { type: "string" } },
  },
  (file, { fn = true, methods = [] }, report): Visitor => {
    if (!(TEST_FILE.test(file) || /(^|\/)tests\//.test(file))) return {};

    // Vitest globals are on in every package; also catch explicit imports.
    const bindings = new Set<string>(["vi"]);
    const banned = new Set([...ALWAYS, ...methods, ...(fn ? ["fn"] : [])]);

    return {
      VariableDeclarator(node) {
        // A local variable named vi shadows the Vitest global.
        if (nameOf(node.id) === "vi") bindings.delete("vi");
      },
      ImportDeclaration(node) {
        if (node.source?.value !== "vitest") return;
        for (const specifier of node.specifiers ?? []) {
          if (specifier.type === "ImportNamespaceSpecifier") {
            const local = nameOf(specifier.local);
            if (local) bindings.add(local);
          } else if (specifier.type === "ImportSpecifier") {
            const imported = propertyName((specifier as Node & { imported?: Node }).imported);
            const local = nameOf(specifier.local);
            if (imported === "vi" && local) bindings.add(local);
          }
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee?.type !== "MemberExpression" || !isBinding(callee.object, bindings)) return;
        const method = propertyName(callee.property);
        if (!method || !banned.has(method)) return;
        report({
          message:
            "vi." +
            method +
            "() replaces dependencies outside the Effect service graph. Provide a Layer / Context service fake instead.",
          node,
        });
      },
    };
  },
);
