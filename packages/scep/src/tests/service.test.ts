import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import * as pkijs from "pkijs";
import * as asn1js from "asn1js";
import { ScepService, ScepServiceTag } from "../service.js";
import {
  ScepRepository,
  type ScepCaScope,
  type ScepIssuedCertificate,
  type ScepStoredCa,
} from "../repository.js";
import { ScepError } from "../schema.js";
import { certificateSerialHex, certToPem, createDeviceCertificate } from "../pkcs7.js";
import { describeScepCa } from "../ca.js";
import {
  generateKeyPair,
  createTestCaCert,
  createTestSignerCert,
  buildTestCsr,
  buildPkcsReq,
  mockScepRepository,
} from "./helpers.js";

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
  }
}

const scope: ScepCaScope = { organizationId: "tenant-1" };

function attributeText(attribute: pkijs.AttributeTypeAndValue | undefined): string | undefined {
  if (!attribute || !(attribute.value instanceof asn1js.Utf8String)) return undefined;

  return attribute.value.valueBlock.value;
}

function printableAttributeValue(attributes: Map<string, pkijs.Attribute>, oid: string): string {
  const attribute = attributes.get(oid);

  if (!attribute) throw new Error(`Missing SCEP attribute ${oid}`);

  const value = attribute.values[0];

  if (!(value instanceof asn1js.PrintableString))
    throw new Error(`SCEP attribute ${oid} is not a PrintableString`);

  return value.valueBlock.value;
}

function runWithService<A, E>(
  repoLayer: Layer.Layer<ScepRepository>,
  effect: Effect.Effect<A, E, ScepServiceTag>,
) {
  const layer = ScepService.pipe(Layer.provide(repoLayer));

  return effect.pipe(Effect.provide(layer), Effect.runPromise);
}

const makeCa = async (commonName: string): Promise<ScepStoredCa> => {
  const keyPair = await generateKeyPair();
  const caCert = await createTestCaCert(keyPair, commonName);

  return {
    certPem: certToPem(caCert),
    privateKeyJwk: await crypto.subtle.exportKey("jwk", keyPair.privateKey),
  };
};

const caCertDer = (certPem: string) => {
  const base64 = certPem
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s/g, "");

  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
};

