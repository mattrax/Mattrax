import { Data, Effect, Schema, SchemaAST as AST } from "effect";
import { getSoapElementName, soapAnnotations } from "./internal/annotations.js";
import { isSoapArray, isSoapObject, SoapValueSchema, type SoapValue } from "./internal/values.js";

export class SoapSerializeError extends Data.TaggedError("SoapSerializeError")<{
  message: string;
  cause?: unknown;
}> {}

interface SerializeOptions {
  readonly pretty: boolean;
  readonly indent: string;
  readonly depth: number;
}

interface SoapTag {
  readonly open: string;
  readonly close: string;
  readonly selfClose: string;
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

function serializePrimitiveValue(value: SoapValue): string {
  if (value === null || value === undefined) return "";

  if (Schema.is(Schema.String)(value)) return value;

  if (Schema.is(Schema.Number)(value) || Schema.is(Schema.Boolean)(value)) return String(value);

  if (Schema.is(Schema.BigInt)(value)) return value.toString();

  return JSON.stringify(value) ?? "";
}

function buildTag(
  name: string,
  attributes: ReadonlyArray<{ readonly name: string; readonly value: string }>,
  ns?: string,
  prefix?: string,
): SoapTag {
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

function serializeAst(
  ast: AST.AST,
  value: SoapValue,
  options: SerializeOptions,
  fallbackName: string = "root",
): string {
  if (AST.isString(ast) || AST.isNumber(ast) || AST.isBoolean(ast) || AST.isBigInt(ast)) {
    const name = getSoapElementName(ast, fallbackName);
    const annotations = soapAnnotations(ast);
    const tag = buildTag(name, [], annotations.namespace, annotations.namespacePrefix);

    return tag.open + escapeXml(serializePrimitiveValue(value)) + tag.close;
  }

  if (AST.isNull(ast) || AST.isVoid(ast) || AST.isUndefined(ast)) {
    const name = getSoapElementName(ast, fallbackName);
    const annotations = soapAnnotations(ast);

    return buildTag(name, [], annotations.namespace, annotations.namespacePrefix).selfClose;
  }

  if (AST.isLiteral(ast)) {
    const name = getSoapElementName(ast, fallbackName);
    const annotations = soapAnnotations(ast);
    const tag = buildTag(name, [], annotations.namespace, annotations.namespacePrefix);

    return tag.open + escapeXml(serializePrimitiveValue(value)) + tag.close;
  }

  if (AST.isObjects(ast)) {
    if (!isSoapObject(value)) {
      throw new Error(`Expected object for ${ast._tag}, got ${serializePrimitiveValue(value)}`);
    }

    const name = getSoapElementName(ast, fallbackName);
    const annotations = soapAnnotations(ast);

    const attributes: Array<{ name: string; value: string }> = [];
    const children: Array<string> = [];
    let textContent = "";

    for (const ps of ast.propertySignatures) {
      const propValue = value[String(ps.name)];
      const propAnnotations = soapAnnotations(ps.type);
      const isOptional = AST.isOptional(ps.type);
      const isNil = propAnnotations.optionalNil;

      if (propValue === undefined || propValue === null) {
        // Allow null/undefined for Null, Void, Undefined AST types
        const allowsNull = AST.isNull(ps.type) || AST.isVoid(ps.type) || AST.isUndefined(ps.type);

        if (allowsNull) {
          const elName = propAnnotations.elementName ?? String(ps.name);

          const tag = buildTag(
            elName,
            [],
            propAnnotations.namespace,
            propAnnotations.namespacePrefix,
          );

          children.push(indentLine(options.depth + 1, tag.selfClose, options));
          continue;
        }

        if (isOptional) {
          if (isNil) {
            const elName = propAnnotations.elementName ?? String(ps.name);

            children.push(indentLine(options.depth + 1, `<${elName} xsi:nil="true"/>`, options));
          }

          continue;
        }

        throw new Error(`Missing required property: ${String(ps.name)}`);
      }

      if (propAnnotations.attribute) {
        const attrName = propAnnotations.attributeName ?? String(ps.name);

        attributes.push({ name: attrName, value: serializePrimitiveValue(propValue) });
      } else if (propAnnotations.textContent) {
        textContent = serializePrimitiveValue(propValue);
      } else {
        const child = serializeAst(
          ps.type,
          propValue,
          { ...options, depth: options.depth + 1 },
          String(ps.name),
        );

        children.push(indentLine(options.depth + 1, child, options));
      }
    }

    const tag = buildTag(name, attributes, annotations.namespace, annotations.namespacePrefix);

    if (children.length === 0 && !textContent) {
      return indentLine(options.depth, tag.selfClose, options);
    }

    if (!options.pretty) {
      return tag.open + textContent + children.join("") + tag.close;
    }

    const lines = [
      indentLine(options.depth, tag.open + textContent, options),
      ...children,
      indentLine(options.depth, tag.close, options),
    ];

    return lines.join("\n");
  }

  if (AST.isArrays(ast)) {
    if (!isSoapArray(value)) {
      throw new Error(`Expected array, got ${serializePrimitiveValue(value)}`);
    }

    const arr = value;
    const name = getSoapElementName(ast, fallbackName);
    const annotations = soapAnnotations(ast);

    // Determine item AST
    let itemAst: AST.AST | undefined;

    if (ast.rest.length > 0) {
      itemAst = ast.rest[0];
    } else if (ast.elements.length > 0) {
      itemAst = ast.elements[0];
    }

    const itemName = itemAst ? getSoapElementName(itemAst, "item") : "item";
    const itemAnnotations = itemAst ? soapAnnotations(itemAst) : undefined;
    const itemNs = itemAnnotations?.namespace;
    const itemPrefix = itemAnnotations?.namespacePrefix;

    const children: Array<string> = [];

    for (const item of arr) {
      if (itemAst && isPrimitiveAst(itemAst)) {
        const tag = buildTag(itemName, [], itemNs, itemPrefix);
        children.push(
          indentLine(
            options.depth + 1,
            tag.open + escapeXml(serializePrimitiveValue(item)) + tag.close,
            options,
          ),
        );
      } else if (itemAst) {
        const child = serializeAst(
          itemAst,
          item,
          { ...options, depth: options.depth + 1 },
          itemName,
        );

        children.push(child);
      } else {
        const tag = buildTag(itemName, [], undefined, undefined);
        children.push(
          indentLine(
            options.depth + 1,
            tag.open + escapeXml(serializePrimitiveValue(item)) + tag.close,
            options,
          ),
        );
      }
    }

    const tag = buildTag(name, [], annotations.namespace, annotations.namespacePrefix);

    if (name === itemName) {
      return children.join(options.pretty ? "\n" : "");
    }

    if (children.length === 0) {
      return indentLine(options.depth, tag.selfClose, options);
    }

    if (!options.pretty) {
      return tag.open + children.join("") + tag.close;
    }

    const lines = [
      indentLine(options.depth, tag.open, options),
      ...children,
      indentLine(options.depth, tag.close, options),
    ];

    return lines.join("\n");
  }

  if (AST.isUnion(ast)) {
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

  if (AST.isSuspend(ast)) {
    return serializeAst(ast.thunk(), value, options, fallbackName);
  }

  if (AST.isTemplateLiteral(ast) || AST.isAny(ast) || AST.isUnknown(ast)) {
    const name = getSoapElementName(ast, fallbackName);
    const annotations = soapAnnotations(ast);
    const tag = buildTag(name, [], annotations.namespace, annotations.namespacePrefix);

    return tag.open + escapeXml(serializePrimitiveValue(value)) + tag.close;
  }

  throw new Error(`Unsupported AST type for SOAP serialization: ${ast._tag}`);
}

export function serializeSoapElement<T>(
  schema: Schema.Schema<T>,
  value: T,
  options?: { readonly pretty?: boolean; readonly indent?: string },
): Effect.Effect<string, SoapSerializeError> {
  return Effect.try({
    try: () => {
      if (!Schema.is(SoapValueSchema)(value)) {
        throw new Error(`Expected a SOAP-serializable value, got ${String(value)}`);
      }

      return serializeAst(schema.ast, value, {
        pretty: options?.pretty ?? true,
        indent: options?.indent ?? "  ",
        depth: 0,
      });
    },
    catch: (cause) => new SoapSerializeError({ message: String(cause), cause }),
  });
}
