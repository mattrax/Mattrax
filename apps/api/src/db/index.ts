import { drizzle } from "drizzle-orm/node-postgres";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Redacted } from "effect";
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

export const createEffectDbLayer = (hyperdrive: Hyperdrive) => {
  const PgClientLive = PgClient.layer({
    url: Redacted.make(hyperdrive.connectionString),
  });

  const dbEffect = PgDrizzle.make({ schema: schema.dbSchema }).pipe(
    Effect.provide(PgDrizzle.DefaultServices),
  );

  return Layer.provideMerge(Layer.effect("EnterpriseDb" as any, dbEffect as any), PgClientLive);
};
