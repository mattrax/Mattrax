import { nameOf } from "../lib/ast.ts";
import type { Node } from "../lib/ast.ts";
import { ratcheted } from "../lib/ratchet.ts";
import type { Visitor } from "../lib/ratchet.ts";

const COMPONENT_FILE = /\.[jt]sx$/;

const TYPE_DECLARATIONS = new Set([
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
]);

export const singleExportDefault = ratcheted<Record<string, never>>(
  {},
  (file, _options, report): Visitor => {
    if (!COMPONENT_FILE.test(file)) {
      return {};
    }
    const exports: { defaultFunction: boolean; name: string; node: Node }[] =
      [];
    return {
      ExportAllDeclaration(node: Node) {
        exports.push({ defaultFunction: false, name: "", node });
      },
      ExportDefaultDeclaration(node: Node) {
        const { declaration } = node;
        exports.push({
          defaultFunction: declaration?.type === "FunctionDeclaration",
          name: nameOf(declaration?.id) ?? nameOf(declaration) ?? "",
          node,
        });
      },
      ExportNamedDeclaration(node: Node) {
        const { declaration } = node;
        if (
          node.exportKind === "type" ||
          TYPE_DECLARATIONS.has(declaration?.type ?? "")
        ) {
          return;
        }
        for (const declarator of declaration?.declarations ?? []) {
          exports.push({
            defaultFunction: false,
            name: nameOf(declarator.id) ?? "",
            node,
          });
        }
        if (declaration && !declaration.declarations) {
          exports.push({
            defaultFunction: false,
            name: nameOf(declaration.id) ?? "",
            node,
          });
        }
        for (const specifier of node.specifiers ?? []) {
          if (specifier.exportKind !== "type") {
            exports.push({
              defaultFunction: false,
              name: nameOf(specifier.exported) ?? "",
              node,
            });
          }
        }
      },
      "Program:exit"() {
        const [only] = exports;
        if (
          exports.length === 1 &&
          only &&
          !only.defaultFunction &&
          /^[A-Z][A-Za-z\d]*$/.test(only.name) &&
          only.name !== only.name.toUpperCase()
        ) {
          report({
            message: `${only.name} is the only export of this file. Write it as export default function ${only.name}().`,
            node: only.node,
          });
        }
      },
    };
  },
);
