import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

function unwrapParentheses(node: ESTree.Expression): ESTree.Expression {
	let current = node;
	while (current.type === "ParenthesizedExpression") {
		current = current.expression;
	}
	return current;
}

function isConditionalSpread(node: ESTree.Expression): boolean {
	const expression = unwrapParentheses(node);
	return expression.type === "ConditionalExpression" || expression.type === "LogicalExpression";
}

/**
 * Ban spreading ternary and logical expressions where they hide *properties*.
 *
 * Object and JSX spreads decide which keys exist, so a conditional spread makes
 * the resulting shape depend on a runtime branch. Element and argument spreads
 * do not hide a shape — a variable-length list is the point — so they are left
 * alone.
 *
 * Local policy: upstream also flags array and call spreads. That rejects the
 * `...[maybe ?? []]` defaulting idiom used throughout this repository without
 * making the resulting value any clearer, so it is intentionally not enabled.
 */
export const noConditionalSpreadRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow spreading ternary and logical expressions into objects and JSX props. Build the value explicitly instead.",
		},
		messages: {
			avoid:
				"Conditional spreads obscure which properties are present. Build the object in separate statements and add the property only when it exists.",
		},
	},
	createOnce(context) {
		return {
			SpreadElement(node) {
				if (node.parent.type !== "ObjectExpression") return;

				if (isConditionalSpread(node.argument)) {
					context.report({ node, messageId: "avoid" });
				}
			},
			JSXSpreadAttribute(node) {
				if (isConditionalSpread(node.argument)) {
					context.report({ node, messageId: "avoid" });
				}
			},
		};
	},
});
