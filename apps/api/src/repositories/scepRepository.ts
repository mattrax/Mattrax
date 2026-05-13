import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import type { DatabaseClient } from "../db/index.js";
import * as dbSchema from "../db/schema.js";
import { ScepError, ScepRepository } from "@mattrax/scep";

export const ScepRepositoryLive = (db: DatabaseClient) =>
  Layer.succeed(ScepRepository)(
    ScepRepository.of({
      getCa: () =>
        (Effect.gen(function* () {
          const row = yield* db.query.scepCa.findFirst({
              where: eq(dbSchema.scepCa.id, 1),
            });
          if (!row) return null;
          return {
            certPem: row.certPem,
            privateKeyJwk: row.privateKeyJwk as JsonWebKey,
          };
        }).pipe(Effect.mapError((cause) => new ScepError({ message: "Failed to get CA", cause }))) as Effect.Effect<{ certPem: string; privateKeyJwk: JsonWebKey } | null, ScepError>),
      saveCa: (certPem, privateKeyJwk) =>
        (Effect.gen(function* () {
          yield* db.insert(dbSchema.scepCa).values({
              id: 1,
              certPem,
              privateKeyJwk,
              createdAt: new Date(),
            }).onConflictDoUpdate({
              target: dbSchema.scepCa.id,
              set: { certPem, privateKeyJwk },
            });
        }).pipe(Effect.mapError((cause) => new ScepError({ message: "Failed to save CA", cause }))) as Effect.Effect<void, ScepError>),
      authenticatePkcsReq: () => Effect.void,
    }),
  );
