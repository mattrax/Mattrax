import { Effect, Layer, Option } from "effect";
import { Db, Env, R2, schema, type PlanLimitsConfig } from "@mattrax/enterprise-core";
import {
  EnterpriseAuth,
  EnterpriseService as EnterpriseServiceTag,
} from "@mattrax/enterprise-domain";
import { ApnsService } from "@mattrax/apns";
import { StripeService } from "@mattrax/effect-stripe";
import type { AppleProfileSigningConfig } from "@mattrax/dm-apple";
import { createEnterpriseService, type EnterpriseAnalytics } from "./enterpriseHandlers.ts";
import { AzureGraph, type AzureGraphService } from "@mattrax/azure-graph";
import type { AndroidDeliveryConfig } from "./android.ts";
import type { AppleApiConfig } from "./appleBusinessManager.ts";
import type { EmailReplyTo } from "./email.ts";

type R2Bucket = Parameters<typeof R2.layer>[0];

export type EnterpriseServiceOptions = {
  readonly azureGraph?: AzureGraphService;
  readonly azureClientId?: string;
  /** Federated WSTEP configuration shown in Settings → Management. */
  readonly windowsFederated?: {
    readonly audience?: string;
    readonly authServiceUrl?: (tenantId: string) => string;
  };
  /** Google Android Enterprise delivery config; omit when unconfigured. */
  readonly android?: AndroidDeliveryConfig;
  /** ABM/VPP client overrides; omit to use the real Apple endpoints. */
  readonly appleApi?: AppleApiConfig;
  /** Deployment plan catalogue; omit for unlimited plans. */
  readonly planLimits?: PlanLimitsConfig;
  /** Stripe price for the per-device plan; enables Checkout and seat sync. */
  readonly deviceMonthlyPriceId?: string;
  /** Optional static analytics sink, used when the request has no sink. */
  readonly analytics?: EnterpriseAnalytics;
  /**
   * Deployment identity used to CMS-sign Apple enrollment profiles. This is an
   * explicit self-hosted override; when omitted, each tenant's SCEP CA signs the
   * download.
   */
  readonly appleProfileSigning?: AppleProfileSigningConfig;
  readonly email?: {
    send(message: {
      to: string;
      from: { name: string; email: string };
      replyTo?: EmailReplyTo;
      subject: string;
      text?: string;
      html?: string;
    }): Promise<void>;
  };
  /** Verified invitation sender; defaults to `hello@mattrax.cloud`. */
  readonly invitationFromEmail?: string;
  /**
   * Lifetime of the bearer SCEP challenge in an Apple enrollment profile, in
   * seconds. Defaults to one hour (see `ENROLLMENT_PROFILE_DEFAULT_TTL_SECONDS`).
   */
  readonly enrollmentProfileTtlSeconds?: number;
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
          deviceMonthlyPriceId: options.deviceMonthlyPriceId,
          storage,
          auth,
          authSecret: env.authSecret,
          cloudAppleVendorCert: env.cloudAppleVendorCert,
          cloudAppleVendorKey: env.cloudAppleVendorKey,
          appleProfileSigning:
            options.appleProfileSigning ??
            (env.appleProfileSigningCert ||
            env.appleProfileSigningKey ||
            env.appleProfileSigningChain
              ? {
                  certificatePem: env.appleProfileSigningCert,
                  privateKeyPem: env.appleProfileSigningKey,
                  chainPem: env.appleProfileSigningChain,
                }
              : undefined),
          apns,
          android: options.android,
          appleApi: options.appleApi,
          planLimits: options.planLimits,
          analytics: options.analytics,
          email: options.email,
          invitationFromEmail: options.invitationFromEmail,
          enrollmentProfileTtlSeconds: options.enrollmentProfileTtlSeconds,
          azureGraph: options.azureGraph ?? Option.getOrUndefined(azureGraph),
          azureClientId: options.azureClientId,
          windowsFederated: options.windowsFederated,
        }),
      );
    }),
  );
