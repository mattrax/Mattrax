import {
	type CreateMutationResult,
	type DefaultError,
	type QueryClient,
	type SolidMutationOptions,
	createMutation,
} from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { useSync } from ".";
import type { Database } from "../db";
import { getKey } from "../kv";

type MutationOptions<M> = {
	// commit the mutation to the remote API
	commit: (data: M, accessToken: string) => Promise<void> | void;
	// TODO: Should `apply` and `rollback` be optional long-term??? For the online first-stuff it makes sense
	// apply the mutation against the local database
	// We rely on the upsert behaviour of sync to revert this
	apply?: (db: Database, data: M) => Promise<void> | void;
	// rollback the mutation against the local database
	rollback?: (db: Database, data: M) => Promise<void> | void;
};

type Action<M> = ((
	sync: ReturnType<typeof useSync>,
	data: M,
) => Promise<void>) & {
	mutation: { name: string; options: MutationOptions<M> };
};

// TODO
export function defineAction<M>(
	name: string,
	options: MutationOptions<M>,
): Action<M> {
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
				await options.apply?.(sync.db, data);

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

// TODO: Handle `applied: false` mutations on load

export async function applyMigrations(
	db: Database,
	abort: AbortController,
	accessToken: string,
) {
	// TODO: This could be improved to only import the actions we actually need!
	// TODO: but that would probs require some basic codegen (cause we need to know each files exports without importing it).
	const mutations = Object.fromEntries(
		Object.values(await import("./actions/index")).map((mutation) => [
			mutation.mutation.name,
			mutation,
		]),
	);

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

// This hook allows using an action in an ephemeral scope (Eg. online-first mode).
export function useEphemeralAction<
	TError = DefaultError,
	TVariables = void,
	TContext = unknown,
>(
	action: Action<TVariables>,
	options?: () => Omit<
		SolidMutationOptions<void, TError, TVariables, TContext>,
		"mutationKey" | "mutationFn"
	>,
	queryClient?: Accessor<QueryClient>,
): CreateMutationResult<void, TError, TVariables, TContext> {
	const sync = useSync();
	return createMutation(
		() => ({
			mutationKey: [action.name],
			mutationFn: async (data) => {
				const accessToken = await getKey(sync.db, "accessToken");
				if (!accessToken) return; // TODO: Redirect to login momentarily

				await action.mutation.options.apply?.(sync.db, data);
				await action.mutation.options.commit(data, accessToken);
			},
			...options?.(),
		}),
		// TODO: Toast on error?
		queryClient,
	);
}
