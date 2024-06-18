import { createResource } from "solid-js";

// Joins two signals into one, while taking into account suspending signals.
//
// Suspense will be trigger until `a` or `b` has a value and the value for `a` will be preferred.
export function joinSignals<T>(a: () => T | undefined, b: () => T | undefined) {
	const [r] = createResource(
		// This forces the promise to be recreated when the signals change, and does not trigger suspense.
		() => [a(), b()] as const,
		(key) => {
			// While no value is present we trigger suspense.
			if (key[0] === undefined && key[1] === undefined)
				return new Promise(() => {});

			// Once a value is avaiable we return the first one.
			return key[0] ?? key[1];
		},
	);

	// Hide the resource properties cause they are an implementation detail
	return () => r() as T | undefined;
}
