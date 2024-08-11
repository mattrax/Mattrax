import { type Database, openAndInitDb } from "./db";

const databases: Record<string, Database> = {};

// We are caching the database outside of the Solid lifecycle.
// This should help with hot-reload's in development but mainly exists to stop the browser locking up.
// IndexedDB seems to hang on the open call and fully lock up the tab indefinitely when opening connections without this.
// I was previously closing DB's on Solid's `onCleanup` hook so i'm honestly not sure why this was.
export async function getDbCached(name: string): Promise<Database> {
	if (databases[name]) return databases[name];
	const db = await openAndInitDb(name);
	databases[name] = db;
	return db;
}
