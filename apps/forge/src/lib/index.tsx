import { createTRPCSolidStart } from "@solid-mediakit/trpc";
import {
	CancelFn,
	Operation,
	PromiseAndCancel,
	TRPCClientError,
	TRPCLink,
} from "@trpc/client";
import { AnyRouter, ProcedureType, callProcedure } from "@trpc/server";
import { type TRPCResponse } from "@trpc/server/rpc";
import { observable } from "@trpc/server/observable";
import { type ClassValue, clsx } from "clsx";
import { Accessor, createEffect, createSignal } from "solid-js";
import { twMerge } from "tailwind-merge";
import { getEvent } from "vinxi/http";
import { appRouter, createTRPCContext, type AppRouter } from "~/api";

async function serverFunctionHandler(opts: {
	operations: Array<Pick<Operation, "path" | "input">>;
	type: ProcedureType;
}): Promise<TRPCResponse[]> {
	"use server";

	const ctx = createTRPCContext(getEvent());

	return await Promise.all(
		opts.operations.map(async (o) => ({
			result: {
				data: await callProcedure({
					procedures: appRouter._def.procedures,
					path: o.path,
					rawInput: o.input,
					ctx,
					type: opts.type,
				}),
			},
		})),
	);
}

type RequesterFn = (requesterOpts: { type: ProcedureType }) => (
	batchOps: Operation[],
	unitResolver: (index: number, value: NonNullable<TRPCResponse>) => void,
) => {
	promise: Promise<TRPCResponse[]>;
	cancel: CancelFn;
};

const serverFunctionRequester: RequesterFn = (requesterOpts) => {
	return (batchOps) => {
		const promise = serverFunctionHandler({
			operations: batchOps.map((o) => ({
				path: o.path,
				input: o.input,
			})),
			type: requesterOpts.type,
		});

		return {
			promise,
			cancel: () => {},
		};
	};
};

const createServerFunctionLink = <TRouter extends AnyRouter>(
	requester: RequesterFn,
): TRPCLink<TRouter> => {
	return () => {
		const batchLoader = (type: ProcedureType) => {
			const fetch = requester({ type });

			return { fetch, validate: () => true };
		};

		const query = dataLoader(batchLoader("query"));
		const mutation = dataLoader(batchLoader("mutation"));
		const subscription = dataLoader(batchLoader("subscription"));

		const loaders = { query, subscription, mutation };

		return ({ op }) => {
			return observable((observer) => {
				const loader = loaders[op.type];
				const { promise, cancel } = loader.load(op);

				promise
					.then((response) => {
						if ("error" in response) {
							observer.error(
								TRPCClientError.from(
									response,
									// 	, {
									// 	meta: response.meta,
									// }
								),
							);
							return;
						} else {
							observer.next({
								// context: res.meta,
								result: response.result,
							});
							observer.complete();
						}
					})
					.catch((err) => {
						observer.error(
							TRPCClientError.from(
								err,
								// 	{
								// 	meta: _res?.meta,
								// }
							),
						);
					});

				return cancel;
			});
		};
	};
};

const serverFunctionLink = createServerFunctionLink(serverFunctionRequester);

export const trpc = createTRPCSolidStart<AppRouter>({
	config: () => ({
		links: [serverFunctionLink],
	}),
});

type BatchItem<TKey, TValue> = {
	aborted: boolean;
	key: TKey;
	resolve: ((value: TValue) => void) | null;
	reject: ((error: Error) => void) | null;
	batch: Batch<TKey, TValue> | null;
};
type Batch<TKey, TValue> = {
	items: BatchItem<TKey, TValue>[];
	cancel: CancelFn;
};
type BatchLoader<TKey, TValue> = {
	validate: (keys: TKey[]) => boolean;
	fetch: (
		keys: TKey[],
		unitResolver: (index: number, value: NonNullable<TValue>) => void,
	) => {
		promise: Promise<TValue[]>;
		cancel: CancelFn;
	};
};

/**
 * Dataloader that's very inspired by https://github.com/graphql/dataloader
 * Less configuration, no caching, and allows you to cancel requests
 * When cancelling a single fetch the whole batch will be cancelled only when _all_ items are cancelled
 */
