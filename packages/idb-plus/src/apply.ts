import type { IDBPDatabase } from "idb";
import type { Changes } from "./change";

/**
 * Apply a set of changes to the result of database operations without them being committed to the database.
 *
 */
export function apply<T>(
	changes: Changes,
	db: IDBPDatabase<T>,
): IDBPDatabase<T> {
	return new Proxy(db, {
		get(target, p, receiver) {
			// if (p === "add") return add(db as IDBPDatabase, changes);
			// if (p === "count") return count(db as IDBPDatabase, changes);
			// if (p === "countFromIndex") return countFromIndex(db as IDBPDatabase, changes);
			// if (p === "delete") return delete(db as IDBPDatabase, changes);
			if (p === "getAll") return getAll(db as IDBPDatabase, changes);
			if (p === "getAllKeys") return getAllKeys(db as IDBPDatabase, changes);
			// if (p === "getAllFromIndex") return getAllFromIndex(db as IDBPDatabase, changes);
			// if (p === "getAllKeysFromIndex") return getAllKeysFromIndex(db as IDBPDatabase, changes);
			// if (p === "getFromIndex") return getFromIndex(db as IDBPDatabase, changes);
			// if (p === "getKey") return getKey(db as IDBPDatabase, changes);
			// if (p === "getKeyFromIndex") return getKey(db as IDBPDatabase, changes);

			// TODO: Wrap transactions `.db` & `.objectStore`/`.store`

			const v = Reflect.get(target, p, receiver);
			return typeof v === "function" ? v.bind(db) : v;
		},
	});
}

function getAll(db: IDBPDatabase, changes: Changes): IDBPDatabase["getAll"] {
	return async (storeName, query, count) => {
		// TODO: Using `IDBKeyRange.only` -> https://github.com/dumbmatter/fakeIndexedDB/blob/ab0bc47143f7bd87351e05cb43f7634c088dfb12/src/lib/valueToKeyRange.ts#L6

		// We know the result is for a single key, so we can shortcut the DB if it's in memory
		if (query && !(query instanceof IDBKeyRange)) {
			// TODO: Really we want changes in O(1) lookups so...
			for (const change of changes.get(storeName) ?? []) {
				if (change.type === "put" && indexedDB.cmp(query, change.key) === 0) {
					return [change.value];
				}

				// TODO: Shortcut if `IDBKeyRange` doesn't include `change.key` (we can just rely on IndexedDB???)
			}

			return await db.getAll(storeName, query, count);
		}

		const tx = db.transaction(storeName, "readonly");
		const result = await tx.store.getAll(query, count);
		let keys: IDBValidKey[] | undefined = undefined;

		// console.log("START", result);

		for (const change of changes.get(storeName) ?? []) {
			if (change.type === "put") {
				// We lazy-load the keys cause they might not be required
				if (!keys) keys = await tx.store.getAllKeys(query, count);

				// TODO: Does this cause issues with `count`?
				if (
					query &&
					query instanceof IDBKeyRange &&
					!query.includes(change.key)
				)
					continue;

				if (count) {
					// TODO
				}

				// console.log("SLICE in", change.value);

				// get the index we need to insert the item at
				let min = 0;
				let max = result.length;
				let index = Math.floor((min + max) / 2);
				while (max > min) {
					if (indexedDB.cmp(change.key, keys[index]) < 0) {
						max = index;
					} else {
						min = index + 1;
					}
					index = Math.floor((min + max) / 2);
				}

				result.splice(index, 0, change.value);
			}
		}

		return result;
	};
}

function getAllKeys(
	db: IDBPDatabase,
	changes: Changes,
): IDBPDatabase["getAllKeys"] {
	return async (storeName, query, count) => {
		const tx = db.transaction(storeName, "readonly");
		const result = await tx.store.getAllKeys(query, count);

		for (const change of changes.get(storeName) ?? []) {
			if (change.type === "put") {
				let min = 0;
				let max = result.length;
				let index = Math.floor((min + max) / 2);
				while (max > min) {
					if (indexedDB.cmp(change.key, result[index]) < 0) {
						max = index;
					} else {
						min = index + 1;
					}
					index = Math.floor((min + max) / 2);
				}

				result.splice(index, 0, change.key);
			}
		}

		return result;
	};
}
