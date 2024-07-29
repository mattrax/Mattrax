/// Copied from `@mattrax/web` we should probs break out and share?
// This amazing counter component was written by @Brendonovich

import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";

function ease(x: number) {
	return 1 - (1 - x) ** 3;
}

interface Props {
	start?: number;
	value: number;
	duration: number;
}

export function createCounter(props: Accessor<Props>) {
	const [value, setValue] = createSignal<number>();

	createEffect<number>((start: number) => {
		const end = props().value;

		if (end !== undefined) {
			const startTime = performance.now();
			let lastFrame: null | number = null;

			const tick = () => {
				lastFrame = requestAnimationFrame(() => {
					const now = performance.now();
					const t = Math.min((now - startTime) / props().duration, 1);

					if (t === 1) {
						setValue(end);
						lastFrame = null;
					} else {
						setValue(start + Math.round((end - start) * ease(t)));

						tick();
					}
				});
			};

			tick();

			onCleanup(() => {
				if (lastFrame !== null) cancelAnimationFrame(lastFrame);
			});

			return end;
		}

		return start;
	}, props().start ?? 0);

	return () => {
		return value() ?? props().start ?? 0;
	};
}
