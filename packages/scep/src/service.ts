import { Context, Effect, Layer, Schema } from "effect";
import type * as pkijs from "pkijs";
import { ScepError } from "./schema.js";
import { ScepRepository } from "./repository.js";
import type { ScepCaScope, ScepIssuedCertificate } from "./repository.js";
import { randomCertificateSerial } from "./crypto.js";
import { certificateFingerprintSha256, ensureScepCa } from "./ca.js";
import {
  parseScepPkcsReq,
  createDeviceCertificate,
  buildScepCertRep,
  buildScepCertFailure,
  certificateSerialHex,
  pemToCert,
} from "./pkcs7.js";

type AttributeValueBlock = { readonly value?: unknown };

function hasAttributeValue(node: unknown): node is AttributeValueBlock {
  return typeof node === "object" && node !== null && "value" in node;
}

function attributeValue(attribute: pkijs.AttributeTypeAndValue): string | undefined {
  const block: unknown = attribute.value.valueBlock;

  if (!hasAttributeValue(block)) return undefined;

  return Schema.is(Schema.String)(block.value) ? block.value : undefined;
}

const SCEP_CAPS = "Renewal\nSCEPStandard\nSHA-256\nSHA-1\nAES\nDES3\nPOSTPKIOperation";

export class ScepServiceTag extends Context.Service<
  ScepServiceTag,
  {
    readonly getCaCaps: () => Effect.Effect<string, ScepError>;
    /**
     * The CA certificate for a tenant. Bootstraps the tenant CA on first use;
     * there is no deployment-wide fallback, so the URL must name a tenant.
     *
     * This is always the *current* CA: a profile fetched after a rotation
     * trusts only its successor, while identities issued by the retired CA keep
     * renewing against the trust anchors in the repository.
     */
    readonly getCaCert: (
      scope: ScepCaScope,
    ) => Effect.Effect<{ raw: ArrayBuffer; isPkcs7: boolean }, ScepError>;
    readonly pkiOperation: (
      scope: ScepCaScope,
      message: ArrayBuffer,
    ) => Effect.Effect<ArrayBuffer, ScepError>;
  }
>()("ScepService") {}

