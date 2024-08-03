import type { IDBPDatabase, StoreNames } from "idb";
import { z } from "zod";
import type { Database, TableName } from "../db";
import { registerBatchedOperationAsync } from "./microsoft";
import { defineSyncOperation } from "./operation";
import type { Operation } from "./state";

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

// TODO: Break out into Microsoft stuff???
export function odataResponseSchema<S extends z.ZodTypeAny>(schema: S) {
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

type EntityMeta = {
	[key: number]:
		| {
				nextPage: string;
		  }
		| {
				deltaLink?: string;
		  };
};

// TODO: Handle https://learn.microsoft.com/en-us/graph/delta-query-overview#synchronization-reset
export function defineSyncEntity<T extends z.ZodTypeAny>(
	name: StoreNames<Database> & TableName,
	options: {
		// The Microsoft endpoint to fetch the data.
		// This is relative as we use `/$batch`.
		endpoint: string | string[];
		// When not provided it is expected the endpoint returns a `@odata.count`.
		// `@odata.count` is not supported for Delta queries hence this.
		countEndpoint: string | undefined;
		// The schema of each item in the returning data.
		schema: T;
		// Insert or update the data in the database.
		upsert: (
			db: IDBPDatabase<Database>,
			data: z.output<T>,
			syncId: string,
		) => Promise<void>;
		// Remove an entity from the database.
		// Be aware this will only be called for delta queries. Your expected to implement `cleanup` for full-syncs.
		delete: (
			db: IDBPDatabase<Database>,
			id: z.output<T>["id"],
		) => Promise<void>;
		// Run after the sync is completed.
		// This is useful for cleaning up all data not returned in the current full-sync (as non-delta queries have no remove action).
		cleanup: (db: IDBPDatabase<Database>, syncId: string) => Promise<void>;
	},
) {
	const endpoints = Array.isArray(options.endpoint)
		? options.endpoint
		: [options.endpoint];

	return defineSyncOperation<EntityMeta>(
		name,
		async ({ db, syncId, syncedAt, metadata, accessToken }) => {
			const result = await Promise.all(
				endpoints.map(async (endpointUrl, i) => {
					const meta = metadata ? metadata?.[i] : undefined;

					const operations: Operation[] = [];
					if (meta && "nextPage" in meta) {
						operations.push({
							id: `${name}-${i}`,
							method: "GET",
							url: stripGraphAPIPrefix(meta.nextPage),
						});
					} else if (meta === undefined || syncedAt === undefined) {
						operations.push({
							id: `${name}-${i}`,
							method: "GET",
							url:
								meta && "deltaLink" in meta && meta.deltaLink
									? stripGraphAPIPrefix(meta.deltaLink)
									: endpointUrl,
						});
						if (options.countEndpoint && syncedAt)
							operations.push({
								id: `${name}-count`,
								method: "GET",
								url: options.countEndpoint,
								headers: {
									ConsistencyLevel: "eventual",
								},
							});
					}

					const responses = await registerBatchedOperationAsync(
						operations,
						accessToken,
					);

					const response = responses.shift()!;
					const countResp = responses.shift();

					if (response.status !== 200)
						throw new Error(
							`Failed to fetch ${name}. Got status ${response.status} from request "${response.id}"`,
						);
					const result = odataResponseSchema(options.schema).safeParse(
						response.body,
					);
					if (result.error)
						throw new Error(
							`Failed to parse ${name} response from request "${response.id}". ${result.error.message}`,
						);

					// TODO: Fix progress
					// let count = result.data?.["@odata.count"];
					// if (count === undefined)
					// 	if (countResp) {
					// 		if (countResp.status !== 200)
					// 			throw new Error(
					// 				`Failed to fetch ${name} count. Got status ${countResp.status}"`,
					// 			);

					// 		count = z.number().parse(countResp.body);
					// 	} else if (meta && "count" in meta) {
					// 		count = meta.count;
					// 	} else {
					// 		// The `options.countEndpoint` or `@odata.count` is required.
					// 		throw new Error(`Failed to determine ${name} count!`);
					// 	}

					// const offset = meta && "offset" in meta ? meta.offset : 0;

					await Promise.all(
						result.data.value.map(async (value) => {
							if (value["@removed"]) {
								await options.delete(db, value.id);
							} else {
								await options.upsert(db, value, syncId);
							}
						}),
					);

					// const isLastPage =
					// 	result.data?.["@odata.deltaLink"] ||
					// 	result.data?.["@odata.nextLink"] === undefined;

					// isLastPage ? {
					// deltaLink: result.data?.["@odata.deltaLink"],
					// syncedAt: new Date(),
					// lastSyncId: syncId,
					// }
					// : {
					// count,
					// offset: offset + result.data.value.length,
					// // We assert, because `isLastPage` accounts for this. TS is just not smart enough.
					// nextPage: result.data["@odata.nextLink"]!,
					// };

					return [
						i,
						result.data?.["@odata.nextLink"]
							? {
									nextPage: result.data?.["@odata.nextLink"],
								}
							: {
									deltaLink: result.data?.["@odata.deltaLink"],
								},
					] as const;
				}),
			);

			return {
				// Remember `in` doesn't care that `r.deltaLink === undefined`.
				type: result.every(([i, r]) => "deltaLink" in r)
					? "complete"
					: "continue",
				meta: Object.fromEntries(result),
			};
		},
		({ db, syncId }) => options.cleanup(db, syncId),
	);
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
