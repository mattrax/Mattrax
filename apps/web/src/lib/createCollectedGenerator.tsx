import { createQuery } from "@tanstack/solid-query";
import { createResource, createSignal, createUniqueId } from "solid-js";
import { createMutable } from "solid-js/store";

// TODO: make the configurable if we should hold for first value
// TODO: Maybe PR to Solid Primitives if this isn't too niche???

/// Collect a generator of `T` into a reactive `T[]`.
///
/// This will trigger suspense until the first value is yielded, then it will continue returning data.
/// `.loading` will go `false` once the generator is done.
/// `.error` may come from the original fetch, or from the generator itself.
export function createCollectedGenerator<T>(
	generator: (signal: AbortSignal) => Promise<AsyncGenerator<T>>,
) {
	const [i, setI] = createSignal(0);
	const [r, u] = createResource(
		() => {
			i();
			const abort = new AbortController();
			const state = createMutable({
				loading: true,
				error: null,
				data: [] as T[],
			});

			return [abort, state, generator(abort.signal)] as const;
		},
		async ([abort, state, gen], info) => {
			console.log("FETCHING");
			if (info.value) (info.value as any).abort.abort();

			// Await the generator and the first value before resolving the suspense.
			const g = (await gen)[Symbol.asyncIterator]();
			if (abort.signal.aborted) return { state, abort };
			state.data.push((await g.next()).value);

			Promise.resolve(g)
				.then(async (g) => {
					if (abort.signal.aborted) return;

					for await (const value of g) {
						if (abort.signal.aborted) return;
						state.data.push(value);
					}
				})
				.catch((error) => (state.error = error))
				.finally(() => (state.loading = false));

			return {
				state,
				abort,
			};
		},
	);

	return {
		get data() {
			// @ts-expect-error
			return (r.latest?.state?.data ?? []) as T[];
		},
		get loading() {
			console.log(r.loading, r.latest?.state.loading);
			// @ts-expect-error
			return (r.loading ?? r.latest!.state.loading) as boolean;
		},
		get error() {
			// @ts-expect-error
			return (r.error || r.latest?.state.error || undefined) as
				| Error
				| undefined;
		},
		async refetch() {
			// await u.refetch();
			setI((i) => i + 1);
		},
	};
}

/// Hook into Tanstack Query's automatic refetch logic.
///
/// `createCollectedGenerator` would be way harder to implement with Tanstack Query due to it's lack of previous value in the `queryFn`.
export function refetchWhenStale(
	resource: ReturnType<typeof createCollectedGenerator>,
) {
	const id = createUniqueId();
	createQuery(() => ({
		queryKey: ["_refreshWhenStale", id],
		queryFn: () => {
			resource.refetch();
			return null;
		},
		// By setting this we avoid `queryFn` firing on the first render
		initialData: "initial",
	}));
}
