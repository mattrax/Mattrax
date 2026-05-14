import { Effect, Layer } from "effect";
import { ScepError, ScepRepository } from "@mattrax/scep";
import { FsDb } from "../db.ts";

export const ScepRepositoryLive = (db: FsDb) =>
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
      authenticatePkcsReq: () => Effect.void,
    }),
  );
