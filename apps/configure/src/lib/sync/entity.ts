import type { IDBPDatabase, StoreNames } from "idb";
import { z } from "zod";
import type { Database, TableName } from "../db";
import {
	type Operation,
	registerBatchedOperation,
	registerProgress,
} from "./state";

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
		upsert: (db: IDBPDatabase<Database>, data: z.output<T>) => Promise<void>;
		// Remove an entity from the database.
		delete: (
			db: IDBPDatabase<Database>,
			id: z.output<T>["id"],
		) => Promise<void>;
	},
) {
	return async (db: IDBPDatabase<Database>, t: number) => {
		const endpoints = Array.isArray(options.endpoint)
			? options.endpoint
			: [options.endpoint];

		// This to to ensure no matter the order that each sync operation returns, it's chunk of the total percentage is always accounted for.
		endpoints.forEach((_, i) =>
			registerProgress(`${name}-${i}`, Number.NaN, 0),
		);

		let metas = await db.get("_meta", name);

		endpoints.forEach((endpointUrl, i) => {
			const meta = metas ? metas?.[i] : undefined;

			const operations: Operation[] = [];
			if (meta && "nextPage" in meta) {
				operations.push({
					id: `${name}-${i}`,
					method: "GET",
					url: stripGraphAPIPrefix(meta.nextPage),
				});
			} else if (t === 0) {
				operations.push({
					id: `${name}-${i}`,
					method: "GET",
					url:
						meta && "deltaLink" in meta && meta.deltaLink
							? stripGraphAPIPrefix(meta.deltaLink)
							: endpointUrl,
				});
				if (options.countEndpoint)
					operations.push({
						id: `${name}-count`,
						method: "GET",
						url: options.countEndpoint,
						headers: {
							ConsistencyLevel: "eventual",
						},
					});
			}

			registerBatchedOperation(operations, async (responses) => {
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

				// TODO: What if multiple counts!!!!!
				let count = result.data?.["@odata.count"];
				if (count === undefined)
					if (countResp) {
						if (countResp.status !== 200)
							throw new Error(
								`Failed to fetch ${name} count. Got status ${countResp.status}"`,
							);

						count = z.number().parse(countResp.body);
					} else if (meta && "count" in meta) {
						count = meta.count;
					} else {
						// The `options.countEndpoint` or `@odata.count` is required.
						throw new Error(`Failed to determine ${name} count!`);
					}

				const offset = meta && "offset" in meta ? meta.offset : 0;

				await Promise.all(
					result.data.value.map(async (value) => {
						if (value["@removed"]) {
							await options.delete(db, value.id);
						} else {
							await options.upsert(db, value);
						}
					}),
				);

				const isLastPage =
					result.data?.["@odata.deltaLink"] ||
					result.data?.["@odata.nextLink"] === undefined;

				// TODO: This should only run once all other operations under the same table are done.
				if (isLastPage) {
					// console.log("isLastPage for ", name, i); // TODO
					// TODO: Clear all users in DB that were not updated (if this is not a delta sync!).
				}

				// TODO: We should hold a lock on `_meta` or do something smart cause this is pretty unsafe.
				registerProgress(
					`${name}-${i}`,
					count,
					offset + result.data.value.length,
				);
				if (!metas) metas = {};
				metas[i] = isLastPage
					? {
							deltaLink: result.data?.["@odata.deltaLink"],
							syncedAt: new Date(),
						}
					: {
							count,
							offset: offset + result.data.value.length,
							// We assert, because `isLastPage` accounts for this. TS is just not smart enough.
							nextPage: result.data["@odata.nextLink"]!,
						};
				await db.put("_meta", metas, name);
			});
		});
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
