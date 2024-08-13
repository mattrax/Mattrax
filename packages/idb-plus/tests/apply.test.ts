import { expect, test } from "vitest";
import "fake-indexeddb/auto";
import { openDB } from "idb";
import { apply } from "../src/apply";

const initDb = async () => {
	const db = await openDB("test", 1, {
		upgrade(db) {
			db.createObjectStore("kv");

			const indexed = db.createObjectStore("indexed");
			indexed.createIndex("name", "name");
			indexed.createIndex("test", "test");
			indexed.createIndex("test2", "test2");
		},
	});

	db.put("kv", "5", "a");
	db.put("kv", "4", "b");
	db.put("kv", "2", "d");
	db.put("kv", "1", "e");

	db.put("indexed", { name: "5", test: "a", test2: "a" }, "a");
	db.put("indexed", { name: "4", test: "a", test2: "a" }, "b");
	db.put("indexed", { name: "2", test: "a", test2: "b" }, "d");
	db.put("indexed", { name: "1", test: "a", test2: "b" }, "e");

	return db;
};

const defaultChanges = () => {
	const changes = new Map();
	changes.set("kv", [
		{
			type: "put",
			key: "c",
			value: "3",
		},
	]);
	changes.set("indexed", [
		{
			type: "put",
			key: "c",
			value: { name: "3", test: "a", test2: "a" },
		},
	]);
	return changes;
};

test("proxy coverage", async () => {
	const db = apply(defaultChanges(), await initDb());
	const expected = ["5", "4", "3", "2", "1"];

	expect(await db.getAll("kv")).toStrictEqual(expected);

	// We avoid awaiting until all operations are queued to prevent browser auto-committing
	const tx = db.transaction("kv", "readonly");
	const a = tx.store.getAll();
	const b = tx.objectStore("kv").getAll();
	const c = tx.db.getAll("kv");
	const d = tx.objectStore("kv").transaction.db.getAll("kv");

	expect(await a).toStrictEqual(expected);
	expect(await b).toStrictEqual(expected);
	expect(await c).toStrictEqual(expected);
	expect(await d).toStrictEqual(expected);
});

test("db.getAll() & db.getAllKeys()", async () => {
	const db = apply(defaultChanges(), await initDb());

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
	expect(await db.getAllKeys("kv", "a")).toStrictEqual(["a"]);

	expect(await db.getAll("kv", "c")).toStrictEqual(["3"]);
	expect(await db.getAllKeys("kv", "c")).toStrictEqual(["c"]);

	// `IDBKeyRange` constraint
	expect(await db.getAll("kv", IDBKeyRange.bound("a", "b"))).toStrictEqual([
		"5",
		"4",
	]);
	expect(await db.getAllKeys("kv", IDBKeyRange.bound("a", "b"))).toStrictEqual([
		"a",
		"b",
	]);

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
	expect(await db.getAllKeys("kv", null, 2)).toStrictEqual(["a", "b"]);

	expect(await db.getAll("kv", null, 3)).toStrictEqual(["5", "4", "3"]);
	expect(await db.getAllKeys("kv", null, 3)).toStrictEqual(["a", "b", "c"]);

	// Combinations
	expect(await db.getAll("kv", IDBKeyRange.bound("b", "d"), 2)).toStrictEqual([
		"4",
		"3",
	]);
	expect(
		await db.getAllKeys("kv", IDBKeyRange.bound("b", "d"), 2),
	).toStrictEqual(["b", "c"]);

	// TODO: `getAll` from indexes (non-unique, or unique)
});

test("db.count()", async () => {
	const db = apply(defaultChanges(), await initDb());

	expect(await db.count("kv")).toBe(5);
	expect(await db.countFromIndex("kv", "name")).toBe(5);

	expect(await db.countFromIndex("kv", "test")).toBe(1);
	// expect(await db.countFromIndex("kv", "name")).toBe(2);

	// TODO: using key ranges
});

test("db.get()", async () => {
	// TODO
});

test("db.put()", async () => {
	// TODO
});

test("db.add()", async () => {
	// TODO
});

test("db.delete()", async () => {
	// TODO
});

// TODO: What if multiple changes for the same store exist, which one wins?
// TODO:  - Can we remove writes where deletes overlap??
