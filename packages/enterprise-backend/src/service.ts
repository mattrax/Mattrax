import { Effect, Layer } from "effect";
import { Db, Env, R2, schema } from "@mattrax/enterprise-core";
import {
  EnterpriseAuth,
  EnterpriseService as EnterpriseServiceTag,
} from "@mattrax/enterprise-domain";
import { StripeService } from "@mattrax/effect-stripe";
import { createEnterpriseService } from "./enterpriseHandlers.ts";

type R2Bucket = Parameters<typeof R2.layer>[0];

export const EnterpriseService = Layer.effect(
  EnterpriseServiceTag,
  Effect.gen(function* () {
    const db = yield* Db;
    const env = yield* Env;
    const auth = yield* EnterpriseAuth;
    const stripeClient = yield* StripeService;
    const r2 = yield* R2;

    const storage: R2Bucket = {
      head: (key) =>
        Effect.runPromise(
          r2.head(key).pipe(Effect.catchTag("R2FileNotFound", () => Effect.succeed(null))),
        ),
      get: (key, options) =>
        Effect.runPromise(
          r2.get(key, options).pipe(Effect.catchTag("R2FileNotFound", () => Effect.succeed(null))),
        ),
      put: (key, value, options) => Effect.runPromise(r2.put(key, value, options)),
      delete: (keys) => Effect.runPromise(r2.delete(keys)),
      list: (options) => Effect.runPromise(r2.list(options)),
    };

    return EnterpriseServiceTag.of(
      createEnterpriseService({
        db,
        schema,
        origin: env.origin,
        stripeClient,
        storage,
        auth,
      }),
    );
  }),
);
