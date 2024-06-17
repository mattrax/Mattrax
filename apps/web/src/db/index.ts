import { Client, type Config } from "@planetscale/database";
import { drizzle } from "drizzle-orm/planetscale-serverless";
import { withEnv } from "../env";

export * from "./schema";
import * as schema from "./schema";

let fetchHandler: Config["fetch"] = undefined;

export const db = withEnv((env) => {
	const client = new Client({
		url: env.DATABASE_URL,
		fetch: async (input, init) => {
			if (import.meta.env.MODE === "development") {
				if (env.DATABASE_URL.startsWith("mysql://")) {
					if (!fetchHandler)
						fetchHandler = (
							await import("@mattrax/mysql-planetscale")
						).createFetchHandler(env.DATABASE_URL);
				}
			}

			// Cloudflare Workers doesn't support like the `cache` property
			// biome-ignore lint/performance/noDelete:
			delete init?.cache;
			return await (fetchHandler || fetch)(input, init);
		},
	});

	return drizzle(client, { schema, logger: false });
});
