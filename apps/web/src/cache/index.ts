import { createAsync } from "@solidjs/router";
import type { CreateQueryResult } from "@tanstack/solid-query";
import Dexie from "dexie";
import { type Accessor, createEffect, untrack } from "solid-js";

type TableNames = "orgs" | "tenants";

class MattraxCache
	extends Dexie
	implements Record<TableNames, Dexie.Table<any, string>>
{
	orgs!: Dexie.Table<{ id: string; slug: string; name: string }, string>;
	tenants!: Dexie.Table<
		{ id: string; slug: string; name: string; orgId: string },
		string
	>;

	VERSION = 1;

	constructor() {
		super("mattrax-cache");
		this.version(this.VERSION).stores({
			orgs: "id",
			tenants: "id, orgId",
		});
	}
}

export type { MattraxCache };

export type TableData<TTable extends Dexie.Table> = TTable extends Dexie.Table<
	infer T
>
	? T
	: never;

export const mattraxCache = new MattraxCache();

export async function resetMattraxCache() {
	await mattraxCache.delete();
	await mattraxCache.open();
}

export function createQueryCacher<TData, TTable extends TableNames>(
	query: CreateQueryResult<Array<TData>, any>,
	table: TTable,
	transform: (data: TData) => TableData<MattraxCache[TTable]>,
) {
	createEffect(() => {
		if (!query.data) return;
		mattraxCache[table].bulkPut(query.data.map(transform) as any);
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
			if (c) query.data;

			return c;
		}

		return query.data;
	};
}
