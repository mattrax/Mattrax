import { makeEventListener } from "@solid-primitives/event-listener";
import { type DBSchema, type StoreKey, type StoreNames, openDB } from "idb";
import { createResource } from "solid-js";
import { accessToken, logout } from "./util";

interface MyDB extends DBSchema {
	meta: {
		key: "users";
		value: string;
	};
	users: {
		key: string;
		value: {
			id: string;
			name: string;
			upn: string;
		};
		// indexes: { "by-price": number };
	};
}

// TODO: Move into SolidJS lifecycle?
// TODO: https://github.com/jakearchibald/idb?tab=readme-ov-file#typescript
const db = openDB<MyDB>("data", 1, {
	upgrade(db) {
		db.createObjectStore("meta");
		db.createObjectStore("users", {
			keyPath: "id",
		});
	},
});

// TODO: users, device and policies

// TODO: Move into Solid lifecycle?
const bc = new BroadcastChannel("sync");
function subscribeToSync(onMessage: () => void) {
	makeEventListener(bc, "message", () => onMessage());
	makeEventListener(document, "#sync", () => onMessage());
}

function emitSync() {
	bc.postMessage("sync");
	document.dispatchEvent(new Event("#sync"));
}

// TODO: Abstract so this can be used for many types of resources
// TODO: Handle https://learn.microsoft.com/en-us/graph/delta-query-overview#synchronization-reset
export async function syncUsers() {
	let url: string | null =
		(await await (await db).get("meta", "users")) ||
		"https://graph.microsoft.com/v1.0/users/delta";

	while (url !== null) {
		const tx = (await db).transaction(["users", "meta"], "readwrite");
		console.log(url);

		const data = await fetchUsers(url);

		// TODO: Handle if a user is deleted or updated specially????

		// TODO: Using a transaction with the delta link too
		await Promise.all(
			data.value.map(async (user: any) => {
				console.log(user.id, user.displayName, user);

				// TODO: Do an upsert instead of just erroring
				tx.db.add("users", {
					id: user.id,
					name: user.displayName,
					upn: user.userPrincipalName,
				});
			}),
		);
		if (data["@odata.nextLink"]) {
			console.log("More users to fetch...");
			url = data["@odata.nextLink"];
			tx.db.put("meta", data["@odata.nextLink"], "users");
		}
		if (data["@odata.deltaLink"]) {
			console.log("Got Delta link", data["@odata.deltaLink"]);
			tx.db.put("meta", data["@odata.deltaLink"], "users");
			url = null;
		}

		await tx.done;
		emitSync();
	}
}

export async function clearUsers() {
	const tx = (await db).transaction(["users", "meta"], "readwrite");
	tx.db.delete("meta", "users");
	tx.db.clear("users");
	await tx.done;
	emitSync();
}

export function createIdbQuery<Name extends StoreNames<MyDB>>(
	storeName: Name,
	query?: StoreKey<MyDB, Name> | IDBKeyRange | null,
	count?: number,
) {
	const [data, { refetch }] = createResource(
		async () => await (await db).getAll(storeName, query, count),
	);

	// TODO: Make this smart and filter by the storeName being changed
	// TODO: We are suspending when this is called. Tanstack Query would probs fix that.
	subscribeToSync(() => refetch());

	return () => data();
}

export async function fetchUsers(url: string) {
	const resp = await fetch(url, {
		headers: {
			Authorization: accessToken()!,
		},
	});
	if (resp.status === 401) logout(); // TODO: Automatic relogin
	if (!resp.ok) throw new Error("Failed to fetch users");

	return await resp.json();
}
