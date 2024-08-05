import { makeEventListener } from "@solid-primitives/event-listener";
import { createDeepSignal } from "@solid-primitives/resource";
import type { IDBPDatabase } from "idb";
import {
	type Resource,
	type ResourceActions,
	createResource,
	onCleanup,
} from "solid-js";
import type { Database } from "./db";
import { useSync } from "./sync";

const syncBroadcastChannel = new BroadcastChannel("sync");

// Create an observer for the database, using the IndexedDB Observers polyfill.
function createDbObserver(
	db: IDBPDatabase<Database>,
	onChange: (objectStore: string) => void,
) {
	const stores = [...db.objectStoreNames];
	if (stores.length === 0) return;

	// @ts-expect-error // TODO: Typescript support for IndexedDB Observers polyfill
	const observer = db.observe(
		// This subscribes to all object stores.
		// This is going to be less efficient but it's the easiest way to get the better DX now without proxies or monkey patching.
		// If we want something more efficient we need to track the object stores used in the `query` fn. Maybe could do with transaction but that's got it's own problems (auto-commit).
		[...db.objectStoreNames],
		(changes: any, metadata: any) => {
			if (!changes || changes.length === 0) return;
			onChange(metadata.objectStoreName);
		},
	);
	if (!observer) console.error("Error registering observer!");
	onCleanup(() => {
		if (observer) observer.stop();
	});
}

// create a query that will automatically rerun when the database changes
//
// Ensure you keep expensive operations out of the query function and use memo's instead.
// The query is reconciled into a store to ensure downstream dependencies are only trigger when required.
export function createDbQuery<T>(
	query: (db: IDBPDatabase<Database>) => Promise<T> | T,
	options: { initialValue?: T } = {},
) {
	const sync = useSync();
	const [data, actions] = createResource(async () => await query(sync.db), {
		storage: createDeepSignal,
		initialValue: options.initialValue,
	});

	createDbObserver(sync.db, actions.refetch);
	createCrossTabObserver((dbName, objectStore) => {
		if (sync.db.name !== dbName) return;
		// TODO: Filtering by `objectStore`
		actions.refetch();
	});

	return Object.assign(
		// Run-once async
		() => data.latest || data(),
		// Neater to put it all together
		{
			refetch: actions.refetch,
			mutate: actions.mutate,
		},
	) as Resource<T> & ResourceActions<T>;
}

// Creates a listener that lets other tabs know when the database has been updated.
export const createCrossTabListener = (db: IDBPDatabase<Database>) =>
	createDbObserver(db, (objectStore) =>
		syncBroadcastChannel.postMessage(JSON.stringify([db.name, objectStore])),
	);

const createCrossTabObserver = (
	callback: (dbName: string, objectStore: string) => void,
) =>
	makeEventListener(syncBroadcastChannel, "message", (event) => {
		if (event.origin !== window.origin) return;
		const [dbName, objectStore] = JSON.parse(event.data);
		callback(dbName, objectStore);
	});

// You should not need to use this.
// This exists because the `/` landing page wants to detect when the user logins in, within another tab.
// However it can't use the regular sync engine as it's not within a database context.
export const listenForKvChanges = (callback: () => void) =>
	createCrossTabObserver((_, objectStore) => {
		if (objectStore === "_kv") callback();
	});
