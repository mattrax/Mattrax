import type { IDBPDatabase } from "idb";
import { type Database, type TableName, db } from "../db";

export type SyncOperation = TableName;

type SyncOperationResult<M> =
	| {
			type: "continue";
			// count: number;
			// total: number;
			meta: M;
	  }
	| {
			type: "complete";
			meta: M;
	  };

type SyncOperationContext = {
	// IndexDB instance
	db: IDBPDatabase<Database>;
	// The identifier of the current sync operation
	syncId: string;
	// The last sync time.
	// This will only be set for the first operation in a sync session.
	syncedAt?: Date;

	// TODO: Maybe don't do it like this. Really `registerBatchedOperationsAsync` should ask for the latest, instead of using the potentially outdated one it has???
	accessToken: string;
};

/// Define a sync operation which has it's state managed the `_meta` table.
///
/// This deals with all the complicated logic of tracking and updating the progress of the operation, along with resuming once interrupted.
///
/// Internally this function uses the Web Locks API because IndexedDB transaction suck phat ballz (and it auto-commits on an `await`, like wtf).
export function defineSyncOperation<M>(
	name: SyncOperation,
	// Runs for each iteration of the sync operation
	// This will keep running until you return a `complete` result
	callback: (
		ctx: SyncOperationContext & {
			// Metadata returned from the previous callback or last sync session
			metadata?: M;
		},
	) => Promise<SyncOperationResult<M>> | SyncOperationResult<M>,
	// Executed after the sync operation is completed
	// Be aware this may fire multiple times we fail to commit the final state.
	onComplete?: (
		ctx: SyncOperationContext & {
			// Metadata returned from the previous callback
			metadata: M;
		},
	) => Promise<void> | void,
) {
	// TODO: Invalidate progress -> Using IndexedDB observer stuff???

	// TODO: Can we not call callback if this operation is done for the current sync session? Look the callback should be safe but idk.

	return async (db: IDBPDatabase<Database>, accessToken: string) => {
		// Ensure we are in the "syncing" state
		const [syncId, initialMetadata]: [string, any] =
			await navigator.locks.request(`|sync|meta|${name}`, async (lock) => {
				if (!lock) return;
				const meta = await db.get("_meta", name);
				let syncId: string;
				if (meta && "syncId" in meta) {
					// We are resuming an active sync that was interrupted
					syncId = meta.syncId;
					console.log("Continuing sync interrupted", name, syncId); // TODO: debug
				} else {
					// We are starting a new sync
					// or alternatively, we are resuming *and* this specific operation was completed in the previous partial-session (which causes it to be resynced)
					syncId = Date.now().toString();
					await db.put(
						"_meta",
						{ syncId, completed: 0, total: Number.NaN, meta: meta?.meta },
						name,
					);
					console.log("Starting sync", name, syncId); // TODO: debug
				}
				return [syncId, meta?.meta];
			});

		let result: SyncOperationResult<M>;
		let metadata = initialMetadata;
		do {
			result = await callback({ db, syncId, metadata, accessToken });
			metadata = result.meta;

			if (result.type === "complete")
				await onComplete?.({ db, syncId, metadata: result.meta, accessToken });

			await navigator.locks.request(`|sync|meta|${name}`, async (lock) => {
				if (!lock) return;
				await db.put(
					"_meta",
					result.type === "complete"
						? {
								syncedAt: new Date(),
								meta: result.meta,
							}
						: {
								syncId,
								completed: 0, // TODO
								total: Number.NaN, // TODO
								meta: result.meta,
							},
					name,
				);
			});
		} while (result.type !== "complete");
	};
}

/// Compute the progress of all active sync operations.
export async function computeProgress() {
	// TODO: Do using reactive query system???

	const metas = await (await db).getAll("_meta");

	const activeMetas = metas
		// We only want items that are actively syncing
		.filter((meta) => "syncId" in meta);

	// TODO: Finish this

	// const total = activeMetas.reduce

	// for (const meta of metas) {
	// 	// We only want items that are actively syncing
	// 	if (!("syncId" in meta)) continue;

	// 	console.log(meta);
	// }

	return 0;
}
