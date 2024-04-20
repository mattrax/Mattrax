import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export * from "./schema";
import * as schema from "./schema";
import { env } from "../env";
import { localsCache } from "~/lib/utils";

export const getDb = localsCache(() => {
  const client = postgres(env.DATABASE_URL, { prepare: false });
  return drizzle(client, { schema, logger: false });
}, Symbol("db"));

export type Db = ReturnType<typeof getDb>;
