import { Effect, Layer } from "effect";
import { ScepError, ScepRepository, verifyScepChallenge } from "@mattrax/scep";
import { FsDb } from "../db.ts";

export const ScepRepositoryLive = (db: FsDb, options: { authSecret?: string } = {}) =>
  Layer.succeed(ScepRepository)(
    ScepRepository.of({
      getCa: () =>
        Effect.try({
          try: () => db.getCa(),
          catch: (cause) => new ScepError({ message: "Failed to get CA", cause }),
        }),
      saveCa: (certPem, privateKeyJwk) =>
        Effect.try({
          try: () => db.saveCa(certPem, privateKeyJwk),
          catch: (cause) => new ScepError({ message: "Failed to save CA", cause }),
        }),
      authenticatePkcsReq: (req) =>
        Effect.gen(function* () {
          const secret = options.authSecret;
          if (!secret) {
            // Self-hosted deployments may not configure a shared secret. Keep
            // accepting the legacy static/auto challenge in that case; set
            // MATTRAX_AUTH_SECRET to enable per-enrollment verification.
            return;
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
