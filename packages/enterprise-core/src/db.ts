import type { Effect } from "effect";
import { Context, Layer } from "effect";
import * as MysqlDrizzle from "drizzle-orm/effect-mysql2";
import { relations } from "./schema.ts";

const dbEffect = MysqlDrizzle.makeWithDefaults({ relations });

export type EnterpriseDb = Effect.Success<typeof dbEffect>;

export class Db extends Context.Service<Db, EnterpriseDb>()("Db") {
  static readonly layer = Layer.effect(Db, dbEffect);
}
