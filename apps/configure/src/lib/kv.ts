import type { User } from "./auth";
import type { Database } from "./db";
import type { Org } from "./sync/schema";

export type KvValue = {
	user: User;
	org: Org;
	accessToken: string;
	refreshToken: string;
	configurationSettings: string;
	configurationCategories: string;
};

export async function getKey<K extends keyof KvValue | undefined = undefined>(
	db: Database,
	key?: K,
): Promise<(K extends keyof KvValue ? KvValue[K] : KvValue) | undefined> {
	return key ? await db.get("_kv", key) : await db.getAll("_kv");
}

export async function putKey<K extends keyof KvValue>(
	db: Database,
	key: K,
	value: KvValue[K],
): Promise<void> {
	await db.put("_kv", value, key);
}

export async function deleteKey<K extends keyof KvValue>(
	db: Database,
	key: K,
): Promise<void> {
	await db.delete("_kv", key);
}
