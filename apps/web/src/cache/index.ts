import { createAsync } from "@solidjs/router";
import type { CreateQueryResult } from "@tanstack/solid-query";
import { createEffect, createResource } from "solid-js";
import type { MattraxCache, TableData, TableNames } from "./dexie";
import type { Collection } from "dexie";
export type { TableData, TableNames, MattraxCache } from "./dexie";

export const getMattraxCache = () =>
	import("./dexie").then((m) => m.mattraxCache);

export async function resetMattraxCache() {
	const mattraxCache = await getMattraxCache();
	await mattraxCache.delete();

	await mattraxCache.open();
}

export function createQueryCacher<TData, TTable extends TableNames>(
	query: CreateQueryResult<Array<TData>, any>,
	table: TTable,
	transform: (data: TData) => TableData<MattraxCache[TTable]>,
) {
	const mattraxCache = createAsync(() => getMattraxCache());

	createEffect(() => {
		if (!query.data) return;
		const cache = mattraxCache();
		if (!cache) return;
		// @ts-expect-error
		cache[table].bulkPut(query.data.map(transform) as any);
		cache.metadata.put({
			table,
			last_updated: new Date(),
		});
	});
}

export function useCachedQueryData<TData, T extends TableNames>(
	query: CreateQueryResult<Array<TData>, any>,
	table: T,
	filter?: (data: MattraxCache[T]) => Collection<TData>,
) {
	const cache = createAsync(async () => {
		const cache = await getMattraxCache();
		const [metadata, data] = await Promise.all([
			cache.metadata.where("table").equals(table).first(),
			(filter ? filter(cache[table]) : cache[table]).toArray(),
		]);

		// We draw a distinction between no items in cache (return empty array) and items not cached (return undefined).
		// This is so we can trigger suspense when the cache is empty.
		return metadata &&
			new Date().getTime() - metadata.last_updated.getTime() <
				1000 * 60 * 24 * 7
			? data
			: undefined;
	});

	const [r] = createResource(
		// This forces the promise to be recreated when the signals change, and does not trigger suspense.
		() => [query.data, cache()] as const,
		(key) => {
			// While no value is present we trigger suspense.
			if (key[0] === undefined && key[1] === undefined)
				return new Promise(() => {});

			// Once a value is available we return the data.
			// We prioritize the query data over the cache data.
			return key[0] ?? key[1];
		},
	);

	return {
		// The data, either cached or from the query
		get data() {
			return r() as Array<TData> | undefined;
		},
		// Is the query pending data. This will be `true` when the neither the query nor the cache has data.
		get isPending() {
			return r.loading;
		},
		// Is when the query is being populated from the cache not the network.
		get isStale() {
			return !r.loading && query.isLoading;
		},
		get query() {
			return query;
		},
	};
}
