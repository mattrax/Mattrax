import { Context, Effect, Layer }  from "effect";
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { relations } from "./schema.ts";

const dbEffect = PgDrizzle.make({ relations }).pipe(
  Effect.provide(PgDrizzle.DefaultServices)
);

export class Db extends Context.Service<Db, Effect.Success<typeof dbEffect>>()("Db") {
  static readonly layer = Layer.effect(Db, dbEffect);
}
