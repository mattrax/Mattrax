import assert from "node:assert/strict";
import { Effect } from "effect";
import * as pkijs from "pkijs";
import { ScepError } from "@mattrax/scep";
import type { Check } from "../types.ts";
import { createScepHarness, scepGet, scepPost } from "../harness/scep.ts";
import {
  buildPkcsReq,
  certificateValue,
  createCsr,
  createSelfSignedCertificate,
  decryptCertRep,
  generateKeyPair,
  issueIdentity,
  parseCertRep,
} from "../fixtures/pki.ts";

const check = (
  id: string,
  category: Check["category"],
  name: string,
  description: string,
  run: Check["run"],
  dayN = false,
): Check => ({
  id: `scep.${id}`,
  platform: "scep",
  category,
  name,
  description,
  ...(dayN ? { dayN: true } : {}),
  run,
});

const nonce = () => crypto.getRandomValues(new Uint8Array(16));

const sameBytes = (left: ArrayBuffer | undefined, right: Uint8Array): boolean => {
  if (!left) return false;
  const a = new Uint8Array(left);
  return a.length === right.length && a.every((byte, index) => byte === right[index]);
};

export const scepChecks: ReadonlyArray<Check> = [
  check(
    "caps",
    "enrollment",
    "GetCACaps advertises the supported SCEP capabilities",
    "Clients choose POST PKIOperation, SHA-256 and AES based on this list.",
    async () => {
      const harness = await createScepHarness();
      const response = await harness.handler(scepGet("GetCACaps"));
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/plain/);
      const caps = (await response.text()).split(/\r?\n/);
      for (const capability of ["Renewal", "SCEPStandard", "SHA-256", "AES", "POSTPKIOperation"])
        assert.ok(caps.includes(capability), `missing capability ${capability}`);
    },
  ),
  check(
    "ca-cert",
    "certificates",
    "GetCACert returns a DER CA certificate",
    "A single CA must be served as application/x-x509-ca-cert with a parseable X.509 certificate.",
    async () => {
      const harness = await createScepHarness();
      const response = await harness.handler(scepGet("GetCACert"));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/x-x509-ca-cert");
      const der = await response.arrayBuffer();
      const certificate = pkijs.Certificate.fromBER(der);
      assert.equal(certificateValue(certificate, "2.5.4.3"), "Compliance SCEP CA");
      assert.deepEqual(
        new Uint8Array(der),
        new Uint8Array(harness.state.ca.cert.toSchema().toBER(false)),
      );
      assert.equal(harness.state.saveCount, 0);
    },
  ),
  check(
    "caps-invalid-operation",
    "errors",
    "Unknown SCEP GET operation is rejected",
    "Only GetCACaps and GetCACert are supported by this single-CA endpoint.",
    async () => {
      const harness = await createScepHarness();
      const response = await harness.handler(scepGet("GetNextCACert"));
      assert.equal(response.status, 400);
    },
  ),
  check(
    "pkcsreq.issue",
    "certificates",
    "PKCSReq issues a certificate bound to the authenticated tenant",
    "A successful CertRep must be signed by the CA, echo transactionID and senderNonce, and pin the subject OU to the authenticated tenant.",
    async () => {
      const harness = await createScepHarness({
        authenticate: () =>
          Effect.succeed({
            organizationalUnit: "tenant-authenticated",
            enrollmentId: "enrollment-1",
          }),
      });
      const deviceKeys = await generateKeyPair();
      const signer = await createSelfSignedCertificate(deviceKeys, "Compliance Device");
      const csr = await createCsr(deviceKeys, {
        commonName: "Compliance Device",
        organizationalUnit: "spoofed-tenant",
      });
      const senderNonce = nonce();
      const request = await buildPkcsReq({
        csr,
        caCert: harness.state.ca.cert,
        signerCert: signer,
        signerPrivateKey: deviceKeys.privateKey,
        transactionId: "txn-issue-1",
        senderNonce,
      });
      const response = await harness.handler(scepPost(request));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/x-pki-message");
      const certRep = await parseCertRep(await response.arrayBuffer());
      assert.equal(certRep.messageType, "3");
      assert.equal(certRep.pkiStatus, "0");
      assert.equal(certRep.failInfo, undefined);
      assert.equal(certRep.transactionId, "txn-issue-1");
      assert.ok(sameBytes(certRep.recipientNonce, senderNonce));
      assert.equal(certRep.signerVerified, true);
      assert.equal(certRep.certificates.length, 2);
      const deviceJwk = (await crypto.subtle.exportKey("jwk", deviceKeys.privateKey)) as JsonWebKey;
      const issued = await decryptCertRep(certRep, deviceJwk);
      assert.equal(certificateValue(issued, "2.5.4.3"), "Compliance Device");
      assert.equal(certificateValue(issued, "2.5.4.11"), "tenant-authenticated");
      assert.equal(await issued.verify(harness.state.ca.cert), true);
      assert.equal(harness.state.recorded.length, 1);
      assert.equal(harness.state.recorded[0]?.organizationId, "tenant-authenticated");
      assert.equal(harness.state.recorded[0]?.enrollmentId, "enrollment-1");
    },
  ),
  check(
    "pkcsreq.auth-failure",
    "errors",
    "Rejected challenge returns an in-protocol failure CertRep",
    "SCEP authentication failures must be represented as pkiStatus=2 with failInfo and no issued certificate.",
    async () => {
      const harness = await createScepHarness({
        authenticate: () => Effect.fail(new ScepError({ message: "Challenge is invalid" })),
      });
      const deviceKeys = await generateKeyPair();
      const signer = await createSelfSignedCertificate(deviceKeys, "Device");
      const csr = await createCsr(deviceKeys, { commonName: "Device", challengePassword: "wrong" });
      const senderNonce = nonce();
      const request = await buildPkcsReq({
        csr,
        caCert: harness.state.ca.cert,
        signerCert: signer,
        signerPrivateKey: deviceKeys.privateKey,
        transactionId: "txn-auth-failure",
        senderNonce,
      });
      const response = await harness.handler(scepPost(request));
      assert.equal(response.status, 200);
      const certRep = await parseCertRep(await response.arrayBuffer());
      assert.equal(certRep.messageType, "3");
      assert.equal(certRep.pkiStatus, "2");
      assert.equal(certRep.failInfo, "2");
      assert.equal(certRep.transactionId, "txn-auth-failure");
      assert.ok(sameBytes(certRep.recipientNonce, senderNonce));
      assert.equal(harness.state.recorded.length, 0);
    },
  ),
  check(
    "pkcsreq.bad-signature",
    "errors",
    "Bad CSR signature does not issue a certificate",
    "The CSR signature must be verified before issuance; failures must be a failure CertRep.",
    async () => {
      const harness = await createScepHarness();
      const deviceKeys = await generateKeyPair();
      const signer = await createSelfSignedCertificate(deviceKeys, "Device");
      const csr = await createCsr(deviceKeys, { commonName: "Device" });
      const validDer = csr.toSchema().toBER(false);
      const corrupted = new Uint8Array(validDer.slice(0));
      // Corrupt the CSR signature while keeping the outer CMS signature valid.
      corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 0xff;
      const request = await buildPkcsReq({
        csr,
        csrDer: corrupted.buffer,
        caCert: harness.state.ca.cert,
        signerCert: signer,
        signerPrivateKey: deviceKeys.privateKey,
        transactionId: "txn-bad-signature",
        senderNonce: nonce(),
      });
      const response = await harness.handler(scepPost(request));
      assert.equal(response.status, 200);
      const certRep = await parseCertRep(await response.arrayBuffer());
      assert.equal(certRep.pkiStatus, "2");
      assert.equal(certRep.failInfo, "1");
      assert.equal(harness.state.recorded.length, 0);
    },
  ),
  check(
    "pkcsreq.malformed",
    "errors",
    "Non-CMS PKCSReq is rejected at the transport layer",
    "A body that is not a CMS SignedData cannot be processed and must return HTTP 400, not 500.",
    async () => {
      const harness = await createScepHarness();
      const response = await harness.handler(
        scepPost(new TextEncoder().encode("this is not a SCEP message").buffer),
      );
      assert.equal(response.status, 400);
    },
  ),
  check(
    "renewal.success",
    "day-n",
    "RenewalReq issues a replacement certificate",
    "A valid messageType=17 signed by an issued identity must receive a new certificate linked to the same device.",
    async () => {
      const harness = await createScepHarness();
      const identity = await issueIdentity({
        ca: harness.state.ca,
        commonName: "Renewing Device",
        organizationalUnit: "tenant-authenticated",
      });
      harness.state.issued.set(identity.serial, {
        serial: identity.serial,
        organizationId: "tenant-authenticated",
        enrollmentId: "enrollment-1",
        deviceId: "device-1",
        notAfter: new Date(Date.now() + 86_400_000),
      });
      const csr = await createCsr(identity.keyPair, {
        commonName: "Renewing Device",
        organizationalUnit: "tenant-authenticated",
      });
      const senderNonce = nonce();
      const request = await buildPkcsReq({
        csr,
        caCert: harness.state.ca.cert,
        signerCert: identity.certificate,
        signerPrivateKey: identity.keyPair.privateKey,
        transactionId: "txn-renewal-1",
        senderNonce,
        encryptCsr: false,
        messageType: "17",
      });
      const response = await harness.handler(scepPost(request));
      assert.equal(response.status, 200);
      const certRep = await parseCertRep(await response.arrayBuffer());
      assert.equal(certRep.pkiStatus, "0");
      assert.equal(certRep.transactionId, "txn-renewal-1");
      const deviceJwk = (await crypto.subtle.exportKey(
        "jwk",
        identity.keyPair.privateKey,
      )) as JsonWebKey;
      const renewed = await decryptCertRep(certRep, deviceJwk);
      assert.notEqual(
        renewed.serialNumber.valueBlock.valueHexView
          ? Buffer.from(renewed.serialNumber.valueBlock.valueHexView).toString("hex")
          : "",
        identity.serial,
      );
      assert.equal(certificateValue(renewed, "2.5.4.11"), "tenant-authenticated");
      assert.equal(await renewed.verify(harness.state.ca.cert), true);
      assert.equal(harness.state.recorded.length, 1);
      assert.equal(harness.state.recorded[0]?.deviceId, "device-1");
      assert.equal(harness.state.recorded[0]?.enrollmentId, "enrollment-1");
      assert.equal(harness.state.recorded[0]?.organizationId, "tenant-authenticated");
    },
    true,
  ),
  check(
    "renewal.unknown-identity",
    "day-n",
    "Renewal of an unknown or expired identity fails in-protocol",
    "A deleted or expired identity must receive a failure CertRep and no new certificate.",
    async () => {
      const harness = await createScepHarness();
      const identity = await issueIdentity({
        ca: harness.state.ca,
        commonName: "Unknown Device",
        organizationalUnit: "tenant-authenticated",
      });
      const csr = await createCsr(identity.keyPair, { commonName: "Unknown Device" });
      const request = await buildPkcsReq({
        csr,
        caCert: harness.state.ca.cert,
        signerCert: identity.certificate,
        signerPrivateKey: identity.keyPair.privateKey,
        transactionId: "txn-renewal-unknown",
        senderNonce: nonce(),
        encryptCsr: false,
        messageType: "17",
      });
      const response = await harness.handler(scepPost(request));
      assert.equal(response.status, 200);
      const certRep = await parseCertRep(await response.arrayBuffer());
      assert.equal(certRep.pkiStatus, "2");
      assert.equal(certRep.failInfo, "4");
      assert.equal(harness.state.recorded.length, 0);
    },
    true,
  ),
  check(
    "renewal.foreign-signer",
    "day-n",
    "Renewal signed by a foreign certificate is rejected",
    "Only a certificate chained to this CA may authenticate a renewal.",
    async () => {
      const harness = await createScepHarness();
      const foreign = await generateKeyPair();
      const foreignCert = await createSelfSignedCertificate(foreign, "Foreign Device");
      const csr = await createCsr(foreign, { commonName: "Foreign Device" });
      const request = await buildPkcsReq({
        csr,
        caCert: harness.state.ca.cert,
        signerCert: foreignCert,
        signerPrivateKey: foreign.privateKey,
        transactionId: "txn-renewal-foreign",
        senderNonce: nonce(),
        encryptCsr: false,
        messageType: "17",
      });
      const response = await harness.handler(scepPost(request));
      assert.equal(response.status, 200);
      const certRep = await parseCertRep(await response.arrayBuffer());
      assert.equal(certRep.pkiStatus, "2");
      assert.equal(certRep.failInfo, "1");
      assert.equal(harness.state.recorded.length, 0);
    },
    true,
  ),
  check(
    "ca.reuse",
    "certificates",
    "Existing CA material is reused across operations",
    "The CA must not be regenerated during normal operation, otherwise previously issued identities become invalid.",
    async () => {
      const harness = await createScepHarness();
      const first = await harness.handler(scepGet("GetCACert"));
      await first.arrayBuffer();
      const second = await harness.handler(scepGet("GetCACert"));
      const secondDer = await second.arrayBuffer();
      assert.equal(harness.state.saveCount, 0);
      const again = pkijs.Certificate.fromBER(secondDer);
      assert.deepEqual(
        new Uint8Array(again.toSchema().toBER(false)),
        new Uint8Array(harness.state.ca.cert.toSchema().toBER(false)),
      );
    },
  ),
];
