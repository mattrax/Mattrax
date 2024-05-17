import { drizzle } from "drizzle-orm/planetscale-serverless";
import { Client, type Config } from "@planetscale/database";
import { env } from "../env";

export * from "./schema";
import * as schema from "./schema";

let fetchHandler: Config["fetch"] = undefined;

const client = new Client({
	url: env.PLANETSCALE_URL,
	fetch: async (input, init) => {
		if (import.meta.env.MODE === "development") {
			if (env.PLANETSCALE_URL.startsWith("mysql://")) {
				if (!fetchHandler)
					fetchHandler = (
						await import("@mattrax/mysql-planetscale")
					).createFetchHandler(env.PLANETSCALE_URL);
			}
		}

		// Cloudflare Workers doesn't support like the `cache` property
		// biome-ignore lint/performance/noDelete:
		delete init?.cache;
		return await (fetchHandler || fetch)(input, init);
	},
});

export const db = drizzle(client, { schema, logger: false });
