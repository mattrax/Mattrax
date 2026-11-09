import type { Schema, SchemaAST as AST } from "effect";

export function resolveAnnotations(ast: AST.AST): Schema.Annotations.Annotations | undefined {
  const typeAnnotations = ast.annotations;
  const keyAnnotations = ast.context?.annotations as Schema.Annotations.Annotations | undefined;
  const checkAnnotations = ast.checks
    ? (ast.checks[ast.checks.length - 1].annotations as Schema.Annotations.Annotations | undefined)
    : undefined;

  const merged = { ...typeAnnotations, ...keyAnnotations, ...checkAnnotations };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function resolveIdentifier(ast: AST.AST): string | undefined {
  return resolveAnnotations(ast)?.identifier as string | undefined;
}

export function resolveTitle(ast: AST.AST): string | undefined {
  return resolveAnnotations(ast)?.title as string | undefined;
}

export function getSoapElementName(ast: AST.AST, fallback: string): string {
  const annotations = resolveAnnotations(ast);
  return (
    (annotations?.soapElementName as string | undefined) ??
    (annotations?.identifier as string | undefined) ??
    (annotations?.title as string | undefined) ??
    fallback
  );
}
