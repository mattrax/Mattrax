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
  /** True for an SCEP RenewalReq carrying an already-issued identity cert. */
  readonly renewal: boolean;
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
    readonly getCa: () => Effect.Effect<
      { certPem: string; privateKeyJwk: JsonWebKey } | null,
      ScepError
    >;
    readonly saveCa: (certPem: string, privateKeyJwk: JsonWebKey) => Effect.Effect<void, ScepError>;
    /** Hook for authenticating incoming SCEP PKCSReq messages. Throw/return a failed Effect to reject. */
    readonly authenticatePkcsReq: (
      req: ScepPkcsReq,
    ) => Effect.Effect<ScepAuthentication | void, ScepError>;
    /** Optional persistence for renewal authentication. */
    readonly recordIssuedCertificate?: (
      certificate: ScepIssuedCertificate,
    ) => Effect.Effect<void, ScepError>;
    readonly findIssuedCertificate?: (
      serial: string,
    ) => Effect.Effect<ScepIssuedCertificate | null, ScepError>;
  }
>()("ScepRepository") {}
