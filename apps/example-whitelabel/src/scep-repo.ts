import { Effect, Layer } from "effect";
import { ScepError, ScepRepository, verifyScepChallenge } from "@mattrax/scep";

export const ScepRepositoryD1 = (db: D1Database, options: { authSecret?: string } = {}) =>
  Layer.succeed(
    ScepRepository,
    ScepRepository.of({
      getCa: () =>
        Effect.tryPromise({
          try: async () => {
            const row = await db
              .prepare("SELECT cert_pem, private_key_jwk FROM scep_ca WHERE id = 1")
              .first<{ cert_pem: string; private_key_jwk: string }>();
            if (!row) return null;
            return {
              certPem: row.cert_pem,
              privateKeyJwk: JSON.parse(row.private_key_jwk) as JsonWebKey,
            };
          },
          catch: (cause) => new ScepError({ message: "Failed to get CA", cause }),
        }),
      saveCa: (certPem, privateKeyJwk) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .prepare(
                "INSERT INTO scep_ca (id, cert_pem, private_key_jwk) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET cert_pem = excluded.cert_pem, private_key_jwk = excluded.private_key_jwk",
              )
              .bind(certPem, JSON.stringify(privateKeyJwk))
              .run();
          },
          catch: (cause) => new ScepError({ message: "Failed to save CA", cause }),
        }),
      authenticatePkcsReq: (req) =>
        Effect.gen(function* () {
          const secret = options.authSecret;
          if (!secret) {
            // The example deployment may run without a shared secret. Keep the
            // legacy open behaviour in that case; configuring AUTH_SECRET
            // enables per-enrollment challenge verification.
            return;
          }
          const verification = yield* Effect.tryPromise({
            try: () => verifyScepChallenge(req.challengePassword, secret),
            catch: (cause) => new ScepError({ message: "Failed to verify SCEP challenge", cause }),
          });
          if (!verification) {
            return yield* Effect.fail(new ScepError({ message: "Invalid SCEP challenge" }));
          }
          return { organizationalUnit: undefined };
        }),
    }),
  );
