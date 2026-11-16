import { RuleTester } from "oxlint/plugins-dev";

import { noManualTaggedConstructionRule } from "./no-manual-tagged-construction.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("anti-slop-effect/no-manual-tagged-construction", noManualTaggedConstructionRule, {
	valid: [
		'Match.value(value).pipe(Match.tag("Ready", handleReady));',
		"Ready.make({ value });",
		"new NotFound({ id });",
		// Reading a tag is not building one.
		'Match.when({ _tag: "Ready" }, handleReady);',
		'Match.not({ "_tag": "Pending" });',
		// Tags copied from data, or asserted inside matchers, are data flow.
		"const value = { _tag: tag, payload };",
		'const value = { _tag: "Ready" as const, payload };',
		// Optional carriers hold a tag read at a boundary.
		"class RequestError extends Error { _tag?: string; }",
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
			filename: "value.ts",
			code: 'class Value { readonly _tag = "Ready"; }',
			errors: [{ messageId: "manualDeclaration" }],
		},
		{
			filename: "value.ts",
			code: "class Value { readonly _tag: string; }",
			errors: [{ messageId: "manualDeclaration" }],
		},
	],
});
