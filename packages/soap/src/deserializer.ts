import { DOMParser } from "@xmldom/xmldom";
import { Effect, Schema, SchemaAST as AST } from "effect";
import { resolveAnnotations, getSoapElementName } from "./internal/annotations.js";

export class SoapParseError {
  readonly _tag = "SoapParseError";
  constructor(
    readonly message: string,
    readonly cause?: unknown,
  ) {}
}

function parseXml(xml: string): Document {
  const parser = new DOMParser();

  try {
    const doc = parser.parseFromString(xml, "application/xml") as unknown as Document;

    return doc;
  } catch (error) {
    throw new Error(`XML parse error: ${error}`);
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

/** Optional fields wrap the real schema in a Union with Undefined. */
function unwrapOptionalAst(ast: AST.AST): AST.AST {
  if (ast._tag !== "Union") return ast;

  const present = ast.types.filter(
    (member) => member._tag !== "Undefined" && member._tag !== "Void",
  );

  return present.length === 1 ? present[0]! : ast;
}

function hasXsiNil(element: Element): boolean {
  return element.getAttribute("xsi:nil") === "true" || element.getAttribute("nil") === "true";
}

function deserializeToUnknown(ast: AST.AST, element: Element): unknown {
  switch (ast._tag) {
    case "String":
    case "TemplateLiteral":
      return getTextContent(element);

    case "Number": {
      const text = getTextContent(element).trim();

      if (text === "") return 0;

      if (text === "Infinity") return Infinity;

      if (text === "-Infinity") return -Infinity;

      if (text === "NaN") return NaN;

      return Number(text);
    }

    case "Boolean":
      return getTextContent(element).trim() === "true";

    case "BigInt": {
      const trimmed = getTextContent(element).trim();

      if (trimmed === "") return 0n;

      return BigInt(trimmed);
    }

    case "Null":
    case "Void":
    case "Undefined":
      return null;

    case "Literal":
      return getTextContent(element);

    case "Any":
    case "Unknown":
      return getTextContent(element);

    case "Objects": {
      const result: Record<string, unknown> = {};

      for (const ps of ast.propertySignatures) {
        const propName = String(ps.name);
        const valueAst = unwrapOptionalAst(ps.type);

        const propAnnotations = {
          ...resolveAnnotations(ps.type),
          ...resolveAnnotations(valueAst),
        } as Record<string, unknown> | undefined;

        const isOptional = AST.isOptional(ps.type);
        const elName = getSoapElementName(valueAst, getSoapElementName(ps.type, propName));

        if (propAnnotations?.soapAttribute === true) {
          const attrName = (propAnnotations?.soapAttributeName as string | undefined) ?? propName;
          const attrValue = element.getAttribute(attrName);

          if (attrValue === null) {
            if (!isOptional) {
              throw new Error(`Missing required attribute: ${attrName}`);
            }
          } else {
            result[propName] = deserializePrimitive(ps.type, attrValue);
          }
        } else if (propAnnotations?.soapTextContent === true) {
          result[propName] = deserializePrimitive(ps.type, getTextContent(element).trim());
        } else {
          const child = findChild(element, elName);

          if (!child) {
            if (!isOptional) {
              throw new Error(`Missing required element: ${elName}`);
            }

            if (propAnnotations?.soapOptionalNil === true) {
              result[propName] = undefined;
            }
          } else if (hasXsiNil(child)) {
            result[propName] = undefined;
          } else {
            const itemAst = valueAst._tag === "Arrays" ? valueAst.rest[0] : undefined;

            const repeatedDirectly =
              valueAst._tag === "Arrays" &&
              itemAst !== undefined &&
              getSoapElementName(valueAst, propName) === getSoapElementName(itemAst, "item");

            result[propName] = deserializeToUnknown(ps.type, repeatedDirectly ? element : child);
          }
        }
      }

      return result;
    }

    case "Arrays": {
      const result: Array<unknown> = [];

      if (ast.rest.length > 0) {
        // Array<T> - all children are items
        const itemAst = ast.rest[0];
        const itemName = getSoapElementName(itemAst, "item");

        const children =
          element.localName === itemName ? [element] : findChildren(element, itemName);

        for (const child of children) {
          if (isPrimitiveAst(itemAst)) {
            result.push(deserializePrimitiveValue(itemAst, getTextContent(child)));
          } else {
            result.push(deserializeToUnknown(itemAst, child));
          }
        }

        // Also handle case where array items use different names
        if (children.length === 0) {
          for (let i = 0; i < element.children.length; i++) {
            const child = element.children[i];

            if (isPrimitiveAst(itemAst)) {
              result.push(deserializePrimitiveValue(itemAst, getTextContent(child)));
            } else {
              result.push(deserializeToUnknown(itemAst, child));
            }
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

          if (isPrimitiveAst(itemAst)) {
            result.push(deserializePrimitiveValue(itemAst, getTextContent(child)));
          } else {
            result.push(deserializeToUnknown(itemAst, child));
          }
        }
      } else {
        // Untyped array - just collect text of all children
        for (let i = 0; i < element.children.length; i++) {
          result.push(getTextContent(element.children[i]));
        }
      }

      return result;
    }

    case "Union": {
      // For unions, try each member and see which one succeeds
      // Special case: if one branch is Undefined, treat as optional
      const nonUndefinedBranches = ast.types.filter(
        (t) => t._tag !== "Undefined" && t._tag !== "Void",
      );

      if (
        nonUndefinedBranches.length === 1 &&
        ast.types.some((t) => t._tag === "Undefined" || t._tag === "Void")
      ) {
        // This is essentially an optional type
        const branch = nonUndefinedBranches[0];

        if (isPrimitiveAst(branch)) {
          return deserializePrimitiveValue(branch, getTextContent(element));
        }

        return deserializeToUnknown(branch, element);
      }

      for (const member of nonUndefinedBranches) {
        try {
          if (isPrimitiveAst(member)) {
            return deserializePrimitiveValue(member, getTextContent(element));
          }

          return deserializeToUnknown(member, element);
        } catch {
          // try next member
        }
      }

      // Fallback: return text content
      return getTextContent(element);
    }

    case "Suspend": {
      return deserializeToUnknown(ast.thunk(), element);
    }

    default:
      throw new Error(`Unsupported AST type for SOAP deserialization: ${ast._tag}`);
  }
}

function isPrimitiveAst(ast: AST.AST): boolean {
  return AST.isString(ast) || AST.isNumber(ast) || AST.isBoolean(ast) || AST.isBigInt(ast);
}

function deserializePrimitiveValue(ast: AST.AST, text: string): unknown {
  switch (ast._tag) {
    case "String":
    case "TemplateLiteral":
      return text;
    case "Number": {
      const trimmed = text.trim();

      if (trimmed === "") return 0;

      if (trimmed === "Infinity") return Infinity;

      if (trimmed === "-Infinity") return -Infinity;

      if (trimmed === "NaN") return NaN;

      return Number(trimmed);
    }

    case "Boolean":
      return text.trim() === "true";
    case "BigInt": {
      const trimmed = text.trim();

      if (trimmed === "") return 0n;

      return BigInt(trimmed);
    }

    case "Literal":
      return text;
    default:
      return text;
  }
}

function deserializePrimitive(ast: AST.AST, text: string): unknown {
  return deserializePrimitiveValue(ast, text);
}

export function deserializeSoapElement<T>(
  xml: string,
  schema: Schema.Schema<T>,
): Effect.Effect<T, SoapParseError | Schema.SchemaError> {
  return Effect.gen(function* () {
    const doc = yield* Effect.try({
      try: () => parseXml(xml),
      catch: (cause) => new SoapParseError(String(cause), cause),
    });

    const root = doc.documentElement;

    const raw = yield* Effect.try({
      try: () => deserializeToUnknown(schema.ast, root),
      catch: (cause) => new SoapParseError(String(cause), cause),
    });

    return yield* Schema.decodeUnknownEffect(schema)(raw);
  }) as Effect.Effect<T, SoapParseError | Schema.SchemaError>;
}

export function deserializeSoapBody<T>(
  xml: string,
  schema: Schema.Schema<T>,
): Effect.Effect<T, SoapParseError | Schema.SchemaError> {
  return Effect.gen(function* () {
    const doc = yield* Effect.try({
      try: () => parseXml(xml),
      catch: (cause) => new SoapParseError(String(cause), cause),
    });

    const envelope = doc.documentElement;

    if (envelope.localName !== "Envelope") {
      return yield* Effect.fail(new SoapParseError("Expected SOAP Envelope as root element"));
    }

    const body = findChild(envelope, "Body");

    if (!body) {
      return yield* Effect.fail(new SoapParseError("SOAP Body not found in envelope"));
    }

    const firstChild = body.children[0];

    if (!firstChild) {
      return yield* Effect.fail(new SoapParseError("SOAP Body is empty"));
    }

    const raw = yield* Effect.try({
      try: () => deserializeToUnknown(schema.ast, firstChild),
      catch: (cause) => new SoapParseError(String(cause), cause),
    });

    return yield* Schema.decodeUnknownEffect(schema)(raw);
  }) as Effect.Effect<T, SoapParseError | Schema.SchemaError>;
}
