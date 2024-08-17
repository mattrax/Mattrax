// Some of the proposed primitives for Solid v2, implemented in Solid v1.
// I would not *trust* the behavior of these to be perfect with Solid v2!!!!!

import {
	Suspense,
	createComputed,
	createMemo,
	createRoot,
	createSignal,
} from "solid-js";

const isLoadingSymbol = Symbol("isLoading");

export function latest<T>(signal: () => T) {
	const [latest, setLatest] = createSignal(createRoot(signal));
	createRoot(() => createMemo(() => setLatest(signal)));
	if (latest() === undefined) return signal();
	return latest();
}

export function isLoading<T>(fn: () => T) {
	const [suspended, setSuspended] = createSignal(true);
	createRoot(() => {
		const result = Suspense({
			fallback: isLoadingSymbol as any,
			children: (() => {
				fn();
				return null;
			}) as any,
		}) as any as () => T | typeof isLoadingSymbol;

		createComputed(() => {
			if (result() !== isLoadingSymbol) setSuspended(false);
		});
	});

	return suspended();
}

// TODO: How would this actually be expressed in Solid v2 cause this is not it!!!!!
// This does not suspense *ever*, whereas `latest` suspends until data is available.
export function latestNoSuspense<T>(signal: () => T) {
	const [latest, setLatest] = createSignal(createRoot(signal));
	createRoot(() => createMemo(() => setLatest(signal)));
	return latest();
}
