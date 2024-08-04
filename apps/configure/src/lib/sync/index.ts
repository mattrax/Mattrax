import { createContextProvider } from "@solid-primitives/context";
import { toast } from "solid-sonner";
import { logout } from "../auth";
import { db } from "../db";
import { getKey, setKey } from "../kv";
import * as schema from "./schema";

export type SyncEngine = ReturnType<typeof initSyncEngine>;

export const [SyncEngineProvider, useSyncEngine] = createContextProvider(
	(props: { engine: SyncEngine }) => props.engine,
	undefined!,
);

export async function initDatabase(accessToken: string, refreshToken: string) {
	// TODO: Create the actual `db` here
	await setKey(await db, "accessToken", accessToken);
	await setKey(await db, "refreshToken", refreshToken);
}

export function initSyncEngine() {
	return {
		async syncAll(): Promise<string | undefined> {
			// Be aware the way use this lock intentionally queues up syncs.
			// Eg. if two tabs hit this code path, one will sync and then the other will sync (both triggering a full sync).
			//
			// This behavior is desired because it's possible the user killed the first tab mid-sync/
			// We need to be certain the full-sync has been done instead of treating the half-sync as if it were a full sync.
			//
			// To mitigate the impacts of this we should // TODO
			const result = await navigator.locks.request("sync", async (lock) => {
				if (!lock) return;
				const d = await db;

				const accessToken = await getKey(d, "accessToken");
				if (!accessToken) {
					console.warn("Sync attempted without valid access token. Ignoring!");
					return;
				}

				const start = performance.now();
				let wasError = false;
				try {
					await Promise.all(
						Object.values(schema).map((sync) => sync(d, accessToken)),
					);
				} catch (err) {
					if (err instanceof UnauthorizedError) {
						// TODO: Refresh access token and try again???

						await logout();
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
		mutation() {
			// TODO: Queueing up mutation into IndexedDB
			// TODO: Applying mutations with proper Atomic locking.
		},
	};
}

export class UnauthorizedError extends Error {
	constructor() {
		super("Unauthorized");
	}
}
