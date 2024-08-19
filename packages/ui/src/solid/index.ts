// Some of the proposed primitives for Solid v2, implemented in Solid v1.
// I would not *trust* the behavior of these to be perfect with Solid v2!!!!!

import { createMemo, createRoot } from "solid-js";

// Access the latest value of an signal without suspending.
export function latest<T>(signal: () => T): T | undefined {
	// This implementation is assuming that `latest` will *not* suspend but this is very undecided.
	// If this assumption is wrong this can probably be implemented as `return isLoading(signal) ? undefined : props.org()`
	return createRoot(() => createMemo(signal))();
}

export function isLoading<T>(signal: () => T) {
	return latest(signal) === undefined;
}
