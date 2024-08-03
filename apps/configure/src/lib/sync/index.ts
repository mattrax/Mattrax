import { createContextProvider } from "@solid-primitives/context";
import { useNavigate } from "@solidjs/router";
import { createResource, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { createTimer2 } from "../createTimer";
import {
	type Database,
	db,
	invalidateStore,
	subscribeToInvalidations,
} from "../db";
import { deleteKey, setKey } from "../kv";
import * as schema from "./schema";

export type SyncEngine = ReturnType<typeof initSyncEngine>;

export const [SyncEngineProvider, useSyncEngine] = createContextProvider(
	(props: { engine: SyncEngine }) => props.engine,
	undefined!,
);

export async function initDatabase(
	accessToken: string,
	refreshToken: string,
	user: any,
) {
	// TODO: Create the actual `db` here
	await setKey(await db, "accessToken", accessToken);
	await setKey(await db, "refreshToken", refreshToken);
	await setKey(await db, "user", mapUser(user));
	invalidateStore("auth");
}

export function initSyncEngine() {
	// This is used to cache kv. We intentially don't use a signal because we don't want to rerun stuff when this changes (Eg. new access token shouldn't refetch already valid data).
	// This should be accessed through `await kv` to ensure it's valid.
	let kvRaw: Partial<Record<Database["_kv"]["key"], Database["_kv"]["value"]>> =
		{};

	// Load all data from the `_kv` table. This contains auth and user information standard to the sync system.
	const kv = async () => {
		if (Object.keys(kvRaw).length === 0) {
			for await (const c of (await db).transaction("_kv").store) {
				kvRaw[c.key] = c.value;
			}
		}
		return kvRaw;
	};

	const [isSyncing, setIsSyncing] = createSignal(false);
	const [progress, setProgress] = createSignal(0); // TODO: Sync `progress` between tabs

	subscribeToInvalidations((store) => {
		if (store === "syncProgress")
			setProgress(
				// TODO: Make this ephemeral instead of using `localStorage`?
				Number.parseInt(localStorage.getItem("syncProgress") ?? "0") || 0,
			);
	});

	// Polling is not *great* but it's the most reliable way to keep track across tabs.
	const isSyncingCheck = createTimer2(
		async () => {
			const locks = await navigator.locks.query();
			setIsSyncing(locks.held?.find((l) => l.name === "sync") !== undefined);
		},
		// We regularly poll because we just can't trust that the other tab will tell us when it releases the lock (it could have crashed/been closed)
		// We can pretty safely assume we will get a message when the lock is acquired but not when it's released.
		// Given this we poll a lot more aggressively when we're syncing.
		() => (isSyncing() ? 250 : 2000),
	);
	isSyncingCheck.trigger();
	subscribeToInvalidations((store) => {
		if (store === "isSyncing") isSyncingCheck.trigger();
	});

	const navigate = useNavigate();
	const [user, { refetch }] = createResource(async () => {
		const user = (await kv())?.user;
		const accessToken = (await kv())?.accessToken;
		if (!accessToken) {
			navigate("/");
			await new Promise((resolve) => {});
		}
		if (!user) {
			const user = await fetch("https://graph.microsoft.com/v1.0/me");
			await setKey(await db, "user", mapUser(user));
		}

		return user;
	});

	subscribeToInvalidations((store) => {
		if (store === "auth") {
			kvRaw = {};
			refetch();
		}
	});

	return {
		isSyncing: isSyncing,
		progress,
		user,
		async logout() {
			await deleteKey(await db, "accessToken");
			await deleteKey(await db, "refreshToken");
			await deleteKey(await db, "user");
			invalidateStore("auth");
		},
		async syncAll(): Promise<string | undefined> {
			const accessToken = (await kv()).accessToken;
			if (!accessToken) {
				console.warn("Sync attempted without valid access token. Ignoring!");
				return;
			}

			// Be aware the way use this lock intentionally queues up syncs.
			// Eg. if two tabs hit this code path, one will sync and then the other will sync (both triggering a full sync).
			//
			// This behavior is desired because it's possible the user killed the first tab mid-sync/
			// We need to be certain the full-sync has been done instead of treating the half-sync as if it were a full sync.
			//
			// To mitigate the impacts of this we should // TODO
			const result = await navigator.locks.request("sync", async (lock) => {
				if (!lock) return;

				setProgress(0);
				invalidateStore("isSyncing");
				isSyncingCheck.trigger();

				const start = performance.now();
				let wasError = false;
				try {
					const d = await db;
					await Promise.all(
						Object.values(schema).map((sync) => sync(d, accessToken)),
					);
				} catch (err) {
					if (err instanceof UnauthorizedError) {
						// TODO: Refresh access token and try again???

						await this.logout();
						return;
					}
					console.error("Error occurred during sync:", err);
					toast.error("Error syncing with Microsoft!", {
						id: "sync-error",
						description: "Your error has been reported to the team!",
					});
					wasError = true;
				}
				setProgress(0);
				const elapsed = ((performance.now() - start) / 1000).toFixed(2);
				console.log("Synced in", elapsed, "s");
				// This is to avoid the success toast showing up.
				return wasError ? undefined : elapsed;
			});
			isSyncingCheck.trigger();
			return result;
		},
		mutation() {
			// TODO: Queueing up mutation into IndexedDB
			// TODO: Applying mutations with proper Atomic locking.
		},
	};
}

// TODO: Really this should go in `schema.ts` and not be exported???
// Convert between a Microsoft Graph user object and our internal user object.
export function mapUser(data: any) {
	return {
		id: data.id,
		name: data.displayName,
		upn: data.userPrincipalName,
		avatar: undefined as string | undefined,
		avatarEtag: undefined as string | undefined,
	};
}

export type User = ReturnType<typeof mapUser>;

class UnauthorizedError extends Error {
	constructor() {
		super("Unauthorized");
	}
}
