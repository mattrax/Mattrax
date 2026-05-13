import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

export const createDb = (hyperdrive: Hyperdrive): any => drizzle({
  client: new Pool({ connectionString: hyperdrive.connectionString }),
  schema,
});
