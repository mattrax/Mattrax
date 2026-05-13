import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer, Redacted } from "effect";
import * as schema from "./schema";

export type DatabaseClient = PgDrizzle.EffectPgDatabase<any> & {
  readonly query: any;
  readonly select: (...args: Array<any>) => any;
  readonly insert: (table: any) => any;
  readonly update: (table: any) => any;
  readonly delete: (table: any) => any;
};

export class Database extends Context.Service<Database, DatabaseClient>()("Database") {}

export const createEffectDbLayer = (hyperdrive: Hyperdrive) => {
  const PgClientLive = PgClient.layer({
    url: Redacted.make(hyperdrive.connectionString),
  });

  const dbEffect = PgDrizzle.make({ schema: schema.dbSchema }).pipe(
    Effect.map((db) => db as DatabaseClient),
    Effect.provide(PgDrizzle.DefaultServices),
  );

  return Layer.effect(Database, dbEffect).pipe(
    Layer.provide(PgClientLive),
  );
};
