import { drizzle } from "drizzle-orm/planetscale-serverless";
import { connect } from "@planetscale/database";

import { env } from "../env";

export * from "./schema";
import * as schema from "./schema";

const connection = connect({
  url: env.DATABASE_URL,
  // Cloudflare Worker's doesn't like `cache`
  fetch: (url, init) => {
    delete (init as any)["cache"];
    return fetch(url, init);
  },
});

export const db = drizzle(connection, { schema });
