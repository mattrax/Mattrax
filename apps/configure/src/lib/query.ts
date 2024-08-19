import { makeEventListener } from "@solid-primitives/event-listener";
import { createDeepSignal } from "@solid-primitives/resource";
import { createResource, onCleanup, startTransition } from "solid-js";
import type { Database } from "./db";
import { useSync } from "./sync";

const syncBroadcastChannel = new BroadcastChannel("sync");

// Create an observer for the database, using the IndexedDB Observers polyfill.
function createDbObserver(
	db: Database,
	onChange: (objectStore: string) => void,
) {
	const stores = [...db.objectStoreNames];
	if (stores.length === 0) return;

	// TODO: Batching updates (30ms or so maybe) so SolidJS is under less stress

	// This subscribes to all object stores.
	// This is going to be less efficient but it's the easiest way to get the better DX now cause to filter we need autotracking.
	// If we want something more efficient we need to track the object stores used in the `query` fn. Maybe could do with transaction but that's got it's own problems (auto-commit).
	const cleanup = db.idbp.subscribe((e) => onChange(e.storeName as string));
	onCleanup(() => cleanup());
}

// create a query that will automatically rerun when the database changes
//
// Ensure you keep expensive operations out of the query function and use memo's instead.
// The query is reconciled into a store to ensure downstream dependencies are only trigger when required.
export function createDbQuery<T>(
	query: (db: Database) => Promise<T> | T,
	options: { initialValue?: T } = {},
) {
	const sync = useSync();
	const [data, actions] = createResource<T>(() => query(sync.db), {
		storage: createDeepSignal,
		initialValue: options.initialValue,
	});

	let queue: number | undefined;
	const refetch = () => {
		if (queue) return;
		queue = setTimeout(() => {
			queue = undefined;
			startTransition(() => actions.refetch());
		}, 30);
	};
	onCleanup(() => clearTimeout(queue));

	createDbObserver(sync.db, refetch);
	createCrossTabObserver((dbName, objectStore) => {
		if (sync.db.name !== dbName) return;
		// TODO: Filtering by `objectStore`
		refetch();
	});

	return Object.assign(data, {
		refetch: actions.refetch,
		mutate: actions.mutate,
	});
}

// Creates a listener that lets other tabs know when the database has been updated.
export const createCrossTabListener = (db: Database) =>
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
