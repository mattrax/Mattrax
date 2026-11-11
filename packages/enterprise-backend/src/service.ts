import { Effect, Layer, Option } from "effect";
import { Db, Env, R2, schema, type PlanLimitsConfig } from "@mattrax/enterprise-core";
import {
  EnterpriseAuth,
  EnterpriseService as EnterpriseServiceTag,
} from "@mattrax/enterprise-domain";
import { ApnsService } from "@mattrax/apns";
import { StripeService } from "@mattrax/effect-stripe";
import { createEnterpriseService } from "./enterpriseHandlers.ts";
import { AzureGraph, type AzureGraphService } from "@mattrax/azure-graph";
import type { AndroidDeliveryConfig } from "./android.ts";

type R2Bucket = Parameters<typeof R2.layer>[0];

export type EnterpriseServiceOptions = {
  readonly azureGraph?: AzureGraphService;
  readonly azureClientId?: string;
  /** Google Android Enterprise delivery config; omit when unconfigured. */
  readonly android?: AndroidDeliveryConfig;
  /** Deployment plan catalogue; omit for unlimited plans. */
  readonly planLimits?: PlanLimitsConfig;
  readonly email?: {
    send(message: {
      to: string;
      from: { name: string; email: string };
      subject: string;
      text?: string;
      html?: string;
    }): Promise<unknown>;
  };
};

export const EnterpriseService = (options: EnterpriseServiceOptions = {}) =>
  Layer.effect(
    EnterpriseServiceTag,
    Effect.gen(function* () {
      const db = yield* Db;
      const env = yield* Env;
      const auth = yield* EnterpriseAuth;
      const stripeClient = yield* Effect.serviceOption(StripeService);
      const r2 = yield* R2;
      const apns = yield* ApnsService;
      const azureGraph = yield* Effect.serviceOption(AzureGraph);

      const storage: R2Bucket = {
        head: (key) =>
          Effect.runPromise(
            r2.head(key).pipe(Effect.catchTag("R2FileNotFound", () => Effect.succeed(null))),
          ),
        get: (key, options) =>
          Effect.runPromise(
            r2
              .get(key, options)
              .pipe(Effect.catchTag("R2FileNotFound", () => Effect.succeed(null))),
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
          stripeClient: Option.getOrUndefined(stripeClient),
          storage,
          auth,
          authSecret: env.authSecret,
          cloudAppleVendorCert: env.cloudAppleVendorCert,
          cloudAppleVendorKey: env.cloudAppleVendorKey,
          apns,
          android: options.android,
          planLimits: options.planLimits,
          email: options.email,
          azureGraph: options.azureGraph ?? Option.getOrUndefined(azureGraph),
          azureClientId: options.azureClientId,
        }),
      );
    }),
  );
