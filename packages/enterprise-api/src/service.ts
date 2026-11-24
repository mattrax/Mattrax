import { Effect, Layer, Option } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { Db, Env, R2, schema } from "@mattrax/enterprise-core";
import type { PlanLimitsConfig } from "@mattrax/enterprise-core";
import {
  EnterpriseAuth,
  EnterpriseErrorDiagnostics,
  EnterpriseService as EnterpriseServiceTag,
  ApplicationStoreService,
  ApplicationStorefrontService,
} from "@mattrax/enterprise-domain";
import { ApnsService } from "@mattrax/apns";
import type { AppleProfileSigningConfig } from "@mattrax/dm-apple";
import { createEnterpriseService } from "./enterpriseHandlers.js";
import { makeApplicationStoreService } from "./appStore.js";
import type { EnterpriseAnalytics } from "./enterpriseHandlers.js";
import { BillingService } from "@mattrax/enterprise-billing";
import type { BillingOperations } from "@mattrax/enterprise-billing";
import { AzureGraph } from "@mattrax/azure-graph";
import type { AzureGraphService } from "@mattrax/azure-graph";
import type { AndroidDeliveryConfig, OnboardingEmailBranding } from "@mattrax/enterprise-backend";
import type { AppleApiConfig } from "@mattrax/apple-business-manager";
import type { EmailTransport } from "@mattrax/email";
import type { GoogleWorkspaceCredentials } from "@mattrax/google-workspace";
import { SoftwareUpdateCache } from "@mattrax/enterprise-backend";

type R2Bucket = Parameters<typeof R2.layer>[0];

export type EnterpriseServiceOptions = {
  readonly azureGraph?: AzureGraphService;
  readonly azureClientId?: string;
  /** Deployment-wide Google Workspace directory credentials (optional). */
  readonly googleWorkspace?: GoogleWorkspaceCredentials;
  /** Federated WSTEP configuration shown in Settings → Management. */
  readonly windowsFederated?: {
    readonly audience?: string;
    readonly authServiceUrl?: (tenantId: string) => string;
  };
  /** Google Android Enterprise delivery config; omit when unconfigured. */
  readonly android?: AndroidDeliveryConfig;
  /** ABM/VPP client overrides; omit to use the real Apple endpoints. */
  readonly appleApi?: AppleApiConfig;
  /** Typed catalogue lookup port; defaults to the bounded iTunes client. */
  readonly applicationStore?: ApplicationStoreService["Service"];
  /** Deployment plan catalogue; omit for unlimited plans. */
  readonly planLimits?: PlanLimitsConfig;
  /**
   * Retention window for the Windows failure history shown in Settings →
   * Delivery. Defaults to the maintenance default; `0` means kept forever.
   */
  readonly windowsFailureRetentionDays?: number;
  /** Test/deployment override for the Windows diagnostic archive byte cap. */
  readonly windowsDiagnosticsMaxBytes?: number;
  /** Stripe price for the per-device plan; enables Checkout and seat sync. */
  /**
   * Customer-facing billing implementation. Omit on hosted deployments to use
   * Stripe; a self-hosted deployment supplies the remote cloud service.
   */
  readonly billing?: BillingOperations;
  /** Optional static analytics sink, used when the request has no sink. */
  readonly analytics?: EnterpriseAnalytics;
  /**
   * Deployment identity used to CMS-sign Apple enrollment profiles. This is an
   * explicit self-hosted override; when omitted, each tenant's SCEP CA signs the
   * download.
   */
  readonly appleProfileSigning?: AppleProfileSigningConfig;
  readonly email?: EmailTransport;
  /**
   * Deployment-owned platform operators, parsed from `MATTRAX_SUPERADMINS`.
   * The list is authoritative over the stored account flag.
   */
  readonly superadmins?: ReadonlyArray<string>;
  /** Verified invitation sender; defaults to `hello@mattrax.cloud`. */
  readonly invitationFromEmail?: string;
  /** Deployment branding for account email sent before a tenant exists. */
  readonly branding?: OnboardingEmailBranding | null;
  /**
   * Lifetime of the bearer SCEP challenge in an Apple enrollment profile, in
   * seconds. Defaults to one hour (see `ENROLLMENT_PROFILE_DEFAULT_TTL_SECONDS`).
   */
  readonly enrollmentProfileTtlSeconds?: number;
  /**
   * SOFA macOS update feed. Omit to use the public feed and its defaults.
   * `softwareUpdateDisabled` keeps every macOS status `unknown` on an
   * air-gapped deployment rather than reporting devices as up to date.
   */
  readonly softwareUpdateFeedUrl?: string;
  readonly softwareUpdateCacheTtlMs?: number;
  readonly softwareUpdateRetryMs?: number;
  readonly softwareUpdateTimeoutMs?: number;
  readonly softwareUpdateSupportedMajors?: number;
  readonly softwareUpdateDisabled?: boolean;
  /** Injectable Effect client for the SOFA feed; production uses runtime fetch. */
  readonly softwareUpdateHttpClient?: HttpClient.HttpClient;
};

