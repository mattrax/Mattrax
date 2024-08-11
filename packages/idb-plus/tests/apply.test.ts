import { expect, test } from "vitest";
import "fake-indexeddb/auto";
import { openDB } from "idb";
import { apply } from "../src/apply";

const initDb = async () => {
	const db = await openDB("test", 1, {
		upgrade(db) {
			db.createObjectStore("kv");
		},
	});

	db.put("kv", "5", "a");
	db.put("kv", "4", "b");
	db.put("kv", "2", "d");
	db.put("kv", "1", "e");

	return db;
};

test("db.getAll() & db.getAllKeys()", async () => {
	const changes = new Map();
	changes.set("kv", [
		{
			type: "put",
			key: "c",
			value: "3",
		},
	]);

	const db = apply(changes, await initDb());

	// No constrains
	expect(await db.getAll("kv")).toStrictEqual(["5", "4", "3", "2", "1"]);
	expect(await db.getAllKeys("kv")).toStrictEqual(["a", "b", "c", "d", "e"]);

	// `null` range
	expect(await db.getAll("kv", null)).toStrictEqual(["5", "4", "3", "2", "1"]);
	expect(await db.getAllKeys("kv", null)).toStrictEqual([
		"a",
		"b",
		"c",
		"d",
		"e",
	]);

	// `IDBValidKey` constraint
	expect(await db.getAll("kv", "a")).toStrictEqual(["5"]);
	// expect(await db.getAllKeys("kv", "a")).toStrictEqual(["a"]);

	expect(await db.getAll("kv", "c")).toStrictEqual(["3"]);
	// expect(await db.getAllKeys("kv", "c")).toStrictEqual(["c"]);

	// `IDBKeyRange` constraint
	expect(await db.getAll("kv", IDBKeyRange.bound("a", "b"))).toStrictEqual([
		"5",
		"4",
	]);
	// expect(await db.getAllKeys("kv", IDBKeyRange.bound("a", "b"))).toStrictEqual(["a", "b"]);

	expect(await db.getAll("kv", IDBKeyRange.bound("a", "c"))).toStrictEqual([
		"5",
		"4",
		"3",
	]);
	expect(await db.getAllKeys("kv", IDBKeyRange.bound("a", "c"))).toStrictEqual([
		"a",
		"b",
		"c",
	]);
	// We internally use `IDBKeyRange.includes` so we aren't gonna test all possible configurations

	// Using `count` field
	expect(await db.getAll("kv", null, 2)).toStrictEqual(["5", "4"]);
	// expect(await db.getAllKeys("kv", null, 2)).toStrictEqual(["a", "b"]);

	expect(await db.getAll("kv", null, 3)).toStrictEqual(["5", "4", "3"]);
	// expect(await db.getAllKeys("kv", null, 3)).toStrictEqual(["a", "b", "c"]);

	// TODO: Using `count` field

	// Combinations
	// expect(await db.getAll("kv", "b", 3)).toStrictEqual(["4", "3", "2"]);
	// expect(await db.getAllKeys("kv", "b", 3)).toStrictEqual(["b", "c", "d"]);
});

// TODO: What if multiple changes for the same store exist, which one wins?
// TODO:  - Can we remove writes where deletes overlap??

// TODO: Account for non-unique indexes
