import { Context, Effect, Layer } from "effect";
import { ScepError } from "./schema.js";
import { ScepRepository } from "./repository.js";
import { generateCaKeyPair, exportPrivateKeyJwk, importPrivateKeyJwk } from "./crypto.js";
import {
  parseScepPkcsReq,
  createDeviceCertificate,
  createCaCertificate,
  buildScepCertRep,
  buildScepCertFailure,
  certToPem,
  pemToCert,
} from "./pkcs7.js";

const certificateSerialHex = (certificate: {
  serialNumber: { valueBlock: { valueHexView?: Uint8Array; valueHex?: ArrayBuffer } };
}): string => {
  const view = certificate.serialNumber.valueBlock.valueHexView;
  const buffer =
    view ?? new Uint8Array(certificate.serialNumber.valueBlock.valueHex ?? new ArrayBuffer(0));
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .replace(/^0+(?=.)/, "");
};

const SCEP_CAPS = "Renewal\nSCEPStandard\nSHA-256\nSHA-1\nAES\nDES3\nPOSTPKIOperation";

export class ScepServiceTag extends Context.Service<
  ScepServiceTag,
  {
    readonly getCaCaps: () => Effect.Effect<string, ScepError>;
    readonly getCaCert: () => Effect.Effect<{ raw: ArrayBuffer; isPkcs7: boolean }, ScepError>;
    readonly pkiOperation: (message: ArrayBuffer) => Effect.Effect<ArrayBuffer, ScepError>;
  }
>()("ScepService") {}

export const ScepService = Layer.effect(
  ScepServiceTag,
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
          return {
            privateKey,
            privateKeyJwk: existing.privateKeyJwk,
            caCert,
            certPem: existing.certPem,
          };
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
      const privateKey = yield* importPrivateKeyJwk(jwk);
      return { privateKey, privateKeyJwk: jwk, caCert, certPem };
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

        const req = yield* parseScepPkcsReq(message, ca.caCert, ca.privateKeyJwk);

        const csrValid = yield* Effect.tryPromise({
          try: () => req.csr.verify(),
          catch: (cause) => new ScepError({ message: "Failed to verify the CSR signature", cause }),
        });
        if (!csrValid) {
          return yield* Effect.tryPromise({
            try: () =>
              buildScepCertFailure(ca.caCert, ca.privateKey, req.transactionId, req.senderNonce),
            catch: (cause) =>
              new ScepError({ message: "Failed to build SCEP failure response", cause }),
          });
        }

        // Renewals carry a currently-valid identity certificate signed by this
        // CA instead of the original enrollment challenge.
        let authentication: { organizationalUnit?: string; enrollmentId?: string } | void =
          undefined;
        if (req.renewal) {
          const signer = req.signerCerts[0];
          if (!signer)
            return yield* Effect.fail(new ScepError({ message: "SCEP renewal has no signer" }));
          const valid = yield* Effect.tryPromise({
            try: () => signer.verify(ca.caCert),
            catch: (cause) => new ScepError({ message: "Failed to verify renewal signer", cause }),
          });
          if (!valid)
            return yield* Effect.fail(
              new ScepError({ message: "SCEP renewal signer is not issued by this CA" }),
            );
          const serial = certificateSerialHex(signer);
          const issued = repo.findIssuedCertificate
            ? yield* repo.findIssuedCertificate(serial)
            : null;
          if (repo.findIssuedCertificate && (!issued || issued.notAfter <= new Date())) {
            return yield* Effect.fail(
              new ScepError({ message: "SCEP renewal certificate is unknown or expired" }),
            );
          }
          const ou = signer.subject.typesAndValues.find((item) => item.type === "2.5.4.11");
          const value = issued?.organizationId
            ? issued.organizationId
            : ou
              ? ((ou.value.valueBlock as { value?: string }).value ?? undefined)
              : undefined;
          authentication = value
            ? { organizationalUnit: value, enrollmentId: issued?.enrollmentId }
            : undefined;
        } else {
          // Allow repository to authenticate/validate the incoming request before issuance.
          const authenticated = yield* repo
            .authenticatePkcsReq(req)
            .pipe(Effect.match({ onFailure: () => null, onSuccess: (value) => value ?? {} }));
          if (authenticated === null) {
            return yield* Effect.tryPromise({
              try: () =>
                buildScepCertFailure(ca.caCert, ca.privateKey, req.transactionId, req.senderNonce),
              catch: (cause) =>
                new ScepError({ message: "Failed to build SCEP failure response", cause }),
            });
          }
          authentication = authenticated;
        }

        // Allow ten minutes of clock skew between the CA and device, matching
        // Fleet and common SCEP clients.
        const notBefore = new Date(Date.now() - 10 * 60 * 1000);
        const notAfter = new Date(notBefore.getTime() + 365 * 24 * 60 * 60 * 1000);
        const serial = Math.floor(Math.random() * 0x7fffffff);

        const publicKey = yield* Effect.tryPromise({
          try: () => req.csr.getPublicKey(),
          catch: (cause) =>
            new ScepError({ message: "Failed to extract public key from CSR", cause }),
        });

        const subject: Array<{ type: string; value: string }> = [];
        for (const rdn of req.csr.subject.typesAndValues) {
          const val = rdn.value.valueBlock as any;
          if (typeof val.value === "string") {
            subject.push({ type: rdn.type, value: val.value });
          }
        }
        if (!subject.some((item) => item.type === "2.5.4.3"))
          subject.push({ type: "2.5.4.3", value: "device" });
        // Pin the certificate to the authenticated tenant. This mirrors mttx's
        // SCEP challenge middleware, which overwrites the CSR subject OU with the
        // tenant id resolved from the challenge.
        const organizationalUnit =
          authentication && typeof authentication === "object"
            ? authentication.organizationalUnit
            : undefined;
        if (organizationalUnit) {
          const filtered = subject.filter((item) => item.type !== "2.5.4.11");
          filtered.push({ type: "2.5.4.11", value: organizationalUnit });
          subject.length = 0;
          subject.push(...filtered);
        }

        const deviceCert = yield* Effect.tryPromise({
          try: () =>
            createDeviceCertificate(serial, subject, publicKey, ca.caCert, ca.privateKey, {
              notBefore,
              notAfter,
            }),
          catch: (cause) =>
            new ScepError({ message: "Failed to create device certificate", cause }),
        });
        if (repo.recordIssuedCertificate && authentication?.organizationalUnit) {
          yield* repo.recordIssuedCertificate({
            serial: certificateSerialHex(deviceCert),
            organizationId: authentication.organizationalUnit,
            enrollmentId: authentication.enrollmentId,
            notAfter,
          });
        }

        const response = yield* Effect.tryPromise({
          try: () =>
            buildScepCertRep(
              deviceCert,
              ca.caCert,
              ca.privateKey,
              req.transactionId,
              req.senderNonce,
              req.signerCerts,
            ),
          catch: (cause) => new ScepError({ message: "Failed to build SCEP CertRep", cause }),
        });

        return response;
      });

    return ScepServiceTag.of({
      getCaCaps,
      getCaCert,
      pkiOperation,
    });
  }),
);
