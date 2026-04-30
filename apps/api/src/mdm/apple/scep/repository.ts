import { Context, Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import type { Database } from "../../../db";
import * as dbSchema from "../../../db/schema";
import { ScepError } from "../schema";

export class ScepRepository extends Context.Service<
  ScepRepository,
  {
    readonly getCa: () => Effect.Effect<{ certPem: string; privateKeyJwk: JsonWebKey } | null, ScepError>;
    readonly saveCa: (certPem: string, privateKeyJwk: JsonWebKey) => Effect.Effect<void, ScepError>;
  }
>()("ScepRepository") {}

export const ScepRepositoryLive = (db: Database) =>
  Layer.succeed(ScepRepository)(
    ScepRepository.of({
      getCa: () =>
        Effect.tryPromise({
          try: async () => {
            const row = await db.query.scepCa.findFirst({
              where: eq(dbSchema.scepCa.id, 1),
            });
            if (!row) return null;
            return {
              certPem: row.certPem,
              privateKeyJwk: row.privateKeyJwk as JsonWebKey,
            };
          },
          catch: (cause) => new ScepError({ message: "Failed to get CA", cause }),
        }),
      saveCa: (certPem, privateKeyJwk) =>
        Effect.tryPromise({
          try: async () => {
            await db.insert(dbSchema.scepCa).values({
              id: 1,
              certPem,
              privateKeyJwk,
              createdAt: new Date(),
            }).onConflictDoUpdate({
              target: dbSchema.scepCa.id,
              set: { certPem, privateKeyJwk },
            });
          },
          catch: (cause) => new ScepError({ message: "Failed to save CA", cause }),
        }),
    }),
  );
