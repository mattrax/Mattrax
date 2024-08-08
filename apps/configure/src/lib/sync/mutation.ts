import type { IDBPDatabase } from "idb";
import type { useSync } from ".";
import type { Database } from "../db";
import * as allMutations from "./mutations";

// TODO
export function defineMutation<M>(
	name: string,
	options: {
		// commit the mutation to the remote API
		commit: (data: M, accessToken: string) => Promise<void> | void;
		// apply the mutation against the local database
		// We rely on the upsert behaviour of sync to revert this
		apply: (db: IDBPDatabase<Database>, data: M) => Promise<void> | void;
	},
) {
	const callback = async (sync: ReturnType<typeof useSync>, data: M) => {
		const id = crypto.randomUUID();

		// We lock to ensure we don't try and double commit if a sync were to spawn in the middle of this mutation
		await navigator.locks.request("mutations", async (lock) => {
			if (!lock) return;

			await sync.db.add("_mutations", {
				id,
				type: name,
				data,
				applied: false,
			});

			try {
				await options.apply(sync.db, data);

				await sync.db.put("_mutations", {
					id,
					type: name,
					data,
					applied: true,
				});
			} catch (err) {
				console.error(`Failed to apply mutation ${id} of type ${name}: ${err}`);
			}
		});
		// We trigger a background sync which will push the mutation to the server
		sync.syncAll(sync.abort);
	};

	return Object.assign(callback, { mutation: { name, options } });
}

const mutations = Object.fromEntries(
	Object.values(allMutations).map((mutation) => [
		mutation.mutation.name,
		mutation,
	]),
);

// TODO: Handle `applied: false` mutations on load

export async function applyMigrations(
	db: IDBPDatabase<Database>,
	abort: AbortController,
	accessToken: string,
) {
	await navigator.locks.request("mutations", async (lock) => {
		if (!lock) return;

		const queued = await db.getAll("_mutations");

		for (const mutation of queued) {
			if (abort.signal.aborted) return;

			const def = mutations[mutation.type];
			if (!def)
				throw new Error(
					`Attempted to apply unknown mutation type: ${mutation.type}`,
				);

			try {
				await def.mutation.options.commit(mutation.data, accessToken);
				await db.delete("_mutations", mutation.id);
			} catch (err) {
				console.error(
					`Failed to commit mutation ${mutation.id} of type ${mutation.type}: ${err}`,
				);
			}
		}
	});
}
