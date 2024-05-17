import { Client } from "@planetscale/database";
import { drizzle } from "drizzle-orm/planetscale-serverless";

import { env } from "../env";

export * from "./schema";
import * as schema from "./schema";

const client = new Client({
  url: env.PLANETSCALE_URL,
  // Cloudflare Worker's doesn't like `cache`
  fetch: (url, init) => {
    (init as any).cache = undefined;
    return fetch(url, init);
  },
});

export const db = drizzle(client, { schema, logger: false });
