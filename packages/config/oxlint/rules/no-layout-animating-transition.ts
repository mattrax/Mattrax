import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const LAYOUT_PROPERTIES = new Set([
  "all",
  "width",
  "height",
  "line-height",
  "top",
  "left",
  "right",
  "bottom",
  "inset",
  "gap",
  "row-gap",
  "column-gap",
  "border-width",
  "margin",
  "padding",
]);

/** Classify the property at the start of one comma-separated transition entry. */
function isLayoutProperty(property: string): boolean {
  if (LAYOUT_PROPERTIES.has(property)) return true;
  if (property.startsWith("margin-") || property.startsWith("padding-")) return true;
  if (property.startsWith("inset-")) return true;
  // `min-width`, `max-height` and their logical equivalents still reflow.
  return /^(?:min|max)-(?:width|height)$/.test(property);
}

function firstProperty(entry: string): string {
  return entry.trim().split(/\s+/)[0] ?? "";
}

function anyLayoutProperty(value: string): boolean {
  return value
    .replaceAll("_", " ")
    .split(",")
    .some((entry) => isLayoutProperty(firstProperty(entry)));
}

/** Remove Tailwind variant prefixes (`motion-safe:`, `md:`, `group-hover/x:`). */
function withoutVariants(token: string): string {
  let depth = 0;
  let start = 0;

  for (const [index, character] of [...token].entries()) {
    if (character === "[") depth += 1;
    if (character === "]") depth = Math.max(0, depth - 1);
    if (character === ":" && depth === 0) start = index + 1;
  }

  return token.slice(start);
}

/** Return the contents of an arbitrary Tailwind value (`transition-[...]`). */
function arbitraryValue(token: string, prefix: string): string | null {
  if (!token.startsWith(prefix) || !token.endsWith("]")) return null;
  return token.slice(prefix.length, -1);
}

function animatesLayout(token: string): boolean {
  const utility = withoutVariants(token);
  if (utility === "transition-all") return true;

  const transition = arbitraryValue(utility, "transition-[");
  // A transition arbitrary value is a property list, so the property itself is
  // enough (`transition-[width]`), with or without a duration.
  if (transition !== null) return anyLayoutProperty(transition);

  const animation = arbitraryValue(utility, "animate-[");
  // The first component of an animation value may be a keyframe name
  // (`animate-[slide-left_300ms]`), so only a leading layout property counts.
  if (animation !== null) return anyLayoutProperty(animation);

  return false;
}

function classValueText(node: ESTree.JSXAttributeValue | null): string[] {
  if (node === null) return [];
  if (node.type === "Literal") return typeof node.value === "string" ? [node.value] : [];
  if (node.type !== "JSXExpressionContainer") return [];

  const expression = node.expression;
  if (expression.type === "Literal") {
    return typeof expression.value === "string" ? [expression.value] : [];
  }

  if (expression.type === "TemplateLiteral") {
    return expression.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw);
  }

  return [];
}

/** Reject transitions and animations that animate layout instead of transform/opacity. */
export const noLayoutAnimatingTransitionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Tailwind transitions and animations that animate layout properties; use transform and opacity only.",
    },
    messages: {
      layoutAnimation:
        'The class "{{className}}" animates a layout property and forces reflow. Animate transform or opacity instead (for example transition-transform or transition-[transform,opacity]).',
    },
  },
  createOnce(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier") return;
        if (node.name.name !== "class" && node.name.name !== "className") return;

        for (const text of classValueText(node.value)) {
          for (const token of text.split(/\s+/).filter(Boolean)) {
            if (!animatesLayout(token)) continue;

            context.report({
              node,
              messageId: "layoutAnimation",
              data: { className: token },
            });
          }
        }
      },
    };
  },
});