export function dataLoader<TKey, TValue>(
	batchLoader: BatchLoader<TKey, TValue>,
) {
	let pendingItems: BatchItem<TKey, TValue>[] | null = null;
	let dispatchTimer: ReturnType<typeof setTimeout> | null = null;

	const destroyTimerAndPendingItems = () => {
		clearTimeout(dispatchTimer as any);
		dispatchTimer = null;
		pendingItems = null;
	};

	/**
	 * Iterate through the items and split them into groups based on the `batchLoader`'s validate function
	 */
	function groupItems(items: BatchItem<TKey, TValue>[]) {
		const groupedItems: BatchItem<TKey, TValue>[][] = [[]];
		let index = 0;
		while (true) {
			const item = items[index];
			if (!item) {
				// we're done
				break;
			}
			const lastGroup = groupedItems[groupedItems.length - 1]!;

			if (item.aborted) {
				// Item was aborted before it was dispatched
				item.reject?.(new Error("Aborted"));
				index++;
				continue;
			}

			const isValid = batchLoader.validate(
				lastGroup.concat(item).map((it) => it.key),
			);

			if (isValid) {
				lastGroup.push(item);
				index++;
				continue;
			}

			if (lastGroup.length === 0) {
				item.reject?.(new Error("Input is too big for a single dispatch"));
				index++;
				continue;
			}
			// Create new group, next iteration will try to add the item to that
			groupedItems.push([]);
		}
		return groupedItems;
	}

	function dispatch() {
		const groupedItems = groupItems(pendingItems!);
		destroyTimerAndPendingItems();

		// Create batches for each group of items
		for (const items of groupedItems) {
			if (!items.length) {
				continue;
			}
			const batch: Batch<TKey, TValue> = {
				items,
				cancel: throwFatalError,
			};
			for (const item of items) {
				item.batch = batch;
			}
			const unitResolver = (index: number, value: NonNullable<TValue>) => {
				const item = batch.items[index]!;
				item.resolve?.(value);
				item.batch = null;
				item.reject = null;
				item.resolve = null;
			};
			const { promise, cancel } = batchLoader.fetch(
				batch.items.map((_item) => _item.key),
				unitResolver,
			);
			batch.cancel = cancel;

			promise
				.then((result) => {
					for (let i = 0; i < result.length; i++) {
						const value = result[i]!;
						unitResolver(i, value);
					}
					for (const item of batch.items) {
						item.reject?.(new Error("Missing result"));
						item.batch = null;
					}
				})
				.catch((cause) => {
					for (const item of batch.items) {
						item.reject?.(cause);
						item.batch = null;
					}
				});
		}
	}
	function load(key: TKey): PromiseAndCancel<TValue> {
		const item: BatchItem<TKey, TValue> = {
			aborted: false,
			key,
			batch: null,
			resolve: throwFatalError,
			reject: throwFatalError,
		};

		const promise = new Promise<TValue>((resolve, reject) => {
			item.reject = reject;
			item.resolve = resolve;

			if (!pendingItems) {
				pendingItems = [];
			}
			pendingItems.push(item);
		});

		if (!dispatchTimer) {
			dispatchTimer = setTimeout(dispatch);
		}
		const cancel = () => {
			item.aborted = true;

			if (item.batch?.items.every((item) => item.aborted)) {
				// All items in the batch have been cancelled
				item.batch.cancel();
				item.batch = null;
			}
		};

		return { promise, cancel };
	}

	return {
		load,
	};
}

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// TODO: Surly this can be done in a better way.
export function untrackScopeFromSuspense<T>(scope: () => T): Accessor<T> {
	const [signal, setSignal] = createSignal<T>(scope());
	createEffect(() => setSignal(scope() as any));
	return signal;
}

export function SuspenseError(props: { name: string }) {
	// Hitting the certain higher-level suspense boundaries means we don't have a UI to show which is a bad UI so we log the warning.
	console.warn(`${props.name}Suspense triggered!`);
	return <></>;
}

// https://trpc.io/docs/client/vanilla/infer-types#infer-trpcclienterror-types
export function isTRPCClientError(
	cause: unknown,
): cause is TRPCClientError<AppRouter> {
	return cause instanceof TRPCClientError;
}

export const isDebugMode = () => localStorage.getItem("mttxDebug") === "1";

/**
 * A function that should never be called unless we messed something up.
 */
const throwFatalError = () => {
  throw new Error(
    'Something went wrong. Please submit an issue at https://github.com/trpc/trpc/issues/new',
  );
};
