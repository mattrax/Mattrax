// @ts-nocheck // TODO: Reenable checking
// IndexedDB Plus is an extension on the `idb` library that adds additional features.

import {
	type DBSchema,
	type IDBPDatabase,
	type IDBPObjectStore,
	type IDBPTransaction,
	type OpenDBCallbacks,
	openDB as internal_openDB,
} from "idb";

// TODO: Emit events properly, only after transaction completes

export type DbChange<DBTypes extends DBSchema | unknown = unknown> = {
	storeName: keyof DBTypes;
} & (
	| {
			type: "add" | "put" | "delete";
			key: IDBKeyRange | IDBValidKey | undefined; // TODO: Can this narrow correctly if `storeName` is explicitly checked by the user?
	  }
	| {
			type: "clear";
	  }
);

export type IDBPDatabaseExt<DBTypes extends DBSchema | unknown = unknown> =
	IDBPDatabase<DBTypes> & {
		idbp: ReturnType<typeof ext<DBTypes>>;
	};

const constructEvent = (change: DbChange<unknown>) =>
	new CustomEvent("#idbp#change", { detail: change });

const handlers: Partial<{
	[K in keyof IDBPDatabase<unknown>]: (
		db: IDBPDatabase<unknown>,
	) => IDBPDatabase<unknown>[K];
}> = {
	add: (db) => async (storeName, value, key) => {
		const result = await db.add(storeName, value, key);
		db.dispatchEvent(constructEvent({ storeName, type: "add", key }));
		return result;
	},
	put: (db) => async (storeName, value, key) => {
		// console.log("PUT", storeName, value, key); // TODO
		const result = await db.put(storeName, value, key);
		// console.log(db); // TODO: `db` can be `objectStore` -> Reflect in types or fix?
		db.dispatchEvent(constructEvent({ storeName, type: "put", key }));
		return result;
	},
	clear: (db) => async (name) => {
		const result = await db.clear(name);
		db.dispatchEvent(constructEvent({ storeName: name, type: "clear" }));
		return result;
	},
	delete: (db) => async (storeName, key) => {
		const result = await db.delete(storeName, key);
		db.dispatchEvent(constructEvent({ storeName, type: "delete", key }));
		return result;
	},
	// TODO:
	// count, countFromIndex, delete, get, getAll, getAllFromIndex
	// getFromIndex, getKey, getKeyFromIndex
};

function ext<DBTypes>(db: IDBPDatabase<DBTypes>) {
	return {
		subscribe: (callback: (changes: DbChange<DBTypes>) => void) => {
			const abort = new AbortController();
			db.addEventListener(
				"#idbp#change",
				(e) => {
					// console.log("Change", e); // TODO
					callback((e as CustomEvent).detail);
				},
				{ signal: abort.signal },
			);

			return () => abort.abort();
		},
	};
}

function wrapObjectStore<T>(db: IDBPDatabase<T>, store: IDBPObjectStore<T>) {
	return new Proxy(store, {
		get(target, p, receiver) {
			// We handle transaction specially cause it uses function overloading & to catch nested properties
			// if (prop === "transaction") return wrapTransaction(_db);

			// TODO: `iterate`, `openCursor`, `openKeyCursor`

			// TODO: `transaction`

			// Apply the interceptor
			// const handler = handlers2?.[p as keyof IDBPObjectStore<T>];
			// if (handler) return handler(db);

			// console.log()

			let v = Reflect.get(target, p, receiver);
			if (typeof v === "function") v = v.bind(store);

			// store.

			if (p === "put") {
				return async (value, k) => {
					const key = await target.put(value, k);
					db.dispatchEvent(
						constructEvent({ storeName: store.name, type: "put", key }),
					);
					return key;
				};
			}

			// TODO: The rest of methods

			return v;
		},
	});
}

function wrapTransaction<T>(db: IDBPDatabase<T>) {
	return (storeNames: string | string[], mode: unknown, options: unknown) => {
		// console.log("TX", storeNames, mode, options); // TODO
		const tx: IDBPTransaction<any, any, any> = (db.transaction as any)(
			storeNames,
			mode,
			options,
		);

		tx.addEventListener("complete", () => {
			// console.log("TX COMPLETE"); // TODO
		});

		tx.addEventListener("abort", () => {
			// console.log("TX ABORT"); // TODO
		});

		tx.addEventListener("error", () => {
			// console.log("TX ERROR"); // TODO
		});

		return new Proxy(tx, {
			// TODO: Delay the event emitting until the transaction is complete
			get(target, p, receiver) {
				if (p === "objectStore")
					return (name: string) => wrapObjectStore(db, tx.objectStore(name));

				const v = Reflect.get(target, p, receiver);

				if (p === "db") return wrapDb(v);
				if (p === "store") {
					if (!v) return v;
					return wrapObjectStore(db, v);
				}

				return v;
			},
		});
	};
}

function wrapDb<T>(_db: IDBPDatabase<T>) {
	const db = new Proxy(_db, {
		get(target, p, receiver) {
			// We handle transaction specially cause it uses function overloading & to catch nested properties
			if (p === "transaction") return wrapTransaction(_db);

			// Apply the interceptor
			const handler = handlers?.[p as keyof IDBPDatabase<T>];
			if (handler) return handler(target);

			// Passthrough
			let v = Reflect.get(target, p, receiver);
			if (typeof v === "function") v = v.bind(_db);
			return v;
		},
		set(target, prop, value, receiver) {
			return Reflect.set(target, prop, value, receiver);
		},
	});

	return Object.assign(db, {
		idbp: ext(db),
	});
}

/**
 * Open a database.
 *
 * @param name Name of the database.
 * @param version Schema version.
 * @param callbacks Additional callbacks.
 */
export function openDB<T extends DBSchema | unknown = unknown>(
	name: string,
	version?: number,
	options: OpenDBCallbacks<T> = {},
): Promise<IDBPDatabaseExt<T>> {
	// TODO: we could also just leave this to userspace????
	// TODO:  - We probs wanna wrap `IDBPDatabaseExt` onto the transactions

	return internal_openDB(name, version, options).then(wrapDb);
}
