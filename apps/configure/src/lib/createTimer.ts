import { type Accessor, onCleanup, onMount, untrack } from "solid-js";

// Run a function on a timer similar to `createTimer` from `@solid-primitives/timer`.
//
// This function is different in:
// - Takes an async callback and delays the timer until the promise is resolved.
// - A manual trigger function is call the callback immediately and reset the timer.
//
export function createTimer2(
	fn: () => Promise<any>,
	timeout: Accessor<number>,
) {
	let timer: number | null = null;
	const trigger = () => {
		if (timer) clearTimeout(timer);
		fn().then(() => {
			timer = setTimeout(trigger, untrack(timeout));
		});
	};

	onCleanup(() => {
		if (timer) clearTimeout(timer);
	});

	return { trigger };
}
