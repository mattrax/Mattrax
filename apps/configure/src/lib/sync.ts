/* @refresh reload */
import { createContextProvider } from "@solid-primitives/context";
import { useNavigate } from "@solidjs/router";
import type { IDBPDatabase } from "idb";
import { createResource, createSignal } from "solid-js";
import { createTimer2 } from "./createTimer";
import {
	type Database,
	db,
	invalidateStore,
	subscribeToInvalidations,
} from "./db";

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
	await (await db).put("_kv", accessToken, "accessToken");
	await (await db).put("_kv", refreshToken, "refreshToken");
	await (await db).put("_kv", mapUser(user), "user"); // TODO: Fix types
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
			await db.put("_kv", mapUser(user), "user"); // TODO: Fix types
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
			await (await db).delete("_kv", "accessToken");
			await (await db).delete("_kv", "refreshToken");
			await (await db).delete("_kv", "user");
			invalidateStore("auth");
		},
		async syncAll() {
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
				try {
					await doSync(await db, accessToken);
				} catch (err) {
					console.error("Error syncing", err);
				}
				setProgress(0);
				const elapsed = ((performance.now() - start) / 1000).toFixed(2);
				console.log("Synced in", elapsed, "s");
				return elapsed;
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

// Convert between a Microsoft Graph user object and our internal user object.
function mapUser(data: any) {
	return {
		id: data.id,
		name: data.displayName,
		upn: data.userPrincipalName,
	};
}

// The core sync coordination function.
async function doSync(db: IDBPDatabase<Database>, accessToken: string) {
	console.log("Syncing...");

	const fetch = async (url: string, init?: RequestInit) => {
		// TODO: Join `init` to extra options
		const headers = new Headers(init?.headers);
		headers.append("Authorization", accessToken);
		const resp = await globalThis.fetch(url, {
			...init,
			headers,
		});
		if (resp.status === 401) {
			// TODO: Automatic relogin using refresh token if possible

			throw new Error("Unauthorized");
		}
		if (!resp.ok) throw new Error("Failed to fetch data");
		return await resp.json();
	};

	// TODO: Detecting if we just finished syncing.
	// TODO: Detect if any syncs are currently in progress Eg. nextPage not delta

	// TODO: Including avatar
	const user = await fetch("https://graph.microsoft.com/v1.0/me");
	await db.put("_kv", mapUser(user), "user"); // TODO: Fix types

	const isFirstSync = (await db.count("users")) === 0;

	const resp = await fetch("https://graph.microsoft.com/v1.0/$batch", {
		method: "POST",
		headers: new Headers({
			"Content-Type": "application/json",
		}),
		body: JSON.stringify({
			requests: [
				...(isFirstSync
					? [
							{
								id: "1",
								method: "GET",
								url: "/users/$count",
								headers: {
									ConsistencyLevel: "eventual",
								},
							},
						]
					: []),
				{
					id: "2",
					method: "GET",
					url: "/users/delta",
				},
			],
		}),
	});

	const usersCountResp = resp.responses.find((r: any) => r.id === "1");
	const usersDeltaResp = resp.responses.find((r: any) => r.id === "2");
	// TODO: Error handling on these responses

	if (usersCountResp) {
		const usersCount = usersCountResp.body;
		let loadedCount = usersDeltaResp.body.value.length;
		const updateProgress = () => {
			const progress = ((loadedCount / usersCount) * 100).toFixed(0);
			localStorage.setItem("syncProgress", progress);
			invalidateStore("syncProgress");
		};

		updateProgress();
		let url = usersDeltaResp.body["@odata.nextLink"];
		while (url !== null) {
			const delta = await fetch(url);
			loadedCount += delta.value.length;
			updateProgress();
			if (delta["@odata.nextLink"]) {
				url = delta["@odata.nextLink"];
			} else {
				url = null;
			}
		}
	}

	// TODO: Sync everything else
	// TODO: Progress tracking!!!

	// const users = await fetch<any>(
	// 	"https://graph.microsoft.com/v1.0/users/delta",
	// );
	// await db.put("_meta", users, {});
	// console.log(users);

	// await new Promise((resolve) => setTimeout(resolve, 1000)); // TODO: Remove this
}
