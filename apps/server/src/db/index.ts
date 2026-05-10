import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

export type DbClient = ReturnType<typeof createDb>;

export const createDb = (path: string) => {
  const sqlite = new Database(path);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS scep_ca (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cert_pem TEXT NOT NULL,
      private_key_jwk TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  return drizzle(sqlite, { schema });
};
