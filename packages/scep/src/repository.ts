import { Context, Effect } from "effect";
import * as pkijs from "pkijs";
import { ScepError } from "./schema.js";

export interface ScepPkcsReq {
  readonly csr: pkijs.CertificationRequest;
  readonly transactionId: string;
  readonly senderNonce: ArrayBuffer;
  readonly signerCerts: pkijs.Certificate[];
}

export class ScepRepository extends Context.Service<
  ScepRepository,
  {
    readonly getCa: () => Effect.Effect<
      { certPem: string; privateKeyJwk: JsonWebKey } | null,
      ScepError
    >;
    readonly saveCa: (certPem: string, privateKeyJwk: JsonWebKey) => Effect.Effect<void, ScepError>;
    /** Hook for authenticating incoming SCEP PKCSReq messages. Throw/return a failed Effect to reject. */
    readonly authenticatePkcsReq: (req: ScepPkcsReq) => Effect.Effect<void, ScepError>;
  }
>()("ScepRepository") {}
