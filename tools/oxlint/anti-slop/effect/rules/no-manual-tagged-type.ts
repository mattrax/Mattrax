import { defineRule, type ESTree } from "@oxlint/plugins";

const isTagKey = (key: ESTree.Node): boolean =>
	(key.type === "Identifier" && key.name === "_tag") ||
	(key.type === "Literal" && key.value === "_tag");

/**
 * Reject hand-written tagged unions.
 *
 * Local policy: an *optional* `_tag` is a duck-typed probe at a boundary — for
 * example `{ readonly _tag?: string }` used to narrow an untrusted error — not
 * a tagged union. Only required `_tag` members are rejected.
 */
export const noManualTaggedTypeRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Derive tagged types from a tagged Schema or Data constructor instead of declaring `_tag` in a type or interface.",
		},
		messages: {
			manualTaggedType:
				"Do not declare `_tag` by hand. Define the value with Schema.TaggedStruct, Schema.TaggedClass, Schema.TaggedError, Schema.TaggedUnion, Data.TaggedClass, Data.TaggedError, or Data.taggedEnum, then infer the type from it, e.g. `export type X = typeof X.Type`.",
		},
	},
	createOnce(context) {
		return {
			TSPropertySignature(node) {
				if (node.optional === true) return;

				if (isTagKey(node.key)) {
					context.report({ node, messageId: "manualTaggedType" });
				}
			},
		};
	},
});
