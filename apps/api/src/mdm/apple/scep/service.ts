import { Context, Effect, Layer } from "effect";
import { ScepError } from "../schema";
import { ScepRepository } from "./repository";
import {
  generateCaKeyPair,
  exportPrivateKeyJwk,
  importPrivateKeyJwk,
} from "./crypto";
import {
  parseScepPkcsReq,
  createDeviceCertificate,
  createCaCertificate,
  buildScepCertRep,
  certToPem,
  pemToCert,
} from "./pkcs7";

const SCEP_CAPS = "SHA-256\nSHA-1\nAES\nDES3\nPOSTPKIOperation";

export class ScepService extends Context.Service<
  ScepService,
  {
    readonly getCaCaps: () => Effect.Effect<string, ScepError>;
    readonly getCaCert: () => Effect.Effect<{ raw: ArrayBuffer; isPkcs7: boolean }, ScepError>;
    readonly pkiOperation: (message: ArrayBuffer) => Effect.Effect<ArrayBuffer, ScepError>;
  }
>()("ScepService") {}

export const ScepServiceLive = Layer.effect(
  ScepService,
  Effect.gen(function* () {
    const repo = yield* ScepRepository;

    const ensureCa = Effect.gen(function* () {
      const existing = yield* repo.getCa();
      if (existing) {
        const caCert = yield* Effect.sync(() => {
          try {
            return pemToCert(existing.certPem);
          } catch {
            return null;
          }
        });
        if (caCert) {
          const privateKey = yield* importPrivateKeyJwk(existing.privateKeyJwk);
          return { privateKey, caCert, certPem: existing.certPem };
        }
        // Stored cert is malformed (e.g. from old hand-written ASN.1 code) — regenerate
      }

      const keyPair = yield* generateCaKeyPair();
      const jwk = yield* exportPrivateKeyJwk(keyPair.privateKey);
      const caCert = yield* Effect.tryPromise({
        try: () => createCaCertificate(keyPair, "Mattrax SCEP CA"),
        catch: (cause) => new ScepError({ message: "Failed to create CA certificate", cause }),
      });
      const certPem = certToPem(caCert);

      yield* repo.saveCa(certPem, jwk);
      return { privateKey: keyPair.privateKey, caCert, certPem };
    });

    const getCaCaps = (): Effect.Effect<string, ScepError> => Effect.succeed(SCEP_CAPS);

    const getCaCert = (): Effect.Effect<{ raw: ArrayBuffer; isPkcs7: boolean }, ScepError> =>
      Effect.gen(function* () {
        const ca = yield* ensureCa;
        // Return raw DER for single CA cert (Apple expects this)
        const raw = ca.caCert.toSchema().toBER(false);
        return { raw, isPkcs7: false };
      });

    const pkiOperation = (message: ArrayBuffer): Effect.Effect<ArrayBuffer, ScepError> =>
      Effect.gen(function* () {
        const ca = yield* ensureCa;

        const req = yield* parseScepPkcsReq(message, ca.caCert, ca.privateKey);

        const notBefore = new Date();
        const notAfter = new Date(notBefore.getTime() + 365 * 24 * 60 * 60 * 1000);
        const serial = Math.floor(Math.random() * 0x7fffffff);

        const publicKey = yield* Effect.tryPromise({
          try: () => req.csr.getPublicKey(),
          catch: (cause) => new ScepError({ message: "Failed to extract public key from CSR", cause }),
        });

        let subject = "device";
        for (const rdn of req.csr.subject.typesAndValues) {
          if (rdn.type === "2.5.4.3") {
            const val = rdn.value.valueBlock as any;
            if (typeof val.value === "string") {
              subject = val.value;
            }
            break;
          }
        }

        const deviceCert = yield* Effect.tryPromise({
          try: () =>
            createDeviceCertificate(
              serial,
              subject,
              publicKey,
              ca.caCert,
              ca.privateKey,
              { notBefore, notAfter },
            ),
          catch: (cause) => new ScepError({ message: "Failed to create device certificate", cause }),
        });

        const response = yield* Effect.tryPromise({
          try: () =>
            buildScepCertRep(
              deviceCert,
              ca.caCert,
              ca.privateKey,
              req.transactionId,
              req.senderNonce,
            ),
          catch: (cause) => new ScepError({ message: "Failed to build SCEP CertRep", cause }),
        });

        return response;
      });

    return ScepService.of({
      getCaCaps,
      getCaCert,
      pkiOperation,
    });
  }),
);
