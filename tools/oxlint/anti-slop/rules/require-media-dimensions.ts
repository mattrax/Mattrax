import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const SIZED_MEDIA_ELEMENTS = new Set(["img", "video", "iframe"]);

function unwrapExpression(node: ESTree.Expression): ESTree.Expression {
  let current = node;
  while (current.type === "ParenthesizedExpression") current = current.expression;
  return current;
}

function attributeNamed(
  attributes: ESTree.JSXAttributeItem[],
  name: string,
): ESTree.JSXAttribute | null {
  for (const attribute of attributes) {
    if (attribute.type !== "JSXAttribute") continue;
    if (attribute.name.type === "JSXIdentifier" && attribute.name.name === name) return attribute;
  }
  return null;
}

function hasValue(attribute: ESTree.JSXAttribute | null): boolean {
  return attribute !== null && attribute.value !== null;
}

function expressionValue(attribute: ESTree.JSXAttribute | null): ESTree.Expression | null {
  if (attribute === null || attribute.value === null) return null;
  if (attribute.value.type === "Literal") return attribute.value;
  if (attribute.value.type !== "JSXExpressionContainer") return null;
  return unwrapExpression(attribute.value.expression as ESTree.Expression);
}

/** A dynamic class list cannot be proven to omit sizing, so do not guess. */
function hasUninspectableClass(attribute: ESTree.JSXAttribute | null): boolean {
  const value = expressionValue(attribute);
  return value !== null && value.type !== "Literal" && value.type !== "TemplateLiteral";
}

/** Spread or dynamic style objects may contain width/height, so do not guess. */
function hasUninspectableStyle(attribute: ESTree.JSXAttribute | null): boolean {
  const value = expressionValue(attribute);
  if (value === null) return false;
  if (value.type === "Literal" || value.type === "TemplateLiteral") return false;
  if (value.type !== "ObjectExpression") return true;

  return value.properties.some((property) => property.type === "SpreadElement");
}

function classTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.slice(token.lastIndexOf(":") + 1));
}

function styleText(attribute: ESTree.JSXAttribute | null): string | null {
  if (attribute === null || attribute.value === null) return null;
  if (attribute.value.type === "Literal") {
    return typeof attribute.value.value === "string" ? attribute.value.value : null;
  }

  if (attribute.value.type !== "JSXExpressionContainer") return null;

  const expression = unwrapExpression(attribute.value.expression as ESTree.Expression);
  if (expression.type === "Literal") {
    return typeof expression.value === "string" ? expression.value : null;
  }

  if (expression.type === "TemplateLiteral") {
    return expression.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(" ");
  }

  return null;
}

function styleObjectKeys(attribute: ESTree.JSXAttribute | null): string[] {
  if (attribute === null || attribute.value === null) return [];
  if (attribute.value.type !== "JSXExpressionContainer") return [];

  const expression = unwrapExpression(attribute.value.expression as ESTree.Expression);
  if (expression.type !== "ObjectExpression") return [];

  return expression.properties.flatMap((property) => {
    if (property.type !== "Property" || property.computed) return [];
    if (property.key.type === "Identifier") return [property.key.name];
    if (property.key.type === "Literal" && typeof property.key.value === "string") {
      return [property.key.value];
    }
    return [];
  });
}

function classText(attribute: ESTree.JSXAttribute | null): string[] {
  if (attribute === null || attribute.value === null) return [];
  if (attribute.value.type === "Literal") {
    return typeof attribute.value.value === "string" ? [attribute.value.value] : [];
  }

  if (attribute.value.type !== "JSXExpressionContainer") return [];

  const expression = unwrapExpression(attribute.value.expression as ESTree.Expression);
  if (expression.type === "Literal") {
    return typeof expression.value === "string" ? [expression.value] : [];
  }

  if (expression.type === "TemplateLiteral") {
    return expression.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw);
  }

  return [];
}

function hasAspectRatio(
  styleAttribute: ESTree.JSXAttribute | null,
  classAttribute: ESTree.JSXAttribute | null,
): boolean {
  const style = styleText(styleAttribute);
  if (style !== null && /(?:^|;)\s*aspect-ratio\s*:/.test(style)) return true;

  const keys = styleObjectKeys(styleAttribute);
  if (keys.includes("aspectRatio") || keys.includes("aspect-ratio")) return true;

  return classText(classAttribute).some((text) =>
    classTokens(text).some((token) => token.startsWith("aspect-")),
  );
}

function hasFixedSize(
  styleAttribute: ESTree.JSXAttribute | null,
  classAttribute: ESTree.JSXAttribute | null,
): boolean {
  const style = styleText(styleAttribute);
  const hasStyledWidth = style !== null && /(?:^|;)\s*width\s*:/.test(style);
  const hasStyledHeight = style !== null && /(?:^|;)\s*height\s*:/.test(style);
  if (hasStyledWidth && hasStyledHeight) return true;

  const keys = styleObjectKeys(styleAttribute);
  if (keys.includes("width") && keys.includes("height")) return true;

  return classText(classAttribute).some((text) => {
    const tokens = classTokens(text);
    const hasWidth = tokens.some((token) => token.startsWith("w-"));
    const hasHeight = tokens.some((token) => token.startsWith("h-"));
    const hasSize = tokens.some((token) => token.startsWith("size-"));

    return (hasWidth && hasHeight) || hasSize;
  });
}

/** Require intrinsic media elements to reserve their box so loading cannot shift layout. */
export const requireMediaDimensionsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require <img>, <video> and <iframe> to declare dimensions, an aspect ratio, or fixed sizing.",
    },
    messages: {
      missingDimensions:
        'Give <{{element}}> explicit width and height attributes, an aspect-ratio, or fixed h-/w- classes so it cannot shift layout while loading.',
    },
  },
  createOnce(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || !SIZED_MEDIA_ELEMENTS.has(node.name.name)) {
          return;
        }

        // Spread props may supply dimensions; refusing them would be noisy.
        if (node.attributes.some((attribute) => attribute.type === "JSXSpreadAttribute")) return;

        const width = attributeNamed(node.attributes, "width");
        const height = attributeNamed(node.attributes, "height");
        if (hasValue(width) && hasValue(height)) return;

        const styleAttribute = attributeNamed(node.attributes, "style");
        const classAttribute =
          attributeNamed(node.attributes, "class") ?? attributeNamed(node.attributes, "className");
        if (hasUninspectableClass(classAttribute) || hasUninspectableStyle(styleAttribute)) return;

        if (hasAspectRatio(styleAttribute, classAttribute)) return;
        if (hasFixedSize(styleAttribute, classAttribute)) return;

        context.report({
          node,
          messageId: "missingDimensions",
          data: { element: node.name.name },
        });
      },
    };
  },
});
