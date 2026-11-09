import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { Db, schema } from "@mattrax/enterprise-core";
import {
  ScepError,
  ScepRepository,
  verifyScepChallenge,
  type ScepAuthentication,
  type ScepPkcsReq,
} from "@mattrax/scep";

const isJsonWebKey = (value: unknown): value is JsonWebKey =>
  typeof value === "object" && value !== null;

const processEnvSecret = (): string | undefined => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.AUTH_SECRET ?? env?.MATTRAX_AUTH_SECRET;
};

export type ScepRepositoryOptions = {
  /** Application secret used to verify per-enrollment challenges. */
  readonly authSecret?: string;
};

export class ScepRepositoryLive extends ScepRepository {
  static readonly make = (
    db: Db["Service"],
    options: ScepRepositoryOptions = {},
  ): ScepRepository["Service"] => {
    const authenticatePkcsReq = (req: ScepPkcsReq): Effect.Effect<ScepAuthentication, ScepError> =>
      Effect.gen(function* () {
        const secret = options.authSecret ?? processEnvSecret();
        if (!secret) {
          return yield* Effect.fail(
            new ScepError({
              message: "SCEP challenge verification is not configured (AUTH_SECRET is missing)",
            }),
          );
        }

        const verification = yield* Effect.tryPromise({
          try: () => verifyScepChallenge(req.challengePassword, secret),
          catch: (cause) => new ScepError({ message: "Failed to verify SCEP challenge", cause }),
        });
        if (!verification) {
          return yield* Effect.fail(new ScepError({ message: "Invalid SCEP challenge" }));
        }

        const [enrollment] = yield* db
          .select()
          .from(schema.enterpriseEnrollment)
          .where(eq(schema.enterpriseEnrollment.id, verification.enrollmentId))
          .limit(1)
          .pipe(
            Effect.mapError(
              (cause) => new ScepError({ message: "Failed to resolve SCEP enrollment", cause }),
            ),
          );
        if (!enrollment) {
          return yield* Effect.fail(new ScepError({ message: "Unknown SCEP enrollment" }));
        }

        // Authenticated tenant id becomes the issued certificate's OU. It is
        // never derived from attacker-controlled CSR content.
        return { organizationalUnit: enrollment.organizationId };
      });

    return ScepRepository.of({
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

      authenticatePkcsReq,
    });
  };

  /**
   * Kept as a plain layer for existing hosts. The secret is read from
   * `AUTH_SECRET` / `MATTRAX_AUTH_SECRET` at request time; use
   * {@link ScepRepositoryLive.layerWithOptions} to inject it explicitly.
   */
  static readonly layer: Layer.Layer<ScepRepository, never, Db> = Layer.effect(
    ScepRepository,
    Effect.gen(function* () {
      const db = yield* Db;
      return ScepRepositoryLive.make(db);
    }),
  );

  static readonly layerWithOptions = (
    options: ScepRepositoryOptions,
  ): Layer.Layer<ScepRepository, never, Db> =>
    Layer.effect(
      ScepRepository,
      Effect.gen(function* () {
        const db = yield* Db;
        return ScepRepositoryLive.make(db, options);
      }),
    );
}
