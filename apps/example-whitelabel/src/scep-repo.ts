import { Effect, Layer } from "effect";
import { ScepRepository, ScepError } from "@mattrax/scep";

export const ScepRepositoryD1 = (db: D1Database) =>
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
            return { certPem: row.cert_pem, privateKeyJwk: JSON.parse(row.private_key_jwk) as JsonWebKey };
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
      authenticatePkcsReq: () => Effect.void,
    }),
  );
