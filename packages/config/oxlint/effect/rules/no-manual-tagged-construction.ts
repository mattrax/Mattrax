import { defineRule, type ESTree } from "@oxlint/plugins";

import { isMatchPatternObject, isStringLiteral, propertyName } from "../shared/tagged-values.ts";

const isRequiredTagKey = (property: ESTree.PropertyDefinition): boolean =>
	(property.key.type === "Identifier" && property.key.name === "_tag") ||
	(property.key.type === "Literal" && property.key.value === "_tag");

/**
 * Local policy: only literal `_tag` values are construction. A tag copied from
 * a variable, or asserted with `as const` inside a matcher, is data flow rather
 * than a hand-written tagged value, and flagging it would mostly catch test
 * assertions.
 */
export const noManualTaggedConstructionRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Use a tagged Schema or Data constructor instead of writing a literal `_tag` object or class field.",
		},
		messages: {
			manualConstruction:
				"Use the existing Schema tagged `.make`, tagged class/error constructor, or Data.taggedEnum variant constructor instead of writing a literal `_tag` object.",
			manualDeclaration:
				"Declare tagged classes with Schema.TaggedClass, Schema.TaggedError, Data.TaggedClass, or Data.TaggedError instead of writing a literal `_tag` property.",
		},
	},
	createOnce(context) {
		return {
			ObjectExpression(node) {
				// `Match.when({ _tag: "..." })` patterns read a tag rather than build
				// a value, so they are not manual tagged construction.
				if (isMatchPatternObject(node)) return;

				const tag = node.properties.find(
					(property) =>
						property.type === "Property" &&
						propertyName(property) === "_tag" &&
						isStringLiteral(property.value),
				);

				if (tag !== undefined) {
					context.report({ node: tag, messageId: "manualConstruction" });
				}
			},
			PropertyDefinition(node) {
				// An optional `_tag` field is a carrier for a tag read at a boundary,
				// not a hand-written tagged type.
				if (node.optional === true) return;

				if (isRequiredTagKey(node)) {
					context.report({ node, messageId: "manualDeclaration" });
				}
			},
		};
	},
});