describe("ScepService", () => {
  describe("getCaCaps", () => {
    it("returns the expected capability string", async () => {
      const repo = mockScepRepository();

      const caps = await runWithService(
        repo,
        Effect.gen(function* () {
          const scep = yield* ScepServiceTag;

          return yield* scep.getCaCaps();
        }),
      );

      expect(caps).toContain("SHA-256");
      expect(caps).toContain("AES");
      expect(caps).toContain("POSTPKIOperation");
    });
  });

  describe("getCaCert", () => {
    it("bootstraps and persists a tenant CA when none exists", async () => {
      let saved: ScepStoredCa | undefined;

      const repo = mockScepRepository({
        getCa: () => Effect.succeed(null),
        saveCa: (_scope, ca) =>
          Effect.sync(() => {
            saved = ca;

            return ca;
          }),
      });

      const result = await runWithService(
        repo,
        Effect.gen(function* () {
          const scep = yield* ScepServiceTag;

          return yield* scep.getCaCert(scope);
        }),
      );

      expect(result.raw.byteLength).toBeGreaterThan(0);
      expect(result.isPkcs7).toBe(false);
      expect(saved?.certPem).toContain("BEGIN CERTIFICATE");
      expect(saved?.privateKeyJwk.kty).toBe("RSA");
      expect(saved?.source).toBe("generated");
    });

    it("uses the CA persisted by a concurrent bootstrap instead of its own", async () => {
      const winner = await makeCa("Winner CA");

      const repo = mockScepRepository({
        getCa: () => Effect.succeed(null),
        // Simulate losing the insert race: another request persisted first.
        saveCa: () => Effect.succeed(winner),
      });

      const result = await runWithService(
        repo,
        Effect.gen(function* () {
          const scep = yield* ScepServiceTag;

          return yield* scep.getCaCert(scope);
        }),
      );

      expect(new Uint8Array(result.raw)).toEqual(caCertDer(winner.certPem));
    });

    it("reuses an existing valid CA", async () => {
      const ca = await makeCa("Reuse CA");
      let saveCount = 0;

      const repo = mockScepRepository({
        getCa: () => Effect.succeed(ca),
        saveCa: () =>
          Effect.sync(() => {
            saveCount++;

            return ca;
          }),
      });

      const result = await runWithService(
        repo,
        Effect.gen(function* () {
          const scep = yield* ScepServiceTag;

          return yield* scep.getCaCert(scope);
        }),
      );

      expect(result.raw.byteLength).toBeGreaterThan(0);
      expect(saveCount).toBe(0);
    });

    it("resolves a different CA per tenant", async () => {
      const tenantA = await makeCa("Tenant A CA");
      const tenantB = await makeCa("Tenant B CA");

      const repo = mockScepRepository({
        getCa: (caScope) =>
          Effect.succeed(caScope.organizationId === "tenant-a" ? tenantA : tenantB),
      });

      const read = (organizationId: string) =>
        runWithService(
          repo,
          Effect.gen(function* () {
            const scep = yield* ScepServiceTag;

            return yield* scep.getCaCert({ organizationId });
          }),
        );

      expect(new Uint8Array((await read("tenant-a")).raw)).toEqual(caCertDer(tenantA.certPem));
      expect(new Uint8Array((await read("tenant-b")).raw)).toEqual(caCertDer(tenantB.certPem));
    });

    it("fails closed when the stored CA cannot be parsed instead of replacing it", async () => {
      let saveCount = 0;

      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem: "invalid-pem", privateKeyJwk: {} }),
        saveCa: (_scope, ca) =>
          Effect.sync(() => {
            saveCount++;

            return ca;
          }),
      });

      await expect(
        runWithService(
          repo,
          Effect.gen(function* () {
            const scep = yield* ScepServiceTag;

            return yield* scep.getCaCert(scope);
          }),
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining("invalid") });
      // Generating a replacement here would invalidate every device identity.
      expect(saveCount).toBe(0);
    });

    it("does not regenerate the CA when the stored key cannot be opened", async () => {
      let saveCount = 0;

      const repo = mockScepRepository({
        getCa: () =>
          Effect.fail(
            new ScepError({ message: "Failed to decrypt the stored SCEP CA private key" }),
          ),
        saveCa: (_scope, ca) =>
          Effect.sync(() => {
            saveCount++;

            return ca;
          }),
      });

      await expect(
        runWithService(
          repo,
          Effect.gen(function* () {
            const scep = yield* ScepServiceTag;

            return yield* scep.getCaCert(scope);
          }),
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining("decrypt") });
      // Issuing a fresh CA here would invalidate every existing device identity.
      expect(saveCount).toBe(0);
    });
  });

  describe("pkiOperation", () => {
    const makePkcsReq = async (transactionId = "txn-001") => {
      const caKeyPair = await generateKeyPair();
      const caCert = await createTestCaCert(caKeyPair, "Test CA");
      const caCertPem = certToPem(caCert);
      const caPrivateKeyJwk = await crypto.subtle.exportKey("jwk", caKeyPair.privateKey);

      const deviceKeyPair = await generateKeyPair();
      const signerCert = await createTestSignerCert(deviceKeyPair, "Device");
      const csr = await buildTestCsr(deviceKeyPair, "Device");
      const senderNonce = crypto.getRandomValues(new Uint8Array(16));

      const pkcsReq = await buildPkcsReq(
        csr,
        caCert,
        signerCert,
        deviceKeyPair.privateKey,
        transactionId,
        senderNonce,
        true,
      );

      return { caCert, caCertPem, caPrivateKeyJwk, deviceKeyPair, pkcsReq };
    };

    it("issues a device certificate from a valid PKCSReq", async () => {
      const { caCertPem, caPrivateKeyJwk, pkcsReq } = await makePkcsReq();
      let authenticated = false;

      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem: caCertPem, privateKeyJwk: caPrivateKeyJwk }),
        authenticatePkcsReq: () =>
          Effect.sync(() => {
            authenticated = true;

            return { organizationalUnit: scope.organizationId };
          }),
      });

      const response = await runWithService(
        repo,
        Effect.gen(function* () {
          const scep = yield* ScepServiceTag;

          return yield* scep.pkiOperation(scope, pkcsReq);
        }),
      );

      expect(response.byteLength).toBeGreaterThan(0);
      expect(authenticated).toBe(true);

      // Verify outer SignedData
      const contentInfo = pkijs.ContentInfo.fromBER(response);
      expect(contentInfo.contentType).toBe(pkijs.ContentInfo.SIGNED_DATA);
      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      expect(signedData.certificates).toBeDefined();
      expect(signedData.certificates!.length).toBe(2); // device + CA
    });

    it("returns a failure CertRep when authenticatePkcsReq fails", async () => {
      const { caCertPem, caPrivateKeyJwk, pkcsReq } = await makePkcsReq("txn-002");

      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem: caCertPem, privateKeyJwk: caPrivateKeyJwk }),
        authenticatePkcsReq: () => Effect.fail(new ScepError({ message: "Authentication failed" })),
      });

      const result = await runWithService(
        repo,
        Effect.gen(function* () {
          const scep = yield* ScepServiceTag;

          return yield* scep.pkiOperation(scope, pkcsReq);
        }),
      );

      expect(result.byteLength).toBeGreaterThan(0);
    });

    it("rejects a challenge authenticated for another tenant", async () => {
      const { caCertPem, caPrivateKeyJwk, pkcsReq } = await makePkcsReq("txn-foreign");

      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem: caCertPem, privateKeyJwk: caPrivateKeyJwk }),
        authenticatePkcsReq: () =>
          Effect.succeed({ organizationalUnit: "tenant-2", enrollmentId: "enrollment-2" }),
      });

      const result = await runWithService(
        repo,
        Effect.gen(function* () {
          const scep = yield* ScepServiceTag;

          return yield* scep.pkiOperation(scope, pkcsReq);
        }),
      );

      const parsed = asn1js.fromBER(result);
      const signedData = new pkijs.SignedData({ schema: parsed.result });

      const attributes = new Map(
        signedData.signerInfos[0]!.signedAttrs!.attributes.map((attribute) => [
          attribute.type,
          attribute,
        ]),
      );

      expect(printableAttributeValue(attributes, "2.16.840.1.113733.1.9.3")).toBe("2");
      expect(printableAttributeValue(attributes, "2.16.840.1.113733.1.9.4")).toBe("2");
    });

    it("pins the subject OU to the tenant even when the CSR asks for another", async () => {
      const { caCertPem, caPrivateKeyJwk, pkcsReq } = await makePkcsReq("txn-ou");

      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem: caCertPem, privateKeyJwk: caPrivateKeyJwk }),
        authenticatePkcsReq: () => Effect.succeed({ organizationalUnit: scope.organizationId }),
      });

      const response = await runWithService(
        repo,
        Effect.gen(function* () {
          const scep = yield* ScepServiceTag;

          return yield* scep.pkiOperation(scope, pkcsReq);
        }),
      );

      const contentInfo = pkijs.ContentInfo.fromBER(response);
      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      const deviceCert = signedData.certificates?.[0];

      if (!(deviceCert instanceof pkijs.Certificate))
        throw new Error("response did not contain a certificate");

      const ou = deviceCert.subject.typesAndValues.find(
        (attribute) => attribute.type === "2.5.4.11",
      );

      expect(attributeText(ou)).toBe("tenant-1");
    });

    it("extracts the CN from the CSR as the subject", async () => {
      const caKeyPair = await generateKeyPair();
      const caCert = await createTestCaCert(caKeyPair, "Test CA");
      const caCertPem = certToPem(caCert);
      const caPrivateKeyJwk = await crypto.subtle.exportKey("jwk", caKeyPair.privateKey);

      const deviceKeyPair = await generateKeyPair();
      const signerCert = await createTestSignerCert(deviceKeyPair, "Device");
      const csr = await buildTestCsr(deviceKeyPair, "MyTestDevice");
      const senderNonce = crypto.getRandomValues(new Uint8Array(16));

      const pkcsReq = await buildPkcsReq(
        csr,
        caCert,
        signerCert,
        deviceKeyPair.privateKey,
        "txn-003",
        senderNonce,
        true,
      );

      const repo = mockScepRepository({
        getCa: () => Effect.succeed({ certPem: caCertPem, privateKeyJwk: caPrivateKeyJwk }),
        authenticatePkcsReq: () => Effect.succeed({ organizationalUnit: scope.organizationId }),
      });

      const response = await runWithService(
        repo,
        Effect.gen(function* () {
          const scep = yield* ScepServiceTag;

          return yield* scep.pkiOperation(scope, pkcsReq);
        }),
      );

      const contentInfo = pkijs.ContentInfo.fromBER(response);
      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      const deviceCert = signedData.certificates?.[0];

      if (!(deviceCert instanceof pkijs.Certificate))
        throw new Error("response did not contain a certificate");

      const cnAttr = deviceCert.subject.typesAndValues.find((a) => a.type === "2.5.4.3");
      expect(attributeText(cnAttr)).toBe("MyTestDevice");
    });

    const renewalFixture = async () => {
      const caKeyPair = await generateKeyPair();
      const caCert = await createTestCaCert(caKeyPair, "Test CA");
      const caCertPem = certToPem(caCert);
      const caPrivateKeyJwk = await crypto.subtle.exportKey("jwk", caKeyPair.privateKey);

      const deviceKeyPair = await generateKeyPair();
      const now = new Date();

      const identity = await createDeviceCertificate(
        1,
        [{ type: "2.5.4.3", value: "Device" }],
        deviceKeyPair.publicKey,
        caCert,
        caKeyPair.privateKey,
        {
          notBefore: new Date(now.getTime() - 60_000),
          notAfter: new Date(now.getTime() + 86_400_000),
        },
      );

      const identitySerial = certificateSerialHex(identity);
      const csr = await buildTestCsr(deviceKeyPair, "Device");
      const senderNonce = crypto.getRandomValues(new Uint8Array(16));

      const renewal = await buildPkcsReq(
        csr,
        caCert,
        identity,
        deviceKeyPair.privateKey,
        "txn-renewal",
        senderNonce,
        false,
        "17",
      );

      return { caCertPem, caPrivateKeyJwk, identitySerial, renewal };
    };

    it("keeps deviceId on renewed certificates so they remain revocable", async () => {
      const fixture = await renewalFixture();
      const recorded: Array<ScepIssuedCertificate> = [];

      const repo = mockScepRepository({
        getCa: () =>
          Effect.succeed({
            certPem: fixture.caCertPem,
            privateKeyJwk: fixture.caPrivateKeyJwk,
          }),
        findIssuedCertificate: (caScope, serial) =>
          Effect.succeed(
            caScope.organizationId === scope.organizationId && serial === fixture.identitySerial
              ? {
                  serial,
                  organizationId: "tenant-1",
                  enrollmentId: "enrollment-1",
                  deviceId: "device-1",
                  notAfter: new Date(Date.now() + 86_400_000),
                }
              : null,
          ),
        recordIssuedCertificate: (certificate) =>
          Effect.sync(() => {
            recorded.push(certificate);
          }),
      });

      const response = await runWithService(
        repo,
        Effect.gen(function* () {
          const scep = yield* ScepServiceTag;

          return yield* scep.pkiOperation(scope, fixture.renewal);
        }),
      );

      expect(response.byteLength).toBeGreaterThan(0);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        organizationId: "tenant-1",
        enrollmentId: "enrollment-1",
        deviceId: "device-1",
      });
    });

    describe("after a staged CA rotation", () => {
      const rotationFixture = async () => {
        const oldKeyPair = await generateKeyPair();
        const oldCaCert = await createTestCaCert(oldKeyPair, "Retired CA");
        const newKeyPair = await generateKeyPair();
        const newCaCert = await createTestCaCert(newKeyPair, "Current CA");

        const oldCa: ScepStoredCa = {
          certPem: certToPem(oldCaCert),
          privateKeyJwk: await crypto.subtle.exportKey("jwk", oldKeyPair.privateKey),
        };

        const newCa: ScepStoredCa = {
          certPem: certToPem(newCaCert),
          privateKeyJwk: await crypto.subtle.exportKey("jwk", newKeyPair.privateKey),
        };

        const deviceKeyPair = await generateKeyPair();
        const now = Date.now();

        const identity = await createDeviceCertificate(
          1,
          [
            { type: "2.5.4.3", value: "Device" },
            { type: "2.5.4.11", value: scope.organizationId },
          ],
          deviceKeyPair.publicKey,
          oldCaCert,
          oldKeyPair.privateKey,
          {
            notBefore: new Date(now - 60_000),
            notAfter: new Date(now + 30 * 24 * 60 * 60 * 1000),
          },
        );

        const csr = await buildTestCsr(deviceKeyPair, "Device");

        const renewal = await buildPkcsReq(
          csr,
          newCaCert,
          identity,
          deviceKeyPair.privateKey,
          "txn-renewal-rotation",
          crypto.getRandomValues(new Uint8Array(16)),
          false,
          "17",
        );

        return {
          oldCa,
          newCa,
          oldCaCert,
          newCaCert,
          identitySerial: certificateSerialHex(identity),
          renewal,
        };
      };

      const certificateFrom = (response: ArrayBuffer) => {
        const contentInfo = pkijs.ContentInfo.fromBER(response);
        const signedData = new pkijs.SignedData({ schema: contentInfo.content });

        // The CA certificate in the CMS is self-signed; the identity is not.
        const issued = signedData.certificates?.find(
          (certificate): certificate is pkijs.Certificate =>
            certificate instanceof pkijs.Certificate &&
            !certificate.issuer.isEqual(certificate.subject),
        );

        if (!issued) throw new Error("response did not contain the renewed certificate");

        return issued;
      };

      it("renews with the existing identity and issues from the current CA", async () => {
        const fixture = await rotationFixture();
        const recorded: Array<ScepIssuedCertificate> = [];

        const oldFingerprint = (await Effect.runPromise(describeScepCa(fixture.oldCa.certPem)))
          .fingerprintSha256;

        const repo = mockScepRepository({
          getCa: () => Effect.succeed(fixture.newCa),
          // Both the successor and the CA that issued the existing identity are
          // live trust anchors during the overlap.
          trustedCaCertificates: () =>
            Effect.succeed([fixture.newCa.certPem, fixture.oldCa.certPem]),
          findIssuedCertificate: (_scope, serial) =>
            Effect.succeed(
              serial === fixture.identitySerial
                ? {
                    serial,
                    organizationId: scope.organizationId,
                    enrollmentId: "enrollment-1",
                    deviceId: "device-1",
                    caFingerprintSha256: oldFingerprint,
                    notAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                  }
                : null,
            ),
          recordIssuedCertificate: (certificate) =>
            Effect.sync(() => {
              recorded.push(certificate);
            }),
        });

        const response = await runWithService(
          repo,
          Effect.gen(function* () {
            const scep = yield* ScepServiceTag;

            return yield* scep.pkiOperation(scope, fixture.renewal);
          }),
        );

        const issued = certificateFrom(response);

        // The renewed identity chains to the successor CA, not the retired one.
        expect(await issued.verify(fixture.newCaCert)).toBe(true);
        expect(await issued.verify(fixture.oldCaCert).catch(() => false)).toBe(false);
        expect(issued.issuer.isEqual(fixture.newCaCert.subject)).toBe(true);

        // The device stays linked, and the record names the CA that signed it so
        // the overlap can be audited.
        const currentFingerprint = (await Effect.runPromise(describeScepCa(fixture.newCa.certPem)))
          .fingerprintSha256;

        expect(recorded).toHaveLength(1);
        expect(recorded[0]).toMatchObject({
          organizationId: scope.organizationId,
          deviceId: "device-1",
          enrollmentId: "enrollment-1",
          caFingerprintSha256: currentFingerprint,
        });
      });

      it("refuses the renewal once the issuing CA is no longer trusted", async () => {
        const fixture = await rotationFixture();

        const repo = mockScepRepository({
          getCa: () => Effect.succeed(fixture.newCa),
          // The overlap has closed: only the current CA is trusted.
          trustedCaCertificates: () => Effect.succeed([fixture.newCa.certPem]),
          findIssuedCertificate: () => Effect.succeed(null),
          recordIssuedCertificate: () => Effect.void,
        });

        const response = await runWithService(
          repo,
          Effect.gen(function* () {
            const scep = yield* ScepServiceTag;

            return yield* scep.pkiOperation(scope, fixture.renewal);
          }),
        );

        const parsed = asn1js.fromBER(response);
        const signedData = new pkijs.SignedData({ schema: parsed.result });

        const attributes = new Map(
          signedData.signerInfos[0]!.signedAttrs!.attributes.map((attribute) => [
            attribute.type,
            attribute,
          ]),
        );

        expect(printableAttributeValue(attributes, "2.16.840.1.113733.1.9.3")).toBe("2");
        expect(printableAttributeValue(attributes, "2.16.840.1.113733.1.9.4")).toBe("1");
      });
    });

    it("cannot renew once the issued identity is gone or the device is unenrolled", async () => {
      const fixture = await renewalFixture();

      const repo = mockScepRepository({
        getCa: () =>
          Effect.succeed({
            certPem: fixture.caCertPem,
            privateKeyJwk: fixture.caPrivateKeyJwk,
          }),
        // The repository rejects deleted/unenrolled devices, which reaches the
        // service as a failed lookup rather than a renewable identity.
        findIssuedCertificate: () => Effect.succeed(null),
        recordIssuedCertificate: () => Effect.void,
      });

      const response = await runWithService(
        repo,
        Effect.gen(function* () {
          const scep = yield* ScepServiceTag;

          return yield* scep.pkiOperation(scope, fixture.renewal);
        }),
      );

      // Renewal failures stay in-protocol as a failure CertRep so the device
      // can distinguish a rejected renewal from a transport outage.
      const parsed = asn1js.fromBER(response);
      const signedData = new pkijs.SignedData({ schema: parsed.result });

      const attributes = new Map(
        signedData.signerInfos[0]!.signedAttrs!.attributes.map((attribute) => [
          attribute.type,
          attribute,
        ]),
      );

      expect(printableAttributeValue(attributes, "2.16.840.1.113733.1.9.3")).toBe("2");
      expect(printableAttributeValue(attributes, "2.16.840.1.113733.1.9.4")).toBe("4");
    });
  });
});
