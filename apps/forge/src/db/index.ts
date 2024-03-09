import { Client } from "@planetscale/database";
import { drizzle } from "drizzle-orm/planetscale-serverless";

import { getEnv } from "../env";

export * from "./schema";
import * as schema from "./schema";

function newDb() {
	return drizzle(
		new Client({
			url: getEnv().DATABASE_URL,
			// Cloudflare Worker's doesn't like `cache`
			fetch: (url, init) => {
				(init as any).cache = undefined;
				return fetch(url, init);
			},
		}),
		{ schema, logger: false },
	);
}

let cached: null | ReturnType<typeof newDb> = null;

export const db = () => {
	if (cached) return cached;

	return (cached = newDb());
};
