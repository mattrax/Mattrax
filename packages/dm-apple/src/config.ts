import { Context, Layer } from "effect";

export declare namespace AppleMdmConfig {
  export type Service = {
    /** Public origin used in enrollment profiles, profile URLs and asset URLs. */
    readonly origin: string;
    /** Apple MDM vendor certificate used to derive the APNs topic. */
    readonly cloudAppleVendorCert?: string;
    readonly cloudAppleVendorKey?: string;
    /**
     * Application secret used to sign short-lived profile and asset URLs.
     * Must match the secret used by the management backend to build DDM
     * declarations.
     */
    readonly authSecret?: string;
    /** Optional defaults for the standalone `/enroll` endpoint. */
    readonly organizationId?: string;
    readonly organizationName?: string;
    /** Support address embedded in generated enrollment profiles. */
    readonly supportEmail?: string;
  };
}

/**
 * Protocol-local configuration for the Apple device-management package.
 *
 * This deliberately does not depend on `@mattrax/enterprise-core`: whitelabel
 * and self-hosted deployments provide their own configuration layer.
 */
export class AppleMdmConfig extends Context.Service<AppleMdmConfig, AppleMdmConfig.Service>()(
  "@mattrax/dm-apple/AppleMdmConfig",
) {
  static readonly layer = (config: AppleMdmConfig.Service): Layer.Layer<AppleMdmConfig> =>
    Layer.succeed(AppleMdmConfig, AppleMdmConfig.of(config));
}

type ProcessGlobal = {
  readonly process?: { readonly env?: Record<string, string | undefined> };
};

const globalWithProcess: ProcessGlobal = globalThis;

const processEnv = (): Record<string, string | undefined> => globalWithProcess.process?.env ?? {};

/**
 * Compatibility fallback for hosts that have not wired `AppleMdmConfig` yet
 * (notably the hosted Cloud API). Workers with `nodejs_compat` expose bindings
 * and secrets through `process.env`.
 */
export const appleMdmConfigFromEnv = (): AppleMdmConfig.Service => {
  const env = processEnv();

  return {
    origin: env.ORIGIN ?? env.MATTRAX_ORIGIN ?? "",
    cloudAppleVendorCert: env.CLOUD_APPLE_VENDOR_CERT ?? env.APNS_CERT,
    cloudAppleVendorKey: env.CLOUD_APPLE_VENDOR_KEY,
    authSecret: env.AUTH_SECRET ?? env.MATTRAX_AUTH_SECRET,
  };
};
