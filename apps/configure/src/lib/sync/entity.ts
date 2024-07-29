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
		upsert: (data: z.output<T>) => Promise<void>;
		// Remove an entity from the database.
		delete: (id: string) => Promise<void>;
	},
) {
	return async (db: IDBPDatabase<Database>, i: number) => {
		// This to to ensure no matter the order that each sync operation returns, it's chunk of the total percentage is always accounted for.
		registerProgress(name, Number.NaN, 0);

		const meta = await db.get("_meta", name);

		const inner = async (count: number, offset: number, resp: any) => {
			for (const value of resp.value) {
				// TODO: Handle delta diffs

				console.log(name, value);
			}

			if (resp?.["@odata.deltaLink"]) {
				// TODO: Clear all users in DB that were not updated (if this is not a delta sync!).
			}

			registerProgress(name, count, offset + resp.value.length);
			await db.put(
				"_meta",
				resp?.["@odata.deltaLink"]
					? {
							deltaLink: resp["@odata.deltaLink"],
							syncedAt: new Date(),
						}
					: {
							count,
							offset: offset + resp.value.length,
							nextPage: resp["@odata.nextLink"],
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
				async ([resp]) => {
					if (resp.status !== 200)
						throw new Error(
							`Failed to fetch ${name}. Got status ${resp.status}"`,
						);
					await inner(meta.count, meta.offset, resp.body);
				},
			);
		} else {
			// Once the sync completes the deltaLink is stored but we don't want to start a syncing again in this "session".
			// So we only follow deltaLinks when this is the first sync.
			if (meta && "deltaLink" in meta && meta.deltaLink && i !== 0) return;

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
				async ([data, countResp]) => {
					if (data.status !== 200)
						throw new Error(
							`Failed to fetch ${name}. Got status ${data.status}"`,
						);

					let count = z
						.number()
						.optional()
						.parse((data.body as any)?.["@odata.count"]);

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

					await inner(count, 0, data.body);
				},
			);
		}
	};
}
