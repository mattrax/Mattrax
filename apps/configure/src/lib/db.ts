import { makeEventListener } from "@solid-primitives/event-listener";
import { createQuery } from "@tanstack/solid-query";
import { type DBSchema, type StoreKey, type StoreNames, openDB } from "idb";
import type { Filter } from "../routes/(dash)/search";

export type MetaTableKeys =
	| "users"
	| "devices"
	| "groups"
	| "policies"
	| "apps"
	| "accessToken"
	| "refreshToken";

export interface Database extends DBSchema {
	// Used to store delta or next page links for each entity
	// This allows us to resume fetching data from where we left off or fetch the diff since the last sync.
	_meta: {
		key: MetaTableKeys;
		value: string;
	};
	// Stored views
	views: {
		key: string;
		value: {
			id: string;
			// slug?: string;
			name: string;
			description?: string;
			data: Filter[];
		};
	};
	// Entities from Microsoft
	users: {
		key: string;
		value: {
			id: string;
			name: string;
			upn: string;
		};
	};
	devices: {
		key: string;
		value: {
			id: string;
			name: string;
		};
	};
	groups: {
		key: string;
		value: {
			id: string;
			name: string;
		};
	};
	policies: {
		key: string;
		value: {
			id: string;
			name: string;
		};
	};
	apps: {
		key: string;
		value: {
			id: string;
			name: string;
		};
	};
}

export const db = openDB<Database>("data", 1, {
	upgrade(db) {
		db.createObjectStore("_meta");
		db.createObjectStore("views", {
			keyPath: "id",
		});
		db.createObjectStore("users", {
			keyPath: "id",
		});
		db.createObjectStore("devices", {
			keyPath: "id",
		});
		db.createObjectStore("groups", {
			keyPath: "id",
		});
		db.createObjectStore("policies", {
			keyPath: "id",
		});
		db.createObjectStore("apps", {
			keyPath: "id",
		});
	},
	terminated() {
		// TODO: Warning & disable all UI state???
	},
});

// TODO: Typescript proof this is all the stores
const tables = [
	"_meta",
	"views",
	"users",
	"devices",
	"groups",
	"policies",
	"apps",
] as const;

export async function resetDb() {
	const tx = (await db).transaction(tables);
	for (const table of tables) {
		tx.db.clear(table);
	}
	await tx.done;
}

const syncBroadcastChannel = new BroadcastChannel("sync");

type InvalidationKey = StoreNames<Database> | "auth";

// Subscribe to store invalidations to trigger queries to rerun of the data
export function subscribeToInvalidations(
	onChange: (store: InvalidationKey) => void,
) {
	const onChangeInner = (data: any) => {
		if (typeof data === "string") onChange(data as any);
		else if (typeof data === "object" && Array.isArray(data)) {
			for (const store of data) {
				onChange(store);
			}
		} else {
			console.error(
				`subscribeToInvalidations: got invalid type '${typeof data}'`,
			);
		}
	};

	makeEventListener(syncBroadcastChannel, "message", (event) => {
		if (event.origin !== window.origin) return;
		onChangeInner(event.data);
	});
	makeEventListener(document, "#sync", (event) =>
		onChangeInner((event as any).detail),
	);
}

// This will invalidate a store, triggering all queries against it to rerun updating the UI.
export function invalidateStore(
	storeName: InvalidationKey | InvalidationKey[],
) {
	syncBroadcastChannel.postMessage(storeName);
	document.dispatchEvent(new CustomEvent("#sync", { detail: storeName }));
}

// Construct a reactive IndexedDB query for usage within SolidJS.
export function createIdbQuery<Name extends StoreNames<Database>>(
	storeName: Name,
	query?: StoreKey<Database, Name> | IDBKeyRange | null,
	count?: number,
) {
	const data = createQuery(() => ({
		queryKey: [storeName, query, count],
		queryFn: async () => await (await db).getAll(storeName, query, count),
	}));

	subscribeToInvalidations((store) => {
		if (store === storeName) data.refetch();
	});

	return data;
}
