import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import type { Database } from "../db/index.js";
import * as dbSchema from "../db/schema.js";
import { ScepError, ScepRepository } from "@mattrax/scep";

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
      authenticatePkcsReq: () => Effect.void,
    }),
  );
