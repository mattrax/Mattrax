import { Client } from "@planetscale/database";
import { drizzle } from "drizzle-orm/planetscale-serverless";

import { getEnv } from "../env";

export * from "./schema";
import * as schema from "./schema";

export const getDb = () =>
	drizzle(
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
