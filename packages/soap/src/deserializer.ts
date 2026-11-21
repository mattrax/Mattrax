import { DOMParser } from "@xmldom/xmldom";
import type { Document, Element } from "@xmldom/xmldom";
import { Data, Effect, Schema, SchemaAST as AST } from "effect";
import { getSoapElementName, soapAnnotations } from "./internal/annotations.js";
import type { SoapObject, SoapValue } from "./internal/values.js";

export class SoapParseError extends Data.TaggedError("SoapParseError")<{
  message: string;
  cause?: unknown;
}> {}

function parseXml(xml: string): Document {
  const parser = new DOMParser();

  try {
    return parser.parseFromString(xml, "application/xml");
  } catch (error) {
    throw new Error(`XML parse error: ${String(error)}`, { cause: error });
  }
}

function findChild(element: Element, localName: string): Element | undefined {
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];

    if (child.localName === localName) {
      return child;
    }
  }

  return undefined;
}

function findChildren(element: Element, localName: string): ReadonlyArray<Element> {
  const result: Array<Element> = [];

  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];

    if (child.localName === localName) {
      result.push(child);
    }
  }

  return result;
}

function getTextContent(element: Element): string {
  return element.textContent ?? "";
}

function parseNumberText(text: string): number {
  const trimmed = text.trim();

  if (trimmed === "") return 0;

  if (trimmed === "Infinity") return Infinity;

  if (trimmed === "-Infinity") return -Infinity;

  if (trimmed === "NaN") return Number.NaN;

  return Number(trimmed);
}

function parseBigIntText(text: string): bigint {
  const trimmed = text.trim();

  if (trimmed === "") return 0n;

  return BigInt(trimmed);
}

/** Optional fields wrap the real schema in a Union with Undefined. */
function unwrapOptionalAst(ast: AST.AST): AST.AST {
  if (!AST.isUnion(ast)) return ast;

  const present = ast.types.filter((member) => !AST.isUndefined(member) && !AST.isVoid(member));

  return present.length === 1 ? present[0] : ast;
}

function hasXsiNil(element: Element): boolean {
  return element.getAttribute("xsi:nil") === "true" || element.getAttribute("nil") === "true";
}

function isPrimitiveAst(ast: AST.AST): boolean {
  return AST.isString(ast) || AST.isNumber(ast) || AST.isBoolean(ast) || AST.isBigInt(ast);
}

function deserializePrimitiveValue(ast: AST.AST, text: string): SoapValue {
  if (AST.isString(ast) || AST.isTemplateLiteral(ast) || AST.isLiteral(ast)) {
    return text;
  }

  if (AST.isNumber(ast)) {
    return parseNumberText(text);
  }

  if (AST.isBoolean(ast)) {
    return text.trim() === "true";
  }

  if (AST.isBigInt(ast)) {
    return parseBigIntText(text);
  }

  return text;
}

function deserializePrimitive(ast: AST.AST, text: string): SoapValue {
  return deserializePrimitiveValue(ast, text);
}

function deserializeBranch(ast: AST.AST, element: Element): SoapValue {
  return isPrimitiveAst(ast)
    ? deserializePrimitiveValue(ast, getTextContent(element))
    : deserializeValue(ast, element);
}

