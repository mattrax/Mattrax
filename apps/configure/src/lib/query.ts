import { makeEventListener } from "@solid-primitives/event-listener";
import { createDeepSignal } from "@solid-primitives/resource";
import type { IDBPDatabase } from "idb";
import {
	type Resource,
	type ResourceActions,
	createResource,
	onCleanup,
} from "solid-js";
import { type Database, db } from "./db";

const syncBroadcastChannel = new BroadcastChannel("sync");

// Create an observer for the database, using the IndexedDB Observers polyfill.
function createDbObserver(onChange: () => void) {
	let observer: any = undefined;
	db.then((db) => {
		if (observer === false) return;
		// This subscribes to all object stores.
		// This is going to be less efficient but it's the easiest way to get the better DX now without proxies or monkey patching.
		// If we want something more efficient we need to track the object stores used in the `query` fn. Maybe could do with transaction but that's got it's own problems (auto-commit).

		// @ts-expect-error // TODO: Typescript support for IndexedDB Observers polyfill
		observer = db.observe([...db.objectStoreNames], (changes, metadata) => {
			if (!changes || changes.length === 0) return;
			onChange();
		});
	});

	// biome-ignore lint/suspicious/noAssignInExpressions:
	onCleanup(() => (observer ? observer.stop() : (observer = false)));
}

// create a query that will automatically rerun when the database changes
//
// Ensure you keep expensive operations out of the query function and use memo's instead.
// The query is reconciled into a store to ensure downstream dependencies are only trigger when required.
export function createDbQuery<T>(
	query: (db: IDBPDatabase<Database>) => Promise<T> | T,
) {
	const [data, actions] = createResource(async () => await query(await db), {
		storage: createDeepSignal,
	});

	createDbObserver(actions.refetch);
	makeEventListener(syncBroadcastChannel, "message", (event) => {
		if (event.origin !== window.origin) return;
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
export const createCrossTabListener = () =>
	createDbObserver(() => syncBroadcastChannel.postMessage("invalidate"));
