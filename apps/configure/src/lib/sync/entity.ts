import type { IDBPDatabase, StoreNames } from "idb";
import { z } from "zod";
import type { Database, TableName } from "../db";
import { registerBatchedOperation, registerProgress } from "./state";

const stripGraphAPIPrefix = (url: string) => {
	let r = url
		.replace("https://graph.microsoft.com/v1.0", "")
		.replace("https://graph.microsoft.com/beta", "");

	// Microsoft return urls with double slashes sometimes so this prevents us ended up with a slash for every recursion.
	while (r.startsWith("//")) {
		r = r.slice(1);
	}

	return r;
};

function odataResponseSchema<S extends z.AnyZodObject>(schema: S) {
	return z.object({
		"@odata.deltaLink": z.string().optional(),
		"@odata.nextLink": z.string().optional(),
		"@odata.count": z.number().optional(),
		value: z.array(
			z.union([
				schema,
				z.object({ "@removed": z.object({}).passthrough(), id: z.any() }),
			]),
		),
	});
}

// TODO: Handle https://learn.microsoft.com/en-us/graph/delta-query-overview#synchronization-reset
export function defineSyncEntity<T extends z.AnyZodObject>(
	name: StoreNames<Database> & TableName,
	options: {
		// The Microsoft endpoint to fetch the data.
		// This is relative as we use `/$batch`.
		endpoint: string;
		// When not provided it is expected the endpoint returns a `@odata.count`.
		// `@odata.count` is not supported for Delta queries hence this.
		countEndpoint: string | undefined;
		// The schema of each item in the returning data.
		schema: T;
		// Insert or update the data in the database.
		upsert: (db: IDBPDatabase<Database>, data: z.output<T>) => Promise<void>;
		// Remove an entity from the database.
		delete: (
			db: IDBPDatabase<Database>,
			id: z.output<T>["id"],
		) => Promise<void>;
	},
) {
	return async (db: IDBPDatabase<Database>, i: number) => {
		// This to to ensure no matter the order that each sync operation returns, it's chunk of the total percentage is always accounted for.
		registerProgress(name, Number.NaN, 0);

		const meta = await db.get("_meta", name);

		const inner = async (
			count: number,
			offset: number,
			resp: z.output<ReturnType<typeof odataResponseSchema<T>>>,
		) => {
			await Promise.all(
				resp.value.map(async (value) => {
					if (value["@removed"]) {
						await options.delete(db, value.id);
					} else {
						await options.upsert(db, value);
					}
				}),
			);

			const isLastPage =
				resp?.["@odata.deltaLink"] || resp?.["@odata.nextLink"] === undefined;
			if (isLastPage) {
				// TODO: Clear all users in DB that were not updated (if this is not a delta sync!).
			}

			registerProgress(name, count, offset + resp.value.length);
			await db.put(
				"_meta",
				isLastPage
					? {
							deltaLink: resp?.["@odata.deltaLink"],
							syncedAt: new Date(),
						}
					: {
							count,
							offset: offset + resp.value.length,
							// We assert, because `isLastPage` accounts for this. TS is just not smart enough.
							nextPage: resp["@odata.nextLink"]!,
						},
				name,
			);
		};

		if (meta && "nextPage" in meta && meta.nextPage) {
			registerBatchedOperation(
				{
					id: name,
					method: "GET",
					url: stripGraphAPIPrefix(meta.nextPage),
				},
				async ([dataResp]) => {
					if (dataResp.status !== 200)
						throw new Error(
							`Failed to fetch ${name}. Got status ${dataResp.status}"`,
						);
					const result = odataResponseSchema(options.schema).safeParse(
						dataResp.body,
					);
					if (result.error)
						throw new Error(
							`Failed to parse ${name} response. ${result.error.message}`,
						);

					await inner(meta.count, meta.offset, result.data);
				},
			);
		} else {
			// Once the sync completes the deltaLink & syncedAt are stored but we don't want to start a syncing again in this "session".
			if (meta && "syncedAt" in meta && i !== 0) return;

			const url =
				meta && "deltaLink" in meta && meta.deltaLink
					? stripGraphAPIPrefix(meta.deltaLink)
					: options.endpoint;

			registerBatchedOperation(
				[
					{
						id: name,
						method: "GET",
						url,
					},
					...(options.countEndpoint
						? ([
								{
									id: `${name}Count`,
									method: "GET",
									url: options.countEndpoint,
									headers: {
										ConsistencyLevel: "eventual",
									},
								},
							] as const)
						: []),
				],
				async ([dataResp, countResp]) => {
					if (dataResp.status !== 200)
						throw new Error(
							`Failed to fetch ${name}. Got status ${dataResp.status}"`,
						);
					const result = odataResponseSchema(options.schema).safeParse(
						dataResp.body,
					);
					if (result.error)
						throw new Error(
							`Failed to parse ${name} response. ${result.error.message}`,
						);

					let count = result.data?.["@odata.count"];
					if (count === undefined)
						if (countResp) {
							if (countResp.status !== 200)
								throw new Error(
									`Failed to fetch ${name} count. Got status ${countResp.status}"`,
								);

							count = z.number().parse(countResp.body);
						} else {
							// The `options.countEndpoint` or `@odata.count` is required.
							throw new Error(`Failed to determine ${name} count!`);
						}

					await inner(count, 0, result.data);
				},
			);
		}
	};
}

// Merge two objects.
//
// If a key in `b` contains `undefined` and the same key is present in `a` it will be merged as `a`'s value.
// If a key in `b` is `undefined` and the same key is not present in `a` it will be treated as `undefined`.
export function merge<T extends Record<any, any>>(a: T | undefined, b: T) {
	return {
		...a,
		...Object.fromEntries(
			Object.entries(b).map(([k, v]) => {
				if (v === undefined && a && a[k] !== undefined) return [k, a[k]];
				return [k, v];
			}),
		),
	} as T;
}
