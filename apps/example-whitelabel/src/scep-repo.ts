import { Effect, Layer } from "effect";
import {
  ScepCaKeyError,
  ScepError,
  ScepRepository,
  openCaPrivateKey,
  sealCaPrivateKey,
  verifyScepChallenge,
} from "@mattrax/scep";

const storageError =
  (message: string) =>
  (cause: unknown): ScepError =>
    cause instanceof ScepError
      ? cause
      : cause instanceof ScepCaKeyError
        ? new ScepError({ message: cause.message })
        : new ScepError({ message, cause });

export const ScepRepositoryD1 = (db: D1Database, options: { authSecret?: string } = {}) =>
  Layer.succeed(
    ScepRepository,
    ScepRepository.of({
      getCa: () =>
        Effect.gen(function* () {
          const row = yield* Effect.tryPromise({
            try: () =>
              db
                .prepare("SELECT cert_pem, private_key_jwk FROM scep_ca WHERE id = 1")
                .first<{ cert_pem: string; private_key_jwk: string }>(),
            catch: storageError("Failed to get CA"),
          });
          if (!row) return null;

          // The column holds either the sealed envelope or a legacy plaintext
          // JWK. Sealing on read keeps existing CA certificates valid while
          // ensuring the plaintext only exists in memory.
          const opened = yield* Effect.tryPromise({
            try: () => openCaPrivateKey(row.private_key_jwk, options.authSecret),
            catch: storageError("Failed to read the SCEP CA private key"),
          });
          if (opened.migrated) {
            yield* Effect.tryPromise({
              try: () =>
                db
                  .prepare("UPDATE scep_ca SET private_key_jwk = ? WHERE id = 1")
                  .bind(JSON.stringify(opened.migrated))
                  .run(),
              catch: storageError("Failed to persist the encrypted SCEP CA private key"),
            });
          }

          return {
            certPem: row.cert_pem,
            privateKeyJwk: opened.privateKeyJwk,
          };
        }),
      saveCa: (certPem, privateKeyJwk) =>
        Effect.gen(function* () {
          const sealed = yield* Effect.tryPromise({
            try: () => sealCaPrivateKey(options.authSecret, privateKeyJwk),
            catch: storageError("Failed to encrypt the SCEP CA private key"),
          });
          yield* Effect.tryPromise({
            try: () =>
              db
                .prepare(
                  "INSERT INTO scep_ca (id, cert_pem, private_key_jwk) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET cert_pem = excluded.cert_pem, private_key_jwk = excluded.private_key_jwk",
                )
                .bind(certPem, JSON.stringify(sealed))
                .run(),
            catch: storageError("Failed to save CA"),
          });
        }),
      authenticatePkcsReq: (req) =>
        Effect.gen(function* () {
          const secret = options.authSecret;
          if (!secret) {
            // Issuing a CA-signed identity without a challenge lets anyone
            // enroll. Require AUTH_SECRET for the example deployment too.
            return yield* Effect.fail(
              new ScepError({
                message: "SCEP authentication is not configured; set AUTH_SECRET",
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
          return { enrollmentId: verification.enrollmentId };
        }),
    }),
  );
