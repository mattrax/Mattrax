import { Effect, Schema, SchemaAST as AST } from "effect";
import { resolveAnnotations, getSoapElementName } from "./internal/annotations.js";

export class SoapSerializeError {
  readonly _tag = "SoapSerializeError";
  constructor(
    readonly message: string,
    readonly cause?: unknown
  ) {}
}

interface SerializeOptions {
  readonly pretty: boolean;
  readonly indent: string;
  readonly depth: number;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeAttr(value: string): string {
  return escapeXml(value).replace(/"/g, "&quot;");
}

function indentLine(depth: number, text: string, options: SerializeOptions): string {
  if (!options.pretty) return text;
  return options.indent.repeat(depth) + text;
}

function isPrimitiveAst(ast: AST.AST): boolean {
  return AST.isString(ast) || AST.isNumber(ast) || AST.isBoolean(ast) || AST.isBigInt(ast);
}

function serializePrimitiveValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "bigint") return value.toString();
  return String(value);
}

function buildTag(
  name: string,
  attributes: ReadonlyArray<{ readonly name: string; readonly value: string }>,
  ns?: string,
  prefix?: string
): { open: string; close: string; selfClose: string } {
  const tagName = prefix ? `${prefix}:${name}` : name;
  let attrs = attributes.map((a) => ` ${a.name}="${escapeAttr(a.value)}"`).join("");
  if (ns) {
    attrs += prefix ? ` xmlns:${prefix}="${escapeAttr(ns)}"` : ` xmlns="${escapeAttr(ns)}"`;
  }
  return {
    open: `<${tagName}${attrs}>`,
    close: `</${tagName}>`,
    selfClose: `<${tagName}${attrs}/>`,
  };
}

