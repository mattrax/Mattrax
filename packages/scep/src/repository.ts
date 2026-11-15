import { Context, Effect } from "effect";
import * as pkijs from "pkijs";
import { ScepError } from "./schema.js";

export interface ScepPkcsReq {
  readonly csr: pkijs.CertificationRequest;
  readonly transactionId: string;
  readonly senderNonce: ArrayBuffer;
  readonly signerCerts: pkijs.Certificate[];
  /** PKCS#9 challengePassword attribute from the CSR, if present. */
  readonly challengePassword?: string;
  /** True for a SCEP RenewalReq carrying an already-issued identity cert. */
  readonly renewal: boolean;
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
}

export type ScepIssuedCertificate = {
  readonly serial: string;
  readonly organizationId: string;
  readonly enrollmentId?: string;
  readonly deviceId?: string;
  readonly notAfter: Date;
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
     * Replace the tenant CA. Used for rotation and for an operator-supplied CA;
     * a tenant that has not bootstrapped yet is created.
     */
    readonly replaceCa: (
      scope: ScepCaScope,
      ca: ScepStoredCa,
    ) => Effect.Effect<ScepStoredCa, ScepError>;
    /** Hook for authenticating incoming SCEP PKCSReq messages. Throw/return a failed Effect to reject. */
    readonly authenticatePkcsReq: (
      scope: ScepCaScope,
      req: ScepPkcsReq,
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
