import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { Db, schema } from "@mattrax/enterprise-core";
import { ScepError, ScepRepository } from "@mattrax/scep";

const isJsonWebKey = (value: unknown): value is JsonWebKey =>
  typeof value === "object" && value !== null;

export class ScepRepositoryLive extends ScepRepository {
  static readonly make = (db: Db["Service"]): ScepRepository["Service"] =>
    ScepRepository.of({
      getCa: () =>
        Effect.gen(function* () {
          const [row] = yield* db
            .select()
            .from(schema.scepCa)
            .where(eq(schema.scepCa.id, 1))
            .limit(1);
          if (!row) return null;
          if (!isJsonWebKey(row.privateKeyJwk)) {
            return yield* Effect.fail(
              new ScepError({ message: "Stored CA private key is invalid" }),
            );
          }
          return {
            certPem: row.certPem,
            privateKeyJwk: row.privateKeyJwk,
          };
        }).pipe(Effect.mapError((cause) => new ScepError({ message: "Failed to get CA", cause }))),

      saveCa: (certPem: string, privateKeyJwk: JsonWebKey) =>
        Effect.gen(function* () {
          yield* db
            .insert(schema.scepCa)
            .values({
              id: 1,
              certPem,
              privateKeyJwk,
              createdAt: new Date(),
            })
            .onDuplicateKeyUpdate({
              set: { certPem, privateKeyJwk },
            });
        }).pipe(Effect.mapError((cause) => new ScepError({ message: "Failed to save CA", cause }))),

      authenticatePkcsReq: () => Effect.void,
    });

  static readonly layer: Layer.Layer<ScepRepository, never, Db> = Layer.effect(
    ScepRepository,
    Effect.gen(function* () {
      const db = yield* Db;
      return ScepRepositoryLive.make(db);
    }),
  );
}
