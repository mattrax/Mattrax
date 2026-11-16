import { RuleTester } from "oxlint/plugins-dev";

import { noLayoutAnimatingTransitionRule } from "./no-layout-animating-transition.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });
const error = { messageId: "layoutAnimation" };

tester.run("anti-slop/no-layout-animating-transition", noLayoutAnimatingTransitionRule, {
	valid: [
		'const view = <div class="transition-colors" />;',
		'const view = <div class="transition-shadow" />;',
		'const view = <div class="transition-transform" />;',
		'const view = <div class="transition-[transform,opacity]" />;',
		'const view = <div class="transition-opacity duration-200" />;',
		'const view = <div class="animate-spin" />;',
		'const view = <div class="animate-[spin_1s_linear_infinite]" />;',
		'const view = <div class="animate-[slide-left_300ms_ease-out]" />;',
		'const view = <div class="hover:transition-colors" />;',
		'const view = <div class={`transition-colors ${"active"}`} />;',
		'const view = <div className="transition-[filter:brightness(1.2)]" />;',
		'const view = <div class="transition-[border-left-color,stroke-width]" />;',
		'const view = <div class={styles.root} />;',
	],
	invalid: [
		{ code: 'const view = <div class="transition-all" />;', errors: [error] },
		{ code: 'const view = <div class="transition-[width,height]" />;', errors: [error] },
		{ code: 'const view = <div class="transition-[max-height]" />;', errors: [error] },
		{ code: 'const view = <div class="transition-[margin-top,opacity]" />;', errors: [error] },
		{ code: 'const view = <div class="transition-[padding,gap]" />;', errors: [error] },
		{ code: 'const view = <div class="transition-[all]" />;', errors: [error] },
		{ code: 'const view = <div class="animate-[height_1s_ease]" />;', errors: [error] },
		{ code: 'const view = <div class="animate-[margin-top_300ms_linear]" />;', errors: [error] },
		{ code: 'const view = <div class="md:transition-all" />;', errors: [error] },
		{ code: 'const view = <div class={`transition-all ${"active"}`} />;', errors: [error] },
		{ code: 'const view = <div className="transition-colors transition-all" />;', errors: [error] },
	],
});
