import { createContextProvider } from "@solid-primitives/context";
import type { IDBPDatabase } from "idb";
import { toast } from "solid-sonner";
import type { Database } from "../db";
import { deleteKey, getKey } from "../kv";
import { didLastSyncCompleteSuccessfully } from "./operation";
import * as schema from "./schema";

export type SyncEngine = ReturnType<typeof initSync>;

export const [SyncProvider, useSync] = createContextProvider(
	(props: { engine: SyncEngine }) => props.engine,
	undefined!,
);

export function initSync(db: IDBPDatabase<Database>) {
	return {
		db,
		async syncAll(abort: AbortController): Promise<string | undefined> {
			if (abort.signal.aborted) return;
			if (!navigator.onLine) {
				console.warn("Sync cancelled due to navigator being offline!");
				return;
			}

			const isSyncLockAlreadyHeld = (await navigator.locks.query()).held?.find(
				(lock) => lock.name === "sync",
			);

			// Be aware the way use this lock intentionally queues up syncs.
			// Eg. if two tabs hit this code path, one will sync and then the other will sync (both triggering a full sync).
			//
			// This behavior is desired because it's possible the user killed the first tab mid-sync/
			// We need to be certain the full-sync has been done instead of treating the half-sync as if it were a full sync.
			//
			// To mitigate the impacts of this we should // TODO
			const result = await navigator.locks.request("sync", async (lock) => {
				if (!lock) return;

				// The sync was queued while a sync was already in progress but it succeeded so we can skip it.
				if (
					abort.signal.aborted ||
					(isSyncLockAlreadyHeld && (await didLastSyncCompleteSuccessfully(db)))
				)
					return;

				const accessToken = await getKey(db, "accessToken");
				if (!accessToken) {
					console.warn("Sync attempted without valid access token. Ignoring!");
					return;
				}

				const start = performance.now();
				let wasError = false;
				try {
					await Promise.all(
						Object.values(schema).map((sync) => sync(db, abort, accessToken)),
					);
					// We done care about the result if the sync was cancelled.
					if (abort.signal.aborted) return;
				} catch (err) {
					// We done care about the error if the sync was aborted.
					if (abort.signal.aborted) return;
					if (err instanceof UnauthorizedError) {
						// TODO: Refresh access token and try again???

						await deleteKey(db, "accessToken");
						await deleteKey(db, "refreshToken");
						await deleteKey(db, "user");
						return;
					}
					console.error("Error occurred during sync:", err);
					toast.error("Error syncing with Microsoft!", {
						id: "sync-error",
						description: "Your error has been reported to the team!",
					});
					wasError = true;
				}
				const elapsed = ((performance.now() - start) / 1000).toFixed(2);
				console.log("Synced in", elapsed, "s");
				// This is to avoid the success toast showing up.
				return wasError ? undefined : elapsed;
			});
			return result;
		},
	};
}

export class UnauthorizedError extends Error {
	constructor() {
		super("Unauthorized");
	}
}
