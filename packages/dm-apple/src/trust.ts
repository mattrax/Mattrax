import { Context, Effect, Layer } from "effect";
import type { MdmError } from "./schema.js";

/**
 * Host-provided trust anchors for device message signatures. Hosts that do not
 * wire this service keep the historical behaviour (verify when a signature is
 * present only if a CA list is supplied; never require one).
 *
 * Trust is tenant-scoped: each tenant signs with its own SCEP CA, so the host
 * resolves anchors from the identity certificate subject (the tenant id is in
 * the `OU`) instead of returning every CA in the deployment.
 */
export type AppleMdmTrustService = {
  readonly requireSignature: boolean;
  readonly caCertPems: (
    identityCertificateSubject?: string,
  ) => Effect.Effect<ReadonlyArray<string>, MdmError>;
};

export class AppleMdmTrust extends Context.Service<AppleMdmTrust, AppleMdmTrustService>()(
  "@mattrax/dm-apple/AppleMdmTrust",
) {}

export const AppleMdmTrustDefault: Layer.Layer<AppleMdmTrust> = Layer.succeed(
  AppleMdmTrust,
  AppleMdmTrust.of({
    requireSignature: false,
    caCertPems: () => Effect.succeed([]),
  }),
);
