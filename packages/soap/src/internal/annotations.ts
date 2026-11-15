import { Schema, type SchemaAST as AST } from "effect";

/** SOAP annotations read from a schema node, with their effective values resolved. */
export interface SoapAnnotations {
  readonly elementName: string | undefined;
  readonly namespace: string | undefined;
  readonly namespacePrefix: string | undefined;
  readonly attribute: boolean;
  readonly attributeName: string | undefined;
  readonly textContent: boolean;
  readonly optionalNil: boolean;
  readonly identifier: string | undefined;
  readonly title: string | undefined;
}

function stringAnnotation(
  annotations: Schema.Annotations.Annotations | undefined,
  key: string,
): string | undefined {
  const value = annotations?.[key];

  return Schema.is(Schema.String)(value) ? value : undefined;
}

export function resolveAnnotations(ast: AST.AST): Schema.Annotations.Annotations | undefined {
  const typeAnnotations = ast.annotations;
  const keyAnnotations = ast.context?.annotations;
  const lastCheck = ast.checks?.[ast.checks.length - 1];
  const checkAnnotations = lastCheck?.annotations;

  const merged: Schema.Annotations.Annotations = {
    ...typeAnnotations,
    ...keyAnnotations,
    ...checkAnnotations,
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Resolve the SOAP-specific annotations used by the serializer and deserializer.
 * Later ASTs override earlier ones, matching how optional wrappers combine with
 * the wrapped schema.
 */
export function soapAnnotations(...asts: ReadonlyArray<AST.AST>): SoapAnnotations {
  const merged: Schema.Annotations.Annotations = {};

  for (const ast of asts) {
    const current = resolveAnnotations(ast);

    if (current !== undefined) {
      Object.assign(merged, current);
    }
  }

  const annotations = Object.keys(merged).length > 0 ? merged : undefined;

  return {
    elementName: stringAnnotation(annotations, "soapElementName"),
    namespace: stringAnnotation(annotations, "soapNamespace"),
    namespacePrefix: stringAnnotation(annotations, "soapNamespacePrefix"),
    attribute: annotations?.soapAttribute === true,
    attributeName: stringAnnotation(annotations, "soapAttributeName"),
    textContent: annotations?.soapTextContent === true,
    optionalNil: annotations?.soapOptionalNil === true,
    identifier: stringAnnotation(annotations, "identifier"),
    title: stringAnnotation(annotations, "title"),
  };
}

export function resolveIdentifier(ast: AST.AST): string | undefined {
  return soapAnnotations(ast).identifier;
}

export function resolveTitle(ast: AST.AST): string | undefined {
  return soapAnnotations(ast).title;
}

export function getSoapElementName(ast: AST.AST, fallback: string): string {
  const annotations = soapAnnotations(ast);

  return annotations.elementName ?? annotations.identifier ?? annotations.title ?? fallback;
}
