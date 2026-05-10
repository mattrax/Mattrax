import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import type { DbClient } from "../db/index.ts";
import * as dbSchema from "../db/schema.ts";
import { ScepError, ScepRepository } from "@mattrax/scep";

export const ScepRepositoryLive = (db: DbClient) =>
  Layer.succeed(ScepRepository)(
    ScepRepository.of({
      getCa: () =>
        Effect.try({
          try: () => {
            const row = db.select().from(dbSchema.scepCa).where(eq(dbSchema.scepCa.id, 1)).get();
            if (!row) return null;
            return {
              certPem: row.certPem,
              privateKeyJwk: row.privateKeyJwk as unknown as JsonWebKey,
            };
          },
          catch: (cause) => new ScepError({ message: "Failed to get CA", cause }),
        }),
      saveCa: (certPem, privateKeyJwk) =>
        Effect.try({
          try: () => {
            db.insert(dbSchema.scepCa)
              .values({ id: 1, certPem, privateKeyJwk, createdAt: new Date() })
              .onConflictDoUpdate({
                target: dbSchema.scepCa.id,
                set: { certPem, privateKeyJwk },
              })
              .run();
          },
          catch: (cause) => new ScepError({ message: "Failed to save CA", cause }),
        }),
      authenticatePkcsReq: () => Effect.void,
    }),
  );
