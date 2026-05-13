import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

export const createDb = (hyperdrive: Hyperdrive): any => {
  const db = drizzle({
    client: new Pool({ connectionString: hyperdrive.connectionString }),
    schema: schema.dbSchema,
  });
  db.query = db._query;
  return db;
};