function deserializeValue(ast: AST.AST, element: Element): SoapValue {
  if (AST.isString(ast) || AST.isTemplateLiteral(ast)) {
    return getTextContent(element);
  }

  if (AST.isNumber(ast)) {
    return parseNumberText(getTextContent(element));
  }

  if (AST.isBoolean(ast)) {
    return getTextContent(element).trim() === "true";
  }

  if (AST.isBigInt(ast)) {
    return parseBigIntText(getTextContent(element));
  }

  if (AST.isNull(ast) || AST.isVoid(ast) || AST.isUndefined(ast)) {
    return null;
  }

  if (AST.isLiteral(ast) || AST.isAny(ast) || AST.isUnknown(ast)) {
    return getTextContent(element);
  }

  if (AST.isObjects(ast)) {
    const result: SoapObject = {};

    for (const ps of ast.propertySignatures) {
      const propName = String(ps.name);
      const valueAst = unwrapOptionalAst(ps.type);

      const propAnnotations = soapAnnotations(ps.type, valueAst);

      const isOptional = AST.isOptional(ps.type);
      const elName = getSoapElementName(valueAst, getSoapElementName(ps.type, propName));

      if (propAnnotations.attribute) {
        const attrName = propAnnotations.attributeName ?? propName;
        const attrValue = element.getAttribute(attrName);

        if (attrValue === null) {
          if (!isOptional) {
            throw new Error(`Missing required attribute: ${attrName}`);
          }
        } else {
          result[propName] = deserializePrimitive(ps.type, attrValue);
        }
      } else if (propAnnotations.textContent) {
        result[propName] = deserializePrimitive(ps.type, getTextContent(element).trim());
      } else {
        const child = findChild(element, elName);

        if (!child) {
          if (!isOptional) {
            throw new Error(`Missing required element: ${elName}`);
          }

          if (propAnnotations.optionalNil) {
            result[propName] = undefined;
          }
        } else if (hasXsiNil(child)) {
          result[propName] = undefined;
        } else {
          const itemAst = AST.isArrays(valueAst) ? valueAst.rest[0] : undefined;

          const repeatedDirectly =
            AST.isArrays(valueAst) &&
            itemAst !== undefined &&
            getSoapElementName(valueAst, propName) === getSoapElementName(itemAst, "item");

          result[propName] = deserializeValue(ps.type, repeatedDirectly ? element : child);
        }
      }
    }

    return result;
  }

  if (AST.isArrays(ast)) {
    const result: Array<SoapValue> = [];

    if (ast.rest.length > 0) {
      // Array<T> - all children are items
      const itemAst = ast.rest[0];
      const itemName = getSoapElementName(itemAst, "item");

      const children = element.localName === itemName ? [element] : findChildren(element, itemName);

      for (const child of children) {
        result.push(deserializeBranch(itemAst, child));
      }

      // Also handle case where array items use different names
      if (children.length === 0) {
        for (let i = 0; i < element.children.length; i++) {
          result.push(deserializeBranch(itemAst, element.children[i]));
        }
      }
    } else if (ast.elements.length > 0) {
      // Tuple - match children by position
      for (let i = 0; i < ast.elements.length; i++) {
        const itemAst = ast.elements[i];
        const itemName = getSoapElementName(itemAst, "item");
        const child = findChild(element, itemName) ?? element.children[i];

        if (!child) {
          if (!AST.isOptional(itemAst)) {
            throw new Error(`Missing tuple element at index ${i}`);
          }

          continue;
        }

        result.push(deserializeBranch(itemAst, child));
      }
    } else {
      // Untyped array - just collect text of all children
      for (let i = 0; i < element.children.length; i++) {
        result.push(getTextContent(element.children[i]));
      }
    }

    return result;
  }

  if (AST.isUnion(ast)) {
    // For unions, try each member and see which one succeeds
    // Special case: if one branch is Undefined, treat as optional
    const nonUndefinedBranches = ast.types.filter(
      (member) => !AST.isUndefined(member) && !AST.isVoid(member),
    );

    if (
      nonUndefinedBranches.length === 1 &&
      ast.types.some((member) => AST.isUndefined(member) || AST.isVoid(member))
    ) {
      // This is essentially an optional type
      return deserializeBranch(nonUndefinedBranches[0], element);
    }

    for (const member of nonUndefinedBranches) {
      try {
        return deserializeBranch(member, element);
      } catch {
        // try next member
      }
    }

    // Fallback: return text content
    return getTextContent(element);
  }

  if (AST.isSuspend(ast)) {
    return deserializeValue(ast.thunk(), element);
  }

  throw new Error(`Unsupported AST type for SOAP deserialization: ${ast._tag}`);
}

function rootElement(doc: Document): Element | undefined {
  return doc.documentElement ?? undefined;
}

export function deserializeSoapElement<T, RD>(
  xml: string,
  schema: Schema.Decoder<T, RD>,
): Effect.Effect<T, SoapParseError | Schema.SchemaError, RD> {
  return Effect.gen(function* () {
    const doc = yield* Effect.try({
      try: () => parseXml(xml),
      catch: (cause) => new SoapParseError({ message: String(cause), cause }),
    });

    const root = rootElement(doc);

    if (root === undefined) {
      return yield* Effect.fail(new SoapParseError({ message: "Expected a root element" }));
    }

    const raw = yield* Effect.try({
      try: () => deserializeValue(schema.ast, root),
      catch: (cause) => new SoapParseError({ message: String(cause), cause }),
    });

    return yield* Schema.decodeUnknownEffect(schema)(raw);
  });
}

export function deserializeSoapBody<T, RD>(
  xml: string,
  schema: Schema.Decoder<T, RD>,
): Effect.Effect<T, SoapParseError | Schema.SchemaError, RD> {
  return Effect.gen(function* () {
    const doc = yield* Effect.try({
      try: () => parseXml(xml),
      catch: (cause) => new SoapParseError({ message: String(cause), cause }),
    });

    const envelope = rootElement(doc);

    if (envelope === undefined || envelope.localName !== "Envelope") {
      return yield* Effect.fail(
        new SoapParseError({ message: "Expected SOAP Envelope as root element" }),
      );
    }

    const body = findChild(envelope, "Body");

    if (!body) {
      return yield* Effect.fail(new SoapParseError({ message: "SOAP Body not found in envelope" }));
    }

    const firstChild = body.children[0];

    if (!firstChild) {
      return yield* Effect.fail(new SoapParseError({ message: "SOAP Body is empty" }));
    }

    const raw = yield* Effect.try({
      try: () => deserializeValue(schema.ast, firstChild),
      catch: (cause) => new SoapParseError({ message: String(cause), cause }),
    });

    return yield* Schema.decodeUnknownEffect(schema)(raw);
  });
}
