import { RuleTester } from "oxlint/plugins-dev";

import { preferTaggedErrorHandlingRule } from "./prefer-tagged-error-handling.ts";

new RuleTester().run(
	"prefer-tagged-error-handling",
	preferTaggedErrorHandlingRule,
	{
		valid: [
			'const isNotFound = Predicate.isTagged("NotFound");',
			'if (Predicate.isTagged(result, "Ready")) useReady(result);',
			'Effect.catchTag("NotFound", () => recover);',
			'Effect.catchTag("Wrapper", (error) => Predicate.isTagged(error.reason, "Timeout") ? retry : fail);',
			'Effect.catch((error) => Effect.fail(error));',
			'Effect.catch((error) => items.filter((item) => Predicate.isTagged(item, "Ready")));',
		],
		invalid: [
			{
				code: 'Effect.catch((error) => Predicate.isTagged(error, "NotFound") ? recover : Effect.fail(error));',
				errors: [{ messageId: "taggedError" }],
			},
			{
				code: 'Effect.catchAll(function (error) { return Predicate.isTagged("NotFound")(error) ? recover : fail; });',
				errors: [{ messageId: "taggedError" }],
			},
			{
				code: 'Effect.catchIf((error) => Predicate.isTagged(error, "NotFound"), () => recover);',
				errors: [{ messageId: "taggedError" }],
			},
			{
				code: 'Effect.catch((error) => Predicate.isTagged(error.reason, "Timeout") ? retry : fail);',
				errors: [{ messageId: "taggedReason" }],
			},
		],
	},
);
