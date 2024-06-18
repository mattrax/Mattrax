import { createAsync } from "@solidjs/router";
import type { CreateQueryResult } from "@tanstack/solid-query";
import {
	type Accessor,
	createComputed,
	createEffect,
	createMemo,
	createRenderEffect,
	createRoot,
	createSignal,
	untrack,
} from "solid-js";
import { joinSignals } from "~/lib/signals";
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
	return joinSignals(
		() => query.data,
		createAsync(() => cacheQuery()),
	);
}
