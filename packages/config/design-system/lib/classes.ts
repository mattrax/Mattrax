import { cookedOf, isClassAttribute, nameOf, valueNode } from "./ast.ts";
import type { Node } from "./ast.ts";
import { resolveImport } from "./paths.ts";
import type { Visitor } from "./ratchet.ts";

export interface ClassString {
  node: Node;
  text: string;
}

export const CLASS_FUNCTIONS = ["cn", "cva", "clsx", "twMerge"];

export const PLACEMENT_ROOTS = [
  "w",
  "h",
  "size",
  "min-w",
  "max-w",
  "min-h",
  "max-h",
  "basis",
  "m",
  "mx",
  "my",
  "mt",
  "mr",
  "mb",
  "ml",
  "ms",
  "me",
  "inset",
  "inset-x",
  "inset-y",
  "top",
  "right",
  "bottom",
  "left",
  "start",
  "end",
];

export const CONSTANT_TYPES = new Set([
  "ArrayExpression",
  "Literal",
  "ObjectExpression",
  "TemplateLiteral",
  "TSAsExpression",
  "TSSatisfiesExpression",
]);

export function moduleConstants(program: Node) {
  const constants = new Map<string, Node>();
  for (const statement of program.body ?? []) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    for (const { id, init } of declaration?.declarations ?? []) {
      const name = nameOf(id);
      if (name && init && CONSTANT_TYPES.has(init.type)) {
        constants.set(name, init);
      }
    }
  }
  return constants;
}

export function classStrings(
  node: Node | null | undefined,
  constants?: Map<string, Node>,
  calls = true,
): ClassString[] {
  const each = (child: Node | null | undefined) =>
    classStrings(child, constants, calls);
  if (!node) {
    return [];
  }
  switch (node.type) {
    case "Literal": {
      return typeof node.value === "string" ? [{ node, text: node.value }] : [];
    }
    case "TemplateLiteral": {
      return [
        ...(node.quasis ?? []).flatMap((quasi) => {
          const cooked = cookedOf(quasi);
          return cooked ? [{ node: quasi, text: cooked }] : [];
        }),
        ...(node.expressions ?? []).flatMap(each),
      ];
    }
    case "JSXExpressionContainer":
    case "TSAsExpression":
    case "TSSatisfiesExpression": {
      return each(node.expression);
    }
    case "CallExpression": {
      return calls ? (node.arguments ?? []).flatMap(each) : [];
    }
    case "ConditionalExpression": {
      return [...each(node.consequent), ...each(node.alternate)];
    }
    case "LogicalExpression": {
      return [...each(node.left), ...each(node.right)];
    }
    case "ArrayExpression": {
      return (node.elements ?? []).flatMap(each);
    }
    case "ObjectExpression": {
      return (node.properties ?? []).flatMap((property) =>
        each(property.key).concat(each(valueNode(property))),
      );
    }
    case "MemberExpression": {
      return each(node.object);
    }
    case "Identifier": {
      const name = nameOf(node) ?? "";
      const constant = constants?.get(name);
      constants?.delete(name);
      return classStrings(constant, constants, false);
    }
    default: {
      return [];
    }
  }
}

export function variantEnd(token: string) {
  let depth = 0;
  let end = 0;
  for (let index = 0; index < token.length; index++) {
    const character = token[index];
    if (character === "[" || character === "(") {
      depth++;
    } else if (character === "]" || character === ")") {
      depth--;
    } else if (character === ":" && depth === 0) {
      end = index + 1;
    }
  }
  return end;
}

export function variantOf(token: string) {
  return token.slice(0, variantEnd(token));
}

export function utilityOf(token: string) {
  return token
    .slice(variantEnd(token))
    .replace(/^!/, "")
    .replace(/!$/, "")
    .replace(/^-/, "");
}

export function tokensOf(text: string) {
  return text.split(/\s+/).filter(Boolean);
}

export function classAttribute(opening: Node) {
  return (opening.attributes ?? []).find(isClassAttribute);
}

export function classSites(
  functions: string[],
  inspect: (strings: ClassString[], attribute: Node | undefined) => void,
): Visitor {
  const classFunctions = new Set(functions);
  let constants = new Map<string, Node>();
  const isClassCall = (node: Node | undefined) =>
    node?.type === "CallExpression" &&
    classFunctions.has(nameOf(node.callee) ?? "");
  return {
    CallExpression(node: Node) {
      if (!isClassCall(node)) {
        return;
      }
      let current = node.parent;
      while (current) {
        if (isClassAttribute(current) || isClassCall(current)) {
          return;
        }
        current = current.parent;
      }
      inspect(classStrings(node, constants), undefined);
    },
    JSXAttribute(node: Node) {
      if (isClassAttribute(node)) {
        inspect(classStrings(valueNode(node), constants), node);
      }
    },
    Program(program: Node) {
      constants = moduleConstants(program);
    },
  };
}

export const ALIAS = { "@/": "src/" };

export function primitiveImports(
  prefixes: string[],
  file: string,
  alias: Record<string, string> = ALIAS,
) {
  const sources = new Map<string, string>();
  const folders = prefixes.map((prefix) =>
    (resolveImport(file, prefix, alias) ?? prefix).replace(/\/$/, ""),
  );
  const isPrimitive = (source: string) => {
    if (prefixes.some((prefix) => source.startsWith(prefix))) {
      return true;
    }
    const target = resolveImport(file, source, alias);
    return (
      target !== null &&
      folders.some((folder) => target.startsWith(`${folder}/`))
    );
  };
  return {
    collect(node: Node) {
      const source = node.source?.value;
      if (typeof source !== "string" || !isPrimitive(source)) {
        return;
      }
      for (const specifier of node.specifiers ?? []) {
        const local = nameOf(specifier.local);
        if (local) {
          sources.set(local, source);
        }
      }
    },
    sources,
  };
}

export function importVisitor(
  file: string,
  alias: Record<string, string>,
  check: (target: string, node: Node) => void,
): Visitor {
  const visit = (node: Node) => {
    const source = node.source?.value;
    const target =
      typeof source === "string" ? resolveImport(file, source, alias) : null;
    if (target) {
      check(target, node.source ?? node);
    }
  };
  return {
    ExportAllDeclaration: visit,
    ExportNamedDeclaration: visit,
    ImportDeclaration: visit,
    ImportExpression: visit,
  };
}

export const COLOR_ROOTS = [
  "text",
  "bg",
  "border",
  "border-[xytrblse]",
  "ring",
  "ring-offset",
  "inset-ring",
  "outline",
  "fill",
  "stroke",
  "divide",
  "decoration",
  "shadow",
  "inset-shadow",
  "from",
  "via",
  "to",
  "placeholder",
  "caret",
  "accent",
].join("|");

export const PALETTE = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];
