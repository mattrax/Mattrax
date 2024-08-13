// @ts-nocheck // TODO: Reenable

import type {
	IDBPDatabase,
	IDBPIndex,
	IDBPObjectStore,
	IDBPTransaction,
} from "idb";
import type { Changes, Changes2 } from "./change";

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
			if (p === "transaction")
				return ((storeNames, mode, options) =>
					wrapTransaction(
						target.transaction(storeNames, mode, options),
						changes,
					)) satisfies IDBPDatabase["transaction"];

			return Reflect.get(target, p, receiver);
		},
	});
}

function wrapTransaction(
	tx: IDBPTransaction<unknown, any, any>,
	changes: Changes,
) {
	return new Proxy(tx, {
		get(target, p, receiver) {
			if (p === "store") return wrapObjectStore(tx.store, changes);
			if (p === "objectStore")
				return (storeNames: string) =>
					wrapObjectStore(tx.objectStore(storeNames), changes);
			if (p === "db") return apply(changes, tx.db);

			const v = Reflect.get(target, p, receiver);
			return typeof v === "function" ? v.bind(tx) : v;
		},
	});
}

function wrapObjectStore(store: IDBPObjectStore, changes: Changes) {
	return new Proxy(store, {
		get(target, p, receiver) {
			if (p === "transaction")
				return wrapTransaction(store.transaction, changes);
			if (p === "index")
				return ((name) =>
					wrapIndex(
						store.index(name),
						changes,
					)) satisfies IDBPObjectStore["index"];

			if (p === "add") return add(store.name, store.transaction.db, changes);
			if (p === "put") return put(store.name, store.transaction.db, changes);
			if (p === "clear")
				return clear(store.name, store.transaction.db, changes);
			if (p === "delete")
				return _delete(store.name, store.transaction.db, changes);

			const changes2 = {}; // TODO

			if (p === "count")
				return countBase(
					store.name,
					(key) => store.count(key),
					changes2,
				) satisfies IDBPObjectStore["count"];

			// if (p === "get") return get(db as IDBPDatabase, changes);
			if (p === "getAll")
				// return getAllBase(() => );
				return getAll(store.name, store.transaction.db, changes);
			if (p === "getAllKeys")
				return getAllKeys(store.name, store.transaction.db, changes);
			// if (p === "getKey") return getKey(db as IDBPDatabase, changes);

			if (p === "iterate") throw new Error("Not implemented");
			if (p === "openCursor") throw new Error("Not implemented");
			if (p === "openKeyCursor") throw new Error("Not implemented");

			const v = Reflect.get(target, p, receiver);
			return typeof v === "function" ? v.bind(store) : v;
		},
	});
}

function wrapIndex(idx: IDBPIndex, changes: Changes) {
	return new Proxy(idx, {
		get(target, p, receiver) {
			console.log("INDEX GET", p); // TODO

			// if (p === "count") {}
			// if (p === "get") {}
			// if (p === "getAll") {}
			// if (p === "getAllKeys") {}
			// if (p === "getKey") {}

			if (p === "iterate") throw new Error("Not implemented");
			if (p === "openCursor") throw new Error("Not implemented");
			if (p === "openKeyCursor") throw new Error("Not implemented");

			const v = Reflect.get(target, p, receiver);
			return typeof v === "function" ? v.bind(idx) : v;
		},
	});
}

function add(
	storeName: string,
	db: IDBPDatabase,
	changes: Changes,
): IDBPObjectStore<unknown, [], "", "readwrite">["add"] {
	return async (value, key) => {
		// TODO
		return await db.add(storeName, value, key);
	};
}

function put(
	storeName: string,
	db: IDBPDatabase,
	changes: Changes,
): IDBPObjectStore<unknown, [], "", "readwrite">["put"] {
	return async (value, key) => {
		// TODO
		return await db.put(storeName, value, key);
	};
}

function clear(
	storeName: string,
	db: IDBPDatabase,
	changes: Changes,
): IDBPObjectStore<unknown, [], "", "readwrite">["clear"] {
	return async () => {
		// TODO
		return await db.clear(storeName);
	};
}