export const ScepService = Layer.effect(
  ScepServiceTag,
  Effect.gen(function* () {
    const repo = yield* ScepRepository;

    const getCaCaps = (): Effect.Effect<string, ScepError> => Effect.succeed(SCEP_CAPS);

    const getCaCert = (
      scope: ScepCaScope,
    ): Effect.Effect<{ raw: ArrayBuffer; isPkcs7: boolean }, ScepError> =>
      Effect.gen(function* () {
        const ca = yield* ensureScepCa(repo, scope);
        // Return raw DER for a single CA cert (Apple expects this)
        const raw = ca.caCert.toSchema().toBER(false);

        return { raw, isPkcs7: false };
      });

    const pkiOperation = (
      scope: ScepCaScope,
      message: ArrayBuffer,
    ): Effect.Effect<ArrayBuffer, ScepError> =>
      Effect.gen(function* () {
        const ca = yield* ensureScepCa(repo, scope);
        const issuedBy = yield* certificateFingerprintSha256(ca.caCert);

        const req = yield* parseScepPkcsReq(message, ca.caCert, ca.privateKeyJwk).pipe(
          Effect.mapError(
            (cause) =>
              new ScepError({
                message: cause.message,
                reason: "invalid_request",
                cause,
              }),
          ),
        );

        const failureCertRep = (failInfo: "1" | "2" | "4" = "2") =>
          Effect.tryPromise({
            try: () =>
              buildScepCertFailure(
                ca.caCert,
                ca.privateKey,
                req.transactionId,
                req.senderNonce,
                failInfo,
              ),
            catch: (cause) =>
              new ScepError({ message: "Failed to build SCEP failure response", cause }),
          });

        const csrValid = yield* Effect.tryPromise({
          try: () => req.csr.verify(),
          catch: (cause) =>
            new ScepError({
              message: "Failed to verify the CSR signature",
              reason: "invalid_request",
              cause,
            }),
        });

        if (!csrValid) return yield* failureCertRep("1");

        // The tenant is authenticated before issuance and must match the tenant
        // in the SCEP URL. A challenge minted for tenant A can never issue an
        // identity from tenant B's CA, even if an attacker swaps the URL.
        let authentication: { organizationalUnit?: string; enrollmentId?: string } | void;

        let issued: ScepIssuedCertificate | null = null;

        if (req.renewal) {
          const signer = req.signerCerts[0];

          if (!signer) return yield* failureCertRep("1");

          // A renewal is authenticated by the certificate being renewed. It may
          // have been issued by the current CA or by a predecessor that is still
          // inside its overlap window, so every live trust anchor is tried.
          const anchors = yield* repo.trustedCaCertificates(scope, new Date());
          const anchorPems = anchors.length > 0 ? anchors : [ca.certPem];

          const valid = yield* Effect.tryPromise({
            try: async () => {
              for (const anchorPem of anchorPems) {
                const anchor = await pemToCert(anchorPem);

                if (await signer.verify(anchor)) return true;
              }

              return false;
            },
            catch: (cause) => new ScepError({ message: "Failed to verify renewal signer", cause }),
          }).pipe(Effect.match({ onFailure: () => false, onSuccess: (value) => value }));

          if (!valid) return yield* failureCertRep("1");

          const signerExpiry = signer.notAfter.value;

          if (signerExpiry.getTime() <= Date.now()) return yield* failureCertRep("4");
          const serial = certificateSerialHex(signer);
          issued = repo.findIssuedCertificate
            ? yield* repo.findIssuedCertificate(scope, serial)
            : null;

          if (repo.findIssuedCertificate && (!issued || issued.notAfter <= new Date()))
            return yield* failureCertRep("4");
          const ou = signer.subject.typesAndValues.find((item) => item.type === "2.5.4.11");

          const value = issued?.organizationId ?? (ou ? attributeValue(ou) : undefined);

          authentication = value
            ? { organizationalUnit: value, enrollmentId: issued?.enrollmentId }
            : undefined;
        } else {
          // Allow repository to authenticate/validate the incoming request before issuance.
          const authenticated = yield* repo
            .authenticatePkcsReq(scope, req)
            .pipe(Effect.match({ onFailure: () => null, onSuccess: (value) => value ?? {} }));

          if (authenticated === null) return yield* failureCertRep("2");
          authentication = authenticated;
        }

        if (authentication?.organizationalUnit !== scope.organizationId)
          return yield* failureCertRep("2");
        // Allow ten minutes of clock skew between the CA and device, matching
        // common SCEP clients. An identity never outlives the CA that signed it:
        // towards the end of a CA's life the remaining overlap clamps the
        // validity instead of issuing certificates the chain cannot support.
        const notBefore = new Date(Date.now() - 10 * 60 * 1000);

        const notAfter = new Date(
          Math.min(
            notBefore.getTime() + 365 * 24 * 60 * 60 * 1000,
            ca.caCert.notAfter.value.getTime(),
          ),
        );

        const serial = randomCertificateSerial();

        const publicKey = yield* Effect.tryPromise({
          try: () => req.csr.getPublicKey(),
          catch: (cause) =>
            new ScepError({ message: "Failed to extract public key from CSR", cause }),
        });

        const subject: Array<{ type: string; value: string }> = [];

        for (const rdn of req.csr.subject.typesAndValues) {
          const value = attributeValue(rdn);

          if (value !== undefined) subject.push({ type: rdn.type, value });
        }

        if (!subject.some((item) => item.type === "2.5.4.3"))
          subject.push({ type: "2.5.4.3", value: "device" });

        // Pin the certificate to the tenant whose CA and URL authenticated this
        // request, regardless of what the CSR requested.
        const filtered = subject.filter((item) => item.type !== "2.5.4.11");

        filtered.push({ type: "2.5.4.11", value: scope.organizationId });
        subject.length = 0;
        subject.push(...filtered);

        const deviceCert = yield* Effect.tryPromise({
          try: () =>
            createDeviceCertificate(serial, subject, publicKey, ca.caCert, ca.privateKey, {
              notBefore,
              notAfter,
            }),
          catch: (cause) =>
            new ScepError({ message: "Failed to create device certificate", cause }),
        });

        if (repo.recordIssuedCertificate) {
          yield* repo.recordIssuedCertificate({
            serial: certificateSerialHex(deviceCert),
            organizationId: scope.organizationId,
            enrollmentId: authentication?.enrollmentId,
            // Renewals must stay linked to the device so revocation, health and
            // the next renewal keep working instead of orphaning the identity.
            deviceId: issued?.deviceId,
            // Which CA signed it. A rotated fleet therefore has an auditable
            // record of when every identity moved to the successor CA.
            caFingerprintSha256: issuedBy,
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
