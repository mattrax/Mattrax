import { RuleTester } from "oxlint/plugins-dev";

import { noManualTaggedTypeRule } from "./no-manual-tagged-type.ts";

new RuleTester().run("no-manual-tagged-type", noManualTaggedTypeRule, {
	valid: [
		{
			filename: "value.ts",
			code: 'const Ready = Schema.TaggedStruct("Ready", { value: Schema.String });\ntype Ready = typeof Ready.Type;',
		},
		{
			filename: "value.ts",
			code: "type Event = Data.TaggedEnum<{ Ready: { readonly value: string } }>;",
		},
		{
			filename: "value.ts",
			code: "type Value = { readonly tag: string };",
		},
		{
			filename: "value.ts",
			code: 'type ValueTag = Value["_tag"];',
		},
	],
	invalid: [
		{
			filename: "value.ts",
			code: 'type Value = { readonly _tag: "Ready"; readonly payload: string };',
			errors: [{ messageId: "manualTaggedType" }],
		},
		{
			filename: "value.ts",
			code: 'type Value = { readonly _tag: "Ready" } | { readonly _tag: "Done" };',
			errors: [{ messageId: "manualTaggedType" }, { messageId: "manualTaggedType" }],
		},
		{
			filename: "value.ts",
			code: 'interface Value { readonly "_tag": "Ready"; }',
			errors: [{ messageId: "manualTaggedType" }],
		},
		{
			filename: "value.ts",
			code: "interface Authored { readonly _tag: string; readonly actor: string }",
			errors: [{ messageId: "manualTaggedType" }],
		},
		{
			filename: "value.ts",
			code: "const tagOf = <A extends { readonly _tag: string }>(value: A) => value;",
			errors: [{ messageId: "manualTaggedType" }],
		},
		{
			filename: "value.ts",
			code: "const handle = (event: { readonly _tag: string }) => event;",
			errors: [{ messageId: "manualTaggedType" }],
		},
	],
});