function serializeAst(ast: AST.AST, value: unknown, options: SerializeOptions, fallbackName: string = "root"): string {
  switch (ast._tag) {
    case "String":
    case "Number":
    case "Boolean":
    case "BigInt": {
      const name = getSoapElementName(ast, fallbackName);
      const annotations = resolveAnnotations(ast);
      const ns = annotations?.soapNamespace;
      const prefix = annotations?.soapNamespacePrefix;
      const tag = buildTag(name, [], ns, prefix);
      return tag.open + escapeXml(serializePrimitiveValue(value)) + tag.close;
    }

    case "Null":
    case "Void":
    case "Undefined": {
      const name = getSoapElementName(ast, fallbackName);
      const annotations = resolveAnnotations(ast);
      const ns = annotations?.soapNamespace;
      const prefix = annotations?.soapNamespacePrefix;
      return buildTag(name, [], ns, prefix).selfClose;
    }

    case "Literal": {
      const name = getSoapElementName(ast, fallbackName);
      const annotations = resolveAnnotations(ast);
      const ns = annotations?.soapNamespace;
      const prefix = annotations?.soapNamespacePrefix;
      const tag = buildTag(name, [], ns, prefix);
      return tag.open + escapeXml(serializePrimitiveValue(value)) + tag.close;
    }

    case "Objects": {
      if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Expected object for ${ast._tag}, got ${typeof value}`);
      }
      const obj = value as Record<string, unknown>;
      const name = getSoapElementName(ast, fallbackName);
      const annotations = resolveAnnotations(ast);
      const ns = annotations?.soapNamespace;
      const prefix = annotations?.soapNamespacePrefix;

      const attributes: Array<{ name: string; value: string }> = [];
      const children: Array<string> = [];
      let textContent = "";

      for (const ps of ast.propertySignatures) {
        const propValue = obj[ps.name as string];
        const propAnnotations = resolveAnnotations(ps.type) as Record<string, unknown> | undefined;
        const isOptional = AST.isOptional(ps.type);
        const isNil = propAnnotations?.soapOptionalNil === true;

        if (propValue === undefined || propValue === null) {
          // Allow null/undefined for Null, Void, Undefined AST types
          const allowsNull = ps.type._tag === "Null" || ps.type._tag === "Void" || ps.type._tag === "Undefined";
          if (allowsNull) {
            const elName = (propAnnotations?.soapElementName as string | undefined) ?? String(ps.name);
            const ns = propAnnotations?.soapNamespace as string | undefined;
            const prefix = propAnnotations?.soapNamespacePrefix as string | undefined;
            const tag = buildTag(elName, [], ns, prefix);
            children.push(indentLine(options.depth + 1, tag.selfClose, options));
            continue;
          }
          if (isOptional) {
            if (isNil) {
              const elName = (propAnnotations?.soapElementName as string | undefined) ?? String(ps.name);
              children.push(indentLine(options.depth + 1, `<${elName} xsi:nil="true"/>`, options));
            }
            continue;
          }
          throw new Error(`Missing required property: ${String(ps.name)}`);
        }

        if (propAnnotations?.soapAttribute === true) {
          const attrName = (propAnnotations?.soapAttributeName as string | undefined) ?? String(ps.name);
          attributes.push({ name: attrName, value: serializePrimitiveValue(propValue) });
        } else if (propAnnotations?.soapTextContent === true) {
          textContent = serializePrimitiveValue(propValue);
        } else {
          const child = serializeAst(ps.type, propValue, { ...options, depth: options.depth + 1 }, String(ps.name));
          children.push(indentLine(options.depth + 1, child, options));
        }
      }

      const tag = buildTag(name, attributes, ns, prefix);

      if (children.length === 0 && !textContent) {
        return indentLine(options.depth, tag.selfClose, options);
      }

      if (!options.pretty) {
        return tag.open + textContent + children.join("") + tag.close;
      }

      const lines = [indentLine(options.depth, tag.open + textContent, options), ...children, indentLine(options.depth, tag.close, options)];
      return lines.join("\n");
    }

    case "Arrays": {
      if (!Array.isArray(value)) {
        throw new Error(`Expected array, got ${typeof value}`);
      }
      const arr = value as ReadonlyArray<unknown>;
      const name = getSoapElementName(ast, fallbackName);
      const annotations = resolveAnnotations(ast);
      const ns = annotations?.soapNamespace;
      const prefix = annotations?.soapNamespacePrefix;

      // Determine item AST
      let itemAst: AST.AST | undefined;
      if (ast.rest.length > 0) {
        itemAst = ast.rest[0];
      } else if (ast.elements.length > 0) {
        itemAst = ast.elements[0];
      }

      const itemName = itemAst ? getSoapElementName(itemAst, "item") : "item";
      const itemAnnotations = itemAst ? resolveAnnotations(itemAst) : undefined;
      const itemNs = itemAnnotations?.soapNamespace;
      const itemPrefix = itemAnnotations?.soapNamespacePrefix;

      const children: Array<string> = [];
      for (const item of arr) {
        if (itemAst && isPrimitiveAst(itemAst)) {
          const tag = buildTag(itemName, [], itemNs, itemPrefix);
          children.push(indentLine(options.depth + 1, tag.open + escapeXml(serializePrimitiveValue(item)) + tag.close, options));
        } else if (itemAst) {
          const child = serializeAst(itemAst, item, { ...options, depth: options.depth + 1 }, itemName);
          children.push(child);
        } else {
          const tag = buildTag(itemName, [], undefined, undefined);
          children.push(indentLine(options.depth + 1, tag.open + escapeXml(serializePrimitiveValue(item)) + tag.close, options));
        }
      }

      const tag = buildTag(name, [], ns, prefix);
      if (children.length === 0) {
        return indentLine(options.depth, tag.selfClose, options);
      }

      if (!options.pretty) {
        return tag.open + children.join("") + tag.close;
      }

      const lines = [indentLine(options.depth, tag.open, options), ...children, indentLine(options.depth, tag.close, options)];
      return lines.join("\n");
    }

    case "Union": {
      // Try each union member until one serializes successfully
      const unionName = getSoapElementName(ast, fallbackName);
      for (const member of ast.types) {
        try {
          return serializeAst(member, value, options, unionName);
        } catch {
          // continue to next member
        }
      }
      throw new Error(`Could not serialize union value: ${JSON.stringify(value)}`);
    }

    case "Suspend": {
      return serializeAst(ast.thunk(), value, options, fallbackName);
    }

    case "TemplateLiteral": {
      const name = getSoapElementName(ast, fallbackName);
      const annotations = resolveAnnotations(ast);
      const ns = annotations?.soapNamespace;
      const prefix = annotations?.soapNamespacePrefix;
      const tag = buildTag(name, [], ns, prefix);
      return tag.open + escapeXml(serializePrimitiveValue(value)) + tag.close;
    }

    case "Any":
    case "Unknown": {
      const name = getSoapElementName(ast, fallbackName);
      const annotations = resolveAnnotations(ast);
      const ns = annotations?.soapNamespace;
      const prefix = annotations?.soapNamespacePrefix;
      const tag = buildTag(name, [], ns, prefix);
      return tag.open + escapeXml(serializePrimitiveValue(value)) + tag.close;
    }

    default:
      throw new Error(`Unsupported AST type for SOAP serialization: ${ast._tag}`);
  }
}

export function serializeSoapElement<T>(
  schema: Schema.Schema<T>,
  value: T,
  options?: { readonly pretty?: boolean; readonly indent?: string }
): Effect.Effect<string, SoapSerializeError> {
  return Effect.try({
    try: () =>
      serializeAst(schema.ast, value, {
        pretty: options?.pretty ?? true,
        indent: options?.indent ?? "  ",
        depth: 0,
      }),
    catch: (cause) => new SoapSerializeError(String(cause), cause),
  });
}
