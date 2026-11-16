import { RuleTester } from "oxlint/plugins-dev";

import { noManualTaggedConstructionRule } from "./no-manual-tagged-construction.ts";

new RuleTester().run(
	"no-manual-tagged-construction",
	noManualTaggedConstructionRule,
	{
		valid: [
			'Match.value(value).pipe(Match.tag("Ready", handleReady));',
			"Ready.make({ value });",
			"new NotFound({ id });",
		],
		invalid: [
			{
				code: 'const value = { _tag: "Ready", payload };',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'const value = { ["_tag"]: "Ready" };',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'const value = { _tag: tag, payload };',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				filename: "value.ts",
				code: 'const value = { _tag: "Ready" as const, payload };',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'Match.when({ _tag: "Ready" }, handleReady);',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'Match.not({ "_tag": "Pending" });',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				filename: "value.ts",
				code: 'class Value { readonly _tag = "Ready"; }',
				errors: [{ messageId: "manualDeclaration" }],
			},
		],
	},
);
