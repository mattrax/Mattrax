import type { Effect } from "effect";
import { Context } from "effect";
import type { ScepError } from "./schema.js";

/** Domain view of a PKCSReq passed to repository authentication hooks. */
export interface ScepAuthenticationRequest {
  readonly transactionId: string;
  /** PKCS#9 challengePassword attribute from the CSR, if present. */
  readonly challengePassword?: string;
  /** True for a SCEP RenewalReq carrying an already-issued identity cert. */
  readonly renewal: boolean;
  readonly subject: ReadonlyArray<{ readonly type: string; readonly value: string }>;
  readonly signerCertificates: ReadonlyArray<{
    readonly serial: string;
    readonly notAfter: Date;
    readonly organizationalUnit?: string;
  }>;
}

/**
 * The tenant whose CA signs this request. Every SCEP URL is tenant-scoped, so a
 * request can never fall back to another tenant's (or a deployment-wide) CA.
 */
export interface ScepCaScope {
  readonly organizationId: string;
}

/** CA material as persisted by the repository. */
export interface ScepStoredCa {
  readonly certPem: string;
  readonly privateKeyJwk: JsonWebKey;
  /** Whether Mattrax generated the CA or an operator supplied it. */
  readonly source?: "generated" | "imported";
}

/**
 * Information the repository learned while authenticating a PKCSReq. The
 * service uses the organizational unit to pin the issued certificate to the
 * authenticated tenant, regardless of what the CSR requested.
 */
export interface ScepAuthentication {
  readonly organizationalUnit?: string;
  readonly enrollmentId?: string;
  /** BYOD request the challenge was minted for, carried to the issued row. */
  readonly referenceId?: string;
}

export type ScepIssuedCertificate = {
  readonly serial: string;
  readonly organizationId: string;
  readonly enrollmentId?: string;
  readonly deviceId?: string;
  /** BYOD request this identity was issued for, when the challenge named one. */
  readonly referenceId?: string;
  /** SHA-256 of the issuing CA certificate. Absent on legacy rows. */
  readonly caFingerprintSha256?: string;
  readonly notAfter: Date;
};

/** A retired CA that is still accepted for identities it issued. */
export type ScepRetiredCa = {
  readonly certPem: string;
  readonly fingerprintSha256: string;
  readonly source: "generated" | "imported";
  readonly retiredAt: Date;
  readonly trustUntil: Date;
};

export class ScepRepository extends Context.Service<
  ScepRepository,
  {
    readonly getCa: (scope: ScepCaScope) => Effect.Effect<ScepStoredCa | null, ScepError>;
    /**
     * Atomically store a CA for the tenant if none exists. Returns the row that
     * is actually persisted: when two cold requests bootstrap concurrently the
     * loser receives the winner's CA instead of overwriting it.
     */
    readonly saveCa: (
      scope: ScepCaScope,
      ca: ScepStoredCa,
    ) => Effect.Effect<ScepStoredCa, ScepError>;
    /**
     * Replace the tenant CA. Used for an operator-supplied CA, which is a
     * deliberate trust-root change; a tenant that has not bootstrapped yet is
     * created.
     */
    readonly replaceCa: (
      scope: ScepCaScope,
      ca: ScepStoredCa,
    ) => Effect.Effect<ScepStoredCa, ScepError>;
    /**
     * Staged rotation. Persists `ca` as the tenant's current CA and retains the
     * previously persisted CA as a verification anchor until `trustUntil`.
     *
     * Implementations must write the retired anchor before replacing the
     * current CA: if the replacement then fails, the old CA is still current and
     * an extra anchor for it is harmless, whereas the reverse order would leave
     * issued identities untrusted.
     */
    readonly rotateCa: (
      scope: ScepCaScope,
      ca: ScepStoredCa,
      options: { readonly retiredAt: Date; readonly trustUntil: Date },
    ) => Effect.Effect<ScepStoredCa, ScepError>;
    /**
     * Certificates that may verify a device identity: the current CA followed by
     * retired anchors whose `trustUntil` has not passed. Empty when the tenant
     * has not bootstrapped yet.
     */
    readonly trustedCaCertificates: (
      scope: ScepCaScope,
      now?: Date,
    ) => Effect.Effect<ReadonlyArray<string>, ScepError>;
    /** Retired anchors, newest first. Used for health and the dashboard. */
    readonly listRetiredCa: (
      scope: ScepCaScope,
    ) => Effect.Effect<ReadonlyArray<ScepRetiredCa>, ScepError>;
    /** Hook for authenticating incoming SCEP PKCSReq messages. Throw/return a failed Effect to reject. */
    readonly authenticatePkcsReq: (
      scope: ScepCaScope,
      req: ScepAuthenticationRequest,
    ) => Effect.Effect<ScepAuthentication | void, ScepError>;
    /** Optional persistence for renewal authentication. */
    readonly recordIssuedCertificate?: (
      certificate: ScepIssuedCertificate,
    ) => Effect.Effect<void, ScepError>;
    readonly findIssuedCertificate?: (
      scope: ScepCaScope,
      serial: string,
    ) => Effect.Effect<ScepIssuedCertificate | null, ScepError>;
  }
>()("ScepRepository") {}
