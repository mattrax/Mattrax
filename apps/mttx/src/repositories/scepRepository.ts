import { Effect, Layer } from "effect";
import { ScepCaKeyError, ScepError, ScepRepository, verifyScepChallenge } from "@mattrax/scep";
import { FsDb } from "../db.ts";

const storageError =
  (message: string) =>
  (cause: unknown): ScepError =>
    cause instanceof ScepError
      ? cause
      : cause instanceof ScepCaKeyError
        ? new ScepError({ message: cause.message })
        : new ScepError({ message, cause });

export const ScepRepositoryLive = (db: FsDb, options: { authSecret?: string } = {}) =>
  Layer.succeed(ScepRepository)(
    ScepRepository.of({
      getCa: () =>
        Effect.tryPromise({
          try: () => db.getCa(),
          catch: storageError("Failed to get CA"),
        }),
      saveCa: (certPem, privateKeyJwk) =>
        Effect.tryPromise({
          try: () => db.saveCa(certPem, privateKeyJwk),
          catch: storageError("Failed to save CA"),
        }),
      authenticatePkcsReq: (req) =>
        Effect.gen(function* () {
          const secret = options.authSecret;
          if (!secret) {
            // Issuing certificates without a challenge lets anyone obtain a
            // CA-signed identity. Require an auth secret explicitly.
            return yield* Effect.fail(
              new ScepError({
                message:
                  "SCEP authentication is not configured; set MATTRAX_AUTH_SECRET or --auth-secret",
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
          // The self-hosted server does not own the tenant database, but the
          // challenge id and the subject OU are set by the enrollment profile,
          // so preserving the CSR subject keeps the certificate tenant-scoped.
          return { organizationalUnit: undefined };
        }),
    }),
  );