function _delete(
	storeName: string,
	db: IDBPDatabase,
	changes: Changes,
): IDBPObjectStore<unknown, [], "", "readwrite">["delete"] {
	return async (key) => {
		// TODO
		return await db.delete(storeName, key);
	};
}

function getAll(
	storeName: string,
	db: IDBPDatabase,
	changes: Changes,
): IDBPObjectStore["getAll"] {
	return async (query, count) => {
		const q =
			query === undefined || query === null || query instanceof IDBKeyRange
				? query
				: IDBKeyRange.only(query);

		// console.log("getAll", storeName, query, count);

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

				if (
					query &&
					query instanceof IDBKeyRange &&
					!query.includes(change.key)
				)
					continue;

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

				// We spliced in a new item, so we need to remove the last item to maintain the count
				if (count && result.length > count) {
					result.pop();
				}
			}
		}

		return result;
	};
}

function getAllKeys(
	storeName: string,
	db: IDBPDatabase,
	changes: Changes,
): IDBPObjectStore["getAllKeys"] {
	return async (query, count) => {
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

function countBase(
	storeName: string,
	data: (key?: IDBValidKey | IDBKeyRange | null) => Promise<number>,
	changes: Changes2,
) {
	return async (key?: IDBValidKey | IDBKeyRange | null) => {
		// TODO: Accounting for indexes

		// changes[storeName].put

		// TODO
		return await data(key);
	};
}

function getBase<T>(data: () => Promise<T>, changes: Changes2) {
	return async (query?: IDBValidKey | IDBKeyRange | null, count?: number) => {
		// TODO
	};
}

function getAllBase<T>(data: () => Promise<T>, changes: Changes2) {
	return async (query?: IDBValidKey | IDBKeyRange | null, count?: number) => {
		const q =
			query === undefined || query === null || query instanceof IDBKeyRange
				? query
				: IDBKeyRange.only(query);

		// for (const change of changes.get(storeName) ?? []) {
		// 	// TODO
		// }

		// // console.log("getAll", storeName, query, count);
		// // TODO: Using `IDBKeyRange.only` -> https://github.com/dumbmatter/fakeIndexedDB/blob/ab0bc47143f7bd87351e05cb43f7634c088dfb12/src/lib/valueToKeyRange.ts#L6
		// // We know the result is for a single key, so we can shortcut the DB if it's in memory
		// if (query && !(query instanceof IDBKeyRange)) {
		// 	// TODO: Really we want changes in O(1) lookups so...
		// 	for (const change of changes.get(storeName) ?? []) {
		// 		if (change.type === "put" && indexedDB.cmp(query, change.key) === 0) {
		// 			return [change.value];
		// 		}
		// 		// TODO: Shortcut if `IDBKeyRange` doesn't include `change.key` (we can just rely on IndexedDB???)
		// 	}
		// 	return await db.getAll(storeName, query, count);
		// }
		// const tx = db.transaction(storeName, "readonly");
		// const result = await tx.store.getAll(query, count);
		// let keys: IDBValidKey[] | undefined = undefined;
		// // console.log("START", result);
		// for (const change of changes.get(storeName) ?? []) {
		// 	if (change.type === "put") {
		// 		// We lazy-load the keys cause they might not be required
		// 		if (!keys) keys = await tx.store.getAllKeys(query, count);
		// 		if (
		// 			query &&
		// 			query instanceof IDBKeyRange &&
		// 			!query.includes(change.key)
		// 		)
		// 			continue;
		// 		// get the index we need to insert the item at
		// 		let min = 0;
		// 		let max = result.length;
		// 		let index = Math.floor((min + max) / 2);
		// 		while (max > min) {
		// 			if (indexedDB.cmp(change.key, keys[index]) < 0) {
		// 				max = index;
		// 			} else {
		// 				min = index + 1;
		// 			}
		// 			index = Math.floor((min + max) / 2);
		// 		}
		// 		result.splice(index, 0, change.value);
		// 		// We spliced in a new item, so we need to remove the last item to maintain the count
		// 		if (count && result.length > count) {
		// 			result.pop();
		// 		}
		// 	}
		// }
		// return result;
	};
}
