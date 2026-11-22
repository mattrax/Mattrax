import { Context, Layer } from "effect";
import type { Effect } from "effect";
import * as MysqlDrizzle from "drizzle-orm/effect-mysql2";

const dbEffect = MysqlDrizzle.makeWithDefaults();

/** Drizzle handle for the isolated `services_` schema. */
export type ServicesDb = Effect.Success<typeof dbEffect>;

export class Db extends Context.Service<Db, ServicesDb>()("mattrax/ServicesDb") {
  static readonly layer = Layer.effect(Db, dbEffect);
}
