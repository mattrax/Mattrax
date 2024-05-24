import { createAsync } from "@solidjs/router";
import type { CreateQueryResult } from "@tanstack/solid-query";
import { type Accessor, createEffect, untrack } from "solid-js";
import type { MattraxCache, TableData, TableNames } from "./dexie";
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
		cache[table].bulkPut(query.data.map(transform) as any);
	});
}

export function useCachedQueryData<TData>(
	query: CreateQueryResult<Array<TData>, any>,
	cacheQuery: () => Promise<Array<TData>>,
): Accessor<Array<TData> | undefined> {
	const cachedQuery = createAsync(() => cacheQuery());

	return () => {
		if (untrack(() => query.isLoading)) {
			const c = cachedQuery();
			// We subscribe to `query.data` once the cached data is available
			if (c) query.isLoading;

			return c;
		}

		return query.data;
	};
}
