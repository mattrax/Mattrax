import type { Database, TableName } from "../db";

export type SyncOperation = TableName | "me" | "organization";

type SyncOperationResult<M> =
	| {
			type: "continue";
			completed: number;
			total: number;
			meta: M;
	  }
	| {
			type: "complete";
			meta: M;
	  };

type SyncOperationContext = {
	// IndexDB instance
	db: Database;
	// The identifier of the current sync operation
	syncId: string;
	// The last sync time.
	// This will only be set for the first operation in a sync session.
	syncedAt?: Date;
	// The total count of items to sync.
	// This will be empty of the first sync.
	total?: number;
	// The total count of items that have been synced in the current session.
	completed: number;
	// TODO: Maybe don't do it like this. Really `registerBatchedOperationsAsync` should ask for the latest, instead of using the potentially outdated one it has???
	accessToken: string;
};

/// Define a sync operation which has it's state managed the `_meta` table.
///
/// This deals with all the complicated logic of tracking and updating the progress of the operation, along with resuming if it is interrupted.
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
	return async (db: Database, abort: AbortController, accessToken: string) => {
		// Ensure we are in the "syncing" state
		const [syncId, initialMetadata, initialCompleted, initialTotal]: [
			string,
			any,
			number,
			number,
		] = await navigator.locks.request(`|sync|meta|${name}`, async (lock) => {
			if (!lock) return;
			const meta = await db.get("_meta", name);
			let syncId: string;
			let completed = 0;
			let total = Number.NaN;
			if (meta && "syncId" in meta) {
				// We are resuming an active sync that was interrupted
				syncId = meta.syncId;
				completed = meta.completed;
				total = meta.total;
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
			return [syncId, meta?.meta, completed, total];
		});

		let result: SyncOperationResult<M>;
		let [metadata, completed, total] = [
			initialMetadata,
			initialCompleted,
			initialTotal,
		];
		do {
			if (abort.signal.aborted) return;

			result = await callback({
				db,
				syncId,
				metadata,
				accessToken,
				completed,
				total: Number.isNaN(total) ? undefined : total,
			});
			metadata = result.meta;
			if (result.type === "continue") {
				completed = result.completed;
				total = result.total;
			}

			if (result.type === "complete")
				await onComplete?.({
					db,
					syncId,
					metadata: result.meta,
					accessToken,
					completed,
					total: Number.isNaN(total) ? undefined : total,
				});

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
								completed: result.completed,
								total: result.total,
								meta: result.meta,
							},
					name,
				);
			});
		} while (result.type !== "complete");
	};
}

export async function resetSyncState(db: Database) {
	await navigator.locks.request("sync", async (lock) => {
		if (!lock) return;
		await db.clear("_meta");
	});
}

export async function didLastSyncCompleteSuccessfully(db: Database) {
	const meta = await db.getAll("_meta");
	return meta.every((m) => "syncedAt" in m);
}