export const EnterpriseService = (options: EnterpriseServiceOptions = {}) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const db = yield* Db;
      const env = yield* Env;
      const auth = yield* EnterpriseAuth;
      const billing = Option.getOrUndefined(yield* Effect.serviceOption(BillingService));
      const r2 = yield* R2;
      const softwareUpdateCache = yield* SoftwareUpdateCache;
      const errorDiagnostics = yield* EnterpriseErrorDiagnostics;
      const softwareUpdateHttpClient =
        options.softwareUpdateHttpClient ?? (yield* HttpClient.HttpClient);
      const apns = yield* ApnsService;
      const azureGraph = yield* Effect.serviceOption(AzureGraph);
      const applicationStore =
        options.applicationStore ??
        Option.getOrUndefined(yield* Effect.serviceOption(ApplicationStoreService)) ??
        makeApplicationStoreService(options.appleApi);

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

      const service = createEnterpriseService({
        db,
        schema,
        origin: env.origin,
        branding: options.branding,
        billing: billing ?? options.billing,
        storage,
        r2,
        errorDiagnostics,
        auth,
        authSecret: env.authSecret,
        cloudAppleVendorCert: env.cloudAppleVendorCert,
        cloudAppleVendorKey: env.cloudAppleVendorKey,
        appleProfileSigning:
          options.appleProfileSigning ??
          (env.appleProfileSigningCert || env.appleProfileSigningKey || env.appleProfileSigningChain
            ? {
                certificatePem: env.appleProfileSigningCert,
                privateKeyPem: env.appleProfileSigningKey,
                chainPem: env.appleProfileSigningChain,
              }
            : undefined),
        apns,
        superadmins: options.superadmins,
        android: options.android,
        appleApi: options.appleApi,
        applicationStore,
        planLimits: options.planLimits,
        windowsFailureRetentionDays: options.windowsFailureRetentionDays,
        windowsDiagnosticsMaxBytes: options.windowsDiagnosticsMaxBytes,
        analytics: options.analytics,
        email: options.email,
        invitationFromEmail: options.invitationFromEmail,
        enrollmentProfileTtlSeconds: options.enrollmentProfileTtlSeconds,
        softwareUpdateFeedUrl: options.softwareUpdateFeedUrl,
        softwareUpdateCacheTtlMs: options.softwareUpdateCacheTtlMs,
        softwareUpdateRetryMs: options.softwareUpdateRetryMs,
        softwareUpdateTimeoutMs: options.softwareUpdateTimeoutMs,
        softwareUpdateSupportedMajors: options.softwareUpdateSupportedMajors,
        softwareUpdateDisabled: options.softwareUpdateDisabled,
        softwareUpdateHttpClient,
        softwareUpdateCache,
        azureGraph: options.azureGraph ?? Option.getOrUndefined(azureGraph),
        azureClientId: options.azureClientId,
        googleWorkspace: options.googleWorkspace,
        windowsFederated: options.windowsFederated,
      });

      return Layer.mergeAll(
        Layer.succeed(EnterpriseServiceTag, service),
        Layer.succeed(
          ApplicationStorefrontService,
          ApplicationStorefrontService.of({
            refresh: (...args) => service.refreshApplicationStorefronts(...args),
          }),
        ),
      );
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
