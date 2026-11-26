import { Effect, Schema, SchemaAST as AST } from "effect";
import { getSoapElementName, soapAnnotations } from "./internal/annotations.js";
import { isSoapArray, isSoapObject, SoapValueSchema } from "./internal/values.js";
import type { SoapValue } from "./internal/values.js";
import { XsiNs } from "./namespaces.js";

export class SoapSerializeError extends Schema.TaggedError<SoapSerializeError>()(
  "SoapSerializeError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

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
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function escapeAttr(value: string): string {
  return escapeXml(value).replaceAll('"', "&quot;");
}

const XmlNs = "http://www.w3.org/XML/1998/namespace";

const schemaFromAst = (ast: AST.AST): Schema.Schema<unknown> =>
  Schema.make(ast) as Schema.Schema<unknown>;

const xmlNamePattern = /^[\p{L}_][\p{L}\p{N}._-]*$/u;

interface QualifiedName {
  readonly namespace: string | undefined;
  readonly localName: string;
  readonly prefix: string | undefined;
}

function qualifiedName(name: string): QualifiedName {
  if (name.startsWith("{")) {
    const separator = name.indexOf("}");

    if (separator !== -1) {
      const namespace = name.slice(1, separator);
      const localName = name.slice(separator + 1);

      if (!namespace || !xmlNamePattern.test(localName)) {
        throw new Error(`Invalid SOAP record key: ${name}`);
      }

      return { namespace, localName, prefix: undefined };
    }
  }

  if (!xmlNamePattern.test(name)) throw new Error(`Invalid SOAP record key: ${name}`);

  return { namespace: undefined, localName: name, prefix: undefined };
}

function attributeName(name: string): QualifiedName {
  if (name.startsWith("xml:")) {
    return { namespace: XmlNs, localName: name.slice(4), prefix: "xml" };
  }
  if (name.startsWith("xsi:")) {
    return { namespace: XsiNs, localName: name.slice(4), prefix: "xsi" };
  }

  const qualified = qualifiedName(name);

  if (qualified.namespace === XsiNs) {
    return { ...qualified, prefix: "xsi" };
  }
  if (qualified.namespace !== undefined) return qualified;
  return qualified;
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
  attributes: ReadonlyArray<{
    readonly name: string;
    readonly value: string;
    readonly namespace?: string;
  }>,
  ns?: string,
  prefix?: string,
): SoapTag {
  if (prefix && !ns && prefix !== "xml") {
    throw new Error(`SOAP namespace prefix ${prefix} requires a namespace URI`);
  }

  const tagName = prefix ? `${prefix}:${name}` : name;
  const namespaceDeclarations = new Map<string, string>();
  const renderedAttributes = attributes.map((attribute) => {
    let attributeName = attribute.name;

    if (attribute.namespace && attribute.namespace !== XmlNs) {
      const separator = attributeName.indexOf(":");
      let attributePrefix = separator === -1 ? undefined : attributeName.slice(0, separator);

      if (!attributePrefix) {
        attributePrefix = `ns${namespaceDeclarations.size + 1}`;
        attributeName = `${attributePrefix}:${attributeName}`;
      }

      const declared = namespaceDeclarations.get(attributePrefix);

      if (declared !== undefined && declared !== attribute.namespace) {
        throw new Error(`SOAP namespace prefix ${attributePrefix} is ambiguous`);
      }

      namespaceDeclarations.set(attributePrefix, attribute.namespace);
    }

    return ` ${attributeName}="${escapeAttr(attribute.value)}"`;
  });
  let attrs = [...namespaceDeclarations]
    .map(([attributePrefix, namespace]) => ` xmlns:${attributePrefix}="${escapeAttr(namespace)}"`)
    .join("");

  if (ns) {
    if (prefix && namespaceDeclarations.has(prefix) && namespaceDeclarations.get(prefix) !== ns) {
      throw new Error(`SOAP namespace prefix ${prefix} is ambiguous`);
    }

    attrs += prefix ? ` xmlns:${prefix}="${escapeAttr(ns)}"` : ` xmlns="${escapeAttr(ns)}"`;
  }

  attrs += renderedAttributes.join("");

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
  nameOverride?: string,
  namespaceOverride?: string,
  forceArrayWrapper = false,
): string {
  const elementName = nameOverride ?? getSoapElementName(ast, fallbackName);
  const elementNamespace = namespaceOverride ?? soapAnnotations(ast).namespace;
  const elementPrefix = soapAnnotations(ast).namespacePrefix;

  if (AST.isString(ast) || AST.isNumber(ast) || AST.isBoolean(ast) || AST.isBigInt(ast)) {
    const tag = buildTag(elementName, [], elementNamespace, elementPrefix);

    return tag.open + escapeXml(serializePrimitiveValue(value)) + tag.close;
  }

  if (AST.isNull(ast) || AST.isVoid(ast) || AST.isUndefined(ast)) {
    const tag = buildTag(elementName, [], elementNamespace, elementPrefix);

    return tag.selfClose;
  }

  if (AST.isLiteral(ast)) {
    const tag = buildTag(elementName, [], elementNamespace, elementPrefix);

    return tag.open + escapeXml(serializePrimitiveValue(value)) + tag.close;
  }

  if (AST.isObjects(ast)) {
    if (!isSoapObject(value)) {
      throw new Error(`Expected object for ${ast._tag}, got ${serializePrimitiveValue(value)}`);
    }

    const namedProperties = new Set(
      ast.propertySignatures.map((property) => String(property.name)),
    );

    const attributes: Array<{ name: string; value: string; namespace?: string }> = [];
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

            const tag = buildTag(
              elName,
              [{ name: "xsi:nil", value: "true", namespace: XsiNs }],
              propAnnotations.namespace,
              propAnnotations.namespacePrefix,
            );

            children.push(indentLine(options.depth + 1, tag.selfClose, options));
          }

          continue;
        }

        throw new Error(`Missing required property: ${String(ps.name)}`);
      }

      if (propAnnotations.attribute) {
        const attrName = attributeName(propAnnotations.attributeName ?? String(ps.name));

        attributes.push({
          name: attrName.prefix ? `${attrName.prefix}:${attrName.localName}` : attrName.localName,
          value: serializePrimitiveValue(propValue),
          namespace: attrName.namespace,
        });
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

    for (const [key, propValue] of Object.entries(value)) {
      if (namedProperties.has(key) || propValue === undefined) continue;

      const index = ast.indexSignatures.find((signature) =>
        Schema.is(schemaFromAst(signature.parameter))(key),
      );

      if (!index) throw new Error(`SOAP record has no matching schema for key ${key}`);

      const recordName = qualifiedName(key);
      const valueAnnotations = soapAnnotations(index.type);
      const namespace = recordName.namespace ?? valueAnnotations.namespace;
      const child = serializeAst(
        index.type,
        propValue,
        { ...options, depth: options.depth + 1 },
        recordName.localName,
        recordName.localName,
        namespace,
        true,
      );

      children.push(indentLine(options.depth + 1, child, options));
    }

    const tag = buildTag(elementName, attributes, elementNamespace, elementPrefix);

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
    const name = elementName;

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

    const tag = buildTag(name, [], elementNamespace, elementPrefix);

    if (name === itemName && !forceArrayWrapper) {
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
    const unionName = elementName;

    for (const member of ast.types) {
      const memberSchema = schemaFromAst(member);

      if (!Schema.is(memberSchema)(value)) continue;

      try {
        return serializeAst(
          member,
          value,
          options,
          unionName,
          nameOverride,
          namespaceOverride,
          forceArrayWrapper,
        );
      } catch {
        // continue to next member
      }
    }

    throw new Error(`Could not serialize union value: ${JSON.stringify(value)}`);
  }

  if (AST.isSuspend(ast)) {
    return serializeAst(
      ast.thunk(),
      value,
      options,
      fallbackName,
      nameOverride,
      namespaceOverride,
      forceArrayWrapper,
    );
  }

  if (AST.isTemplateLiteral(ast) || AST.isAny(ast) || AST.isUnknown(ast)) {
    const tag = buildTag(elementName, [], elementNamespace, elementPrefix);

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
