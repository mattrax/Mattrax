import type { Document, Element } from "@xmldom/xmldom";
import { Effect, Option, Schema, SchemaAST as AST } from "effect";
import { getSoapElementName, soapAnnotations } from "./internal/annotations.js";
import type { SoapObject, SoapValue } from "./internal/values.js";
import { SoapEnvelopeNs, XsiNs } from "./namespaces.js";
import { parseXmlDocument } from "./xml.js";

const schemaFromAst = (ast: AST.AST): Schema.Decoder<unknown> =>
  Schema.make(ast) as Schema.Decoder<unknown>;

export class SoapParseError extends Schema.TaggedError<SoapParseError>()("SoapParseError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

function parseXml(xml: string): Document {
  return parseXmlDocument(xml);
}

function findChild(element: Element, localName: string, namespace?: string): Element | undefined {
  const matches: Array<Element> = [];

  for (let index = 0; index < element.children.length; index++) {
    const child = element.children[index]!;

    if (child.localName !== localName) continue;
    if (namespace !== undefined && child.namespaceURI !== namespace) continue;

    matches.push(child);
  }

  if (matches.length > 1) {
    const namespaces = new Set(matches.map((child) => child.namespaceURI));

    if (namespaces.size > 1) {
      throw new Error(`Ambiguous SOAP element ${localName}: multiple namespaces`);
    }
  }

  return matches[0];
}

function findChildren(
  element: Element,
  localName: string,
  namespace?: string,
): ReadonlyArray<Element> {
  const result: Array<Element> = [];

  for (let index = 0; index < element.children.length; index++) {
    const child = element.children[index]!;

    if (child.localName !== localName) continue;
    if (namespace !== undefined && child.namespaceURI !== namespace) continue;

    result.push(child);
  }

  if (namespace === undefined && result.length > 1) {
    const namespaces = new Set(result.map((child) => child.namespaceURI));

    if (namespaces.size > 1) {
      throw new Error(`Ambiguous SOAP elements ${localName}: multiple namespaces`);
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

  const value = Number(trimmed);

  if (Number.isNaN(value)) throw new Error(`Invalid SOAP number: ${text}`);

  return value;
}

function parseBooleanText(text: string): boolean {
  const trimmed = text.trim();

  if (trimmed === "true" || trimmed === "1") return true;
  if (trimmed === "false" || trimmed === "0") return false;

  throw new Error(`Invalid SOAP boolean: ${text}`);
}

function parseBigIntText(text: string): bigint {
  const trimmed = text.trim();

  return trimmed === "" ? 0n : BigInt(trimmed);
}

function resolveSuspend(ast: AST.AST): AST.AST {
  return AST.isSuspend(ast) ? resolveSuspend(ast.thunk()) : ast;
}

/** Optional fields wrap the real schema in a Union with Undefined. */
function unwrapOptionalAst(ast: AST.AST): AST.AST {
  if (!AST.isUnion(ast)) return resolveSuspend(ast);

  const present = ast.types.filter((member) => !AST.isUndefined(member) && !AST.isVoid(member));

  return present.length === 1 ? resolveSuspend(present[0]!) : ast;
}

function astAllowsNil(ast: AST.AST): boolean {
  const resolved = resolveSuspend(ast);

  if (AST.isNull(resolved) || AST.isUndefined(resolved) || AST.isVoid(resolved)) return true;
  if (AST.isUnion(resolved)) return resolved.types.some(astAllowsNil);

  return false;
}

function nilValue(ast: AST.AST): null | undefined {
  const resolved = resolveSuspend(ast);

  if (AST.isNull(resolved)) return null;
  if (AST.isUnion(resolved) && resolved.types.some(AST.isNull)) return null;

  return undefined;
}

function hasXsiNil(element: Element): boolean {
  const value = element.getAttributeNS(XsiNs, "nil");

  return value === "true" || value === "1";
}

function isPrimitiveAst(ast: AST.AST): boolean {
  const resolved = resolveSuspend(ast);

  return (
    AST.isString(resolved) ||
    AST.isNumber(resolved) ||
    AST.isBoolean(resolved) ||
    AST.isBigInt(resolved) ||
    AST.isLiteral(resolved)
  );
}

function deserializePrimitiveValue(ast: AST.AST, text: string): SoapValue {
  const resolved = resolveSuspend(ast);

  if (AST.isString(resolved) || AST.isTemplateLiteral(resolved)) return text;
  if (AST.isNumber(resolved)) return parseNumberText(text);
  if (AST.isBoolean(resolved)) return parseBooleanText(text);
  if (AST.isBigInt(resolved)) return parseBigIntText(text);

  if (AST.isLiteral(resolved)) {
    switch (typeof resolved.literal) {
      case "string":
        return text;
      case "number":
        return parseNumberText(text);
      case "boolean":
        return parseBooleanText(text);
      case "bigint":
        return parseBigIntText(text);
      default:
        return text;
    }
  }

  return text;
}

function deserializePrimitive(ast: AST.AST, text: string): SoapValue {
  return deserializePrimitiveValue(unwrapOptionalAst(ast), text);
}

function assertElement(ast: AST.AST, element: Element): void {
  const annotations = soapAnnotations(ast);

  if (annotations.namespace !== undefined && element.namespaceURI !== annotations.namespace) {
    throw new Error(
      `SOAP element ${element.localName} is in namespace ${String(element.namespaceURI)}, expected ${annotations.namespace}`,
    );
  }
}

function deserializeBranch(
  ast: AST.AST,
  element: Element,
  forceArrayCollection = false,
): SoapValue {
  if (hasXsiNil(element) && astAllowsNil(ast)) return nilValue(ast);

  return isPrimitiveAst(ast)
    ? deserializePrimitiveValue(ast, getTextContent(element))
    : deserializeValue(ast, element, forceArrayCollection);
}

function recordKey(element: Element): string {
  return element.namespaceURI === null
    ? (element.localName ?? element.nodeName)
    : `{${element.namespaceURI}}${element.localName ?? element.nodeName}`;
}

function indexSignatureFor(ast: AST.Objects, key: string): AST.IndexSignature | undefined {
  for (const index of ast.indexSignatures) {
    const schema = schemaFromAst(index.parameter);

    if (Option.isSome(Schema.decodeUnknownOption(schema)(key))) return index;
  }

  return undefined;
}

function deserializeValue(ast: AST.AST, element: Element, forceArrayCollection = false): SoapValue {
  const resolved = resolveSuspend(ast);

  if (hasXsiNil(element) && astAllowsNil(resolved)) return nilValue(resolved);

  if (AST.isString(resolved) || AST.isTemplateLiteral(resolved)) return getTextContent(element);
  if (AST.isNumber(resolved)) return parseNumberText(getTextContent(element));
  if (AST.isBoolean(resolved)) return parseBooleanText(getTextContent(element));
  if (AST.isBigInt(resolved)) return parseBigIntText(getTextContent(element));

  if (AST.isNull(resolved) || AST.isVoid(resolved) || AST.isUndefined(resolved)) return null;

  if (AST.isLiteral(resolved)) return deserializePrimitiveValue(resolved, getTextContent(element));
  if (AST.isAny(resolved) || AST.isUnknown(resolved)) return getTextContent(element);

  if (AST.isObjects(resolved)) {
    assertElement(resolved, element);

    const result: SoapObject = {};
    const consumed = new Set<Element>();

    for (const property of resolved.propertySignatures) {
      const propName = String(property.name);
      const valueAst = unwrapOptionalAst(property.type);
      const propAnnotations = soapAnnotations(property.type, valueAst);
      const isOptional = AST.isOptional(property.type);
      const elName = getSoapElementName(valueAst, getSoapElementName(property.type, propName));

      if (propAnnotations.attribute) {
        const attrName = propAnnotations.attributeName ?? propName;
        const attrValue = attributeValue(element, attrName);

        if (attrValue === null) {
          if (!isOptional) throw new Error(`Missing required attribute: ${attrName}`);
        } else {
          result[propName] = deserializePrimitive(property.type, attrValue);
        }
      } else if (propAnnotations.textContent) {
        result[propName] = deserializePrimitive(property.type, getTextContent(element).trim());
      } else {
        const child = findChild(element, elName, propAnnotations.namespace);

        if (!child) {
          if (!isOptional) throw new Error(`Missing required element: ${elName}`);
          if (propAnnotations.optionalNil) result[propName] = undefined;
          continue;
        }

        consumed.add(child);

        if (hasXsiNil(child)) {
          if (propAnnotations.optionalNil || isOptional || astAllowsNil(valueAst)) {
            result[propName] = nilValue(valueAst);
            continue;
          }

          throw new Error(`SOAP element ${elName} is nil but the schema requires a value`);
        }

        const itemAst = AST.isArrays(valueAst) ? valueAst.rest[0] : undefined;
        const repeatedDirectly =
          AST.isArrays(valueAst) &&
          itemAst !== undefined &&
          getSoapElementName(valueAst, propName) === getSoapElementName(itemAst, "item");

        result[propName] = deserializeValue(property.type, repeatedDirectly ? element : child);
      }
    }

    if (resolved.indexSignatures.length > 0) {
      for (let childIndex = 0; childIndex < element.children.length; childIndex++) {
        const child = element.children[childIndex]!;

        if (consumed.has(child)) continue;

        const key = recordKey(child);
        const index = indexSignatureFor(resolved, key);

        if (!index) throw new Error(`SOAP record has no matching schema for element ${key}`);

        assertElement(index.type, child);

        if (Object.hasOwn(result, key)) {
          throw new Error(`Duplicate SOAP record element: ${key}`);
        }

        result[key] = deserializeBranch(index.type, child, true);
      }
    }

    return result;
  }

  if (AST.isArrays(resolved)) {
    const result: Array<SoapValue> = [];

    if (resolved.rest.length > 0) {
      const itemAst = resolved.rest[0]!;
      const itemAnnotations = soapAnnotations(itemAst);
      const itemName = getSoapElementName(itemAst, "item");
      const children =
        !forceArrayCollection && element.localName === itemName
          ? [element]
          : findChildren(element, itemName, itemAnnotations.namespace);

      if (children.length > 0) {
        for (const child of children) result.push(deserializeBranch(itemAst, child));
      } else {
        for (let index = 0; index < element.children.length; index++) {
          const child = element.children[index]!;
          assertElement(itemAst, child);
          result.push(deserializeBranch(itemAst, child));
        }
      }
    } else if (resolved.elements.length > 0) {
      for (let index = 0; index < resolved.elements.length; index++) {
        const itemAst = resolved.elements[index]!;
        const itemName = getSoapElementName(itemAst, "item");
        const child =
          findChild(element, itemName, soapAnnotations(itemAst).namespace) ??
          element.children[index];

        if (!child) {
          if (!AST.isOptional(itemAst)) throw new Error(`Missing tuple element at index ${index}`);
          continue;
        }

        result.push(deserializeBranch(itemAst, child));
      }
    } else {
      for (let index = 0; index < element.children.length; index++) {
        result.push(getTextContent(element.children[index]!));
      }
    }

    return result;
  }

  if (AST.isUnion(resolved)) {
    const nonUndefinedBranches = resolved.types.filter(
      (member) => !AST.isUndefined(member) && !AST.isVoid(member),
    );

    if (
      nonUndefinedBranches.length === 1 &&
      resolved.types.some((member) => AST.isUndefined(member) || AST.isVoid(member))
    ) {
      return deserializeBranch(nonUndefinedBranches[0]!, element);
    }

    for (const member of nonUndefinedBranches) {
      try {
        const candidate = deserializeBranch(member, element, forceArrayCollection);
        const memberSchema = schemaFromAst(member);

        if (Option.isSome(Schema.decodeUnknownOption(memberSchema)(candidate))) return candidate;
      } catch {
        // The next union member may describe this element. Schema makes the
        // final choice; no branch is guessed solely from its position.
      }
    }

    throw new Error(`No SOAP union member matches element ${element.localName}`);
  }

  throw new Error(`Unsupported AST type for SOAP deserialization: ${resolved._tag}`);
}

function attributeValue(element: Element, name: string): string | null {
  if (name.startsWith("{")) {
    const separator = name.indexOf("}");

    if (separator !== -1) {
      return element.getAttributeNS(name.slice(1, separator), name.slice(separator + 1));
    }
  }

  if (name === "xmlns") return element.getAttribute("xmlns");
  if (name.startsWith("xml:"))
    return element.getAttributeNS("http://www.w3.org/XML/1998/namespace", name.slice(4));
  if (name.startsWith("xsi:")) return element.getAttributeNS(XsiNs, name.slice(4));

  return element.getAttribute(name);
}

function rootElement(doc: Document): Element | undefined {
  return doc.documentElement ?? undefined;
}

export function deserializeSoapElementNode<T, RD>(
  root: Element,
  schema: Schema.Decoder<T, RD>,
): Effect.Effect<T, SoapParseError | Schema.SchemaError, RD> {
  return Effect.gen(function* () {
    const annotations = soapAnnotations(schema.ast);
    const explicitName = annotations.elementName ?? annotations.identifier ?? annotations.title;

    if (explicitName !== undefined && root.localName !== explicitName) {
      return yield* new SoapParseError({
        message: `Expected SOAP element ${explicitName}, got ${root.localName}`,
      });
    }

    const raw = yield* Effect.try({
      try: () => deserializeValue(schema.ast, root),
      catch: (cause) => new SoapParseError({ message: String(cause), cause }),
    });

    return yield* Schema.decodeUnknownEffect(schema)(raw);
  });
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

    if (!root) return yield* new SoapParseError({ message: "Expected a root element" });

    return yield* deserializeSoapElementNode(root, schema);
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

    if (
      !envelope ||
      envelope.localName !== "Envelope" ||
      envelope.namespaceURI !== SoapEnvelopeNs
    ) {
      return yield* new SoapParseError({ message: "Expected SOAP 1.2 Envelope as root element" });
    }

    const body = findChild(envelope, "Body", SoapEnvelopeNs);

    if (!body) return yield* new SoapParseError({ message: "SOAP Body not found in envelope" });
    if (body.children.length !== 1) {
      return yield* new SoapParseError({
        message: "SOAP Body must contain exactly one payload element",
      });
    }

    return yield* deserializeSoapElementNode(body.children[0]!, schema);
  });
}
