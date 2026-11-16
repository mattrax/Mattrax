import { RuleTester } from "oxlint/plugins-dev";

import { requireMediaDimensionsRule } from "./require-media-dimensions.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });
const error = { messageId: "missingDimensions" };

tester.run("anti-slop/require-media-dimensions", requireMediaDimensionsRule, {
	valid: [
		'const view = <img src="/hero.png" width="1200" height="630" alt="" />;',
		'const view = <img src="/hero.png" width={1200} height={630} alt="" />;',
		'const view = <img src="/hero.png" class="aspect-video w-full" alt="" />;',
		'const view = <img src="/hero.png" class="aspect-[16/9]" alt="" />;',
		'const view = <img src="/hero.png" class="h-12 w-12" alt="" />;',
		'const view = <img src="/hero.png" class="size-12" alt="" />;',
		'const view = <img src="/hero.png" style={{ aspectRatio: "16 / 9" }} alt="" />;',
		'const view = <img src="/hero.png" style={{ width: 64, height: 64 }} alt="" />;',
		'const view = <img src="/hero.png" style="aspect-ratio: 16 / 9;" alt="" />;',
		'const view = <img src="/hero.png" style="width: 64px; height: 64px;" alt="" />;',
		'const view = <img {...props} alt="" />;',
		'const view = <img src="/hero.png" class={styles.hero} alt="" />;',
		'const view = <img src="/hero.png" class={condition ? "h-4 w-4" : "h-8 w-8"} alt="" />;',
		'const view = <img src="/hero.png" style={heroStyle} alt="" />;',
		'const view = <img src="/hero.png" style={{ ...baseStyle }} alt="" />;',
		'const view = <video src="/clip.mp4" width="640" height="360" />;',
		'const view = <iframe src="/embed" width="560" height="315" title="Embed" />;',
		'const view = <iframe src="/embed" class="aspect-video w-full" title="Embed" />;',
		'const view = <div class="w-full" />;',
	],
	invalid: [
		{ code: 'const view = <img src="/hero.png" alt="" />;', errors: [error] },
		{ code: 'const view = <img src="/hero.png" width="1200" alt="" />;', errors: [error] },
		{ code: 'const view = <img src="/hero.png" height={630} alt="" />;', errors: [error] },
		{ code: 'const view = <img src="/hero.png" class="w-full" alt="" />;', errors: [error] },
		{ code: 'const view = <img src="/hero.png" class="h-12" alt="" />;', errors: [error] },
		{ code: 'const view = <img src="/hero.png" class="transition-colors" alt="" />;', errors: [error] },
		{ code: 'const view = <img src="/hero.png" style="max-width: 100%" alt="" />;', errors: [error] },
		{ code: 'const view = <img src="/hero.png" class="max-h-56 max-w-full" alt="" />;', errors: [error] },
		{ code: 'const view = <video src="/clip.mp4" class="w-full" />;', errors: [error] },
		{ code: 'const view = <iframe src="/embed" title="Embed" />;', errors: [error] },
	],
});
