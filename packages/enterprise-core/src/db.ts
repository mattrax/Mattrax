import { Context, Effect, Layer } from "effect";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { relations } from "./schema.ts";

const dbEffect = PgDrizzle.make({ relations }).pipe(Effect.provide(PgDrizzle.DefaultServices));

export type EnterpriseDb = Effect.Success<typeof dbEffect>;

export class Db extends Context.Service<Db, EnterpriseDb>()("Db") {
  static readonly layer = Layer.effect(Db, dbEffect);
}
