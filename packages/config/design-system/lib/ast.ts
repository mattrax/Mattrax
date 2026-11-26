export interface Node {
  alternate?: Node;
  arguments?: Node[];
  attributes?: Node[];
  body?: Node[];
  callee?: Node;
  children?: Node[];
  consequent?: Node;
  declaration?: Node;
  declarations?: Node[];
  elements?: (Node | null)[];
  exported?: Node;
  exportKind?: string;
  expression?: Node;
  expressions?: Node[];
  id?: Node;
  importKind?: string;
  init?: Node;
  key?: Node;
  left?: Node;
  local?: Node;
  name?: Node | string;
  object?: Node;
  openingElement?: Node;
  parent?: Node;
  properties?: Node[];
  property?: Node;
  quasis?: Node[];
  right?: Node;
  source?: Node;
  specifiers?: Node[];
  type: string;
  typeAnnotation?: Node;
  types?: Node[];
  value?: Node | { cooked?: string | null } | string | number | boolean | null;
}

export function valueNode(node: Node | undefined) {
  const value = node?.value;
  return typeof value === "object" && value !== null && "type" in value
    ? value
    : undefined;
}

export function cookedOf(quasi: Node) {
  const { value } = quasi;
  return typeof value === "object" && value !== null && "cooked" in value
    ? value.cooked
    : undefined;
}

export function nameOf(node: Node | undefined) {
  return typeof node?.name === "string" ? node.name : null;
}

export function attributeName(node: Node | undefined) {
  return typeof node?.name === "object" ? nameOf(node.name) : null;
}

export function isClassAttribute(node: Node | undefined) {
  return node?.type === "JSXAttribute" && attributeName(node) === "className";
}

export function elementOf(opening: Node) {
  return typeof opening.name === "object" ? opening.name : undefined;
}

export function rootOf(node: Node | undefined): string | null {
  if (node?.type === "JSXMemberExpression") {
    return rootOf(node.object);
  }
  return nameOf(node);
}

export function elementName(node: Node | undefined): string {
  if (node?.type === "JSXMemberExpression") {
    return `${elementName(node.object)}.${nameOf(node.property) ?? ""}`;
  }
  return nameOf(node) ?? "";
}

export function stringAttribute(opening: Node, name: string) {
  const attribute = (opening.attributes ?? []).find(
    (candidate) =>
      candidate.type === "JSXAttribute" && attributeName(candidate) === name,
  );
  const value = valueNode(attribute);
  return value?.type === "Literal" && typeof value.value === "string"
    ? value.value
    : null;
}
