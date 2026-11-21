import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import * as pkijs from "pkijs";
import { parsePlist } from "@mattrax/plist";
import { pemEncode, toArrayBuffer } from "@mattrax/crypto";
import {
  APPLE_ROOT_CA,
  APPLE_WORLDWIDE_DEVELOPER_RELATIONS_CERTIFICATION_AUTHORITY,
} from "../appleCerts.js";
import { buildApnsCsr, createApnsCsrDer, exportApnsKeyJwk } from "../csr.js";
import { createTestApnsCertificate, createTestApnsKeys } from "./helpers.js";

const CsrPlist = Schema.Struct({
  PushCertCertificateChain: Schema.String,
  PushCertRequestCSR: Schema.String,
  PushCertSignature: Schema.String,
});

const decodePlist = async (base64: string) => {
  const xml = atob(base64);

  return Schema.decodeUnknownSync(CsrPlist)(await Effect.runPromise(parsePlist(xml)));
};

describe("APNs CSR generation", () => {
  it("creates a PKCS#10 request with the tenant subject", async () => {
    const keyPair = await createTestApnsKeys();

    const der = await createApnsCsrDer(keyPair, {
      organization: "Acme",
      organizationalUnit: "tenant-123",
    });

    const csr = pkijs.CertificationRequest.fromBER(der);
    const attributes = csr.subject.typesAndValues;
    expect(attributes.find((a) => a.type === "2.5.4.10")).toBeDefined();
    expect(attributes.find((a) => a.type === "2.5.4.11")).toBeDefined();
    expect(der.byteLength).toBeGreaterThan(0);
  });

  it("builds the Apple plist without a vendor certificate", async () => {
    const keyPair = await createTestApnsKeys();

    const result = await buildApnsCsr({
      keyPair,
      subject: { organization: "Acme", organizationalUnit: "tenant-123" },
    });

    const plist = await decodePlist(result.plist);
    expect(plist.PushCertCertificateChain).toBe("");
    expect(plist.PushCertSignature).toBe("");

    const der = Uint8Array.from(atob(plist.PushCertRequestCSR), (c) => c.charCodeAt(0));
    const csr = pkijs.CertificationRequest.fromBER(toArrayBuffer(der));
    expect(csr.subject.typesAndValues.length).toBeGreaterThan(0);

    // The key returned alongside the CSR is the one that must be stored.
    const jwk = await exportApnsKeyJwk(keyPair.privateKey);
    expect(result.privateKeyJwk.n).toBe(jwk.n);
  });

  it("signs the CSR and includes the Apple chain when a vendor key is configured", async () => {
    const keyPair = await createTestApnsKeys();
    const vendorKeys = await createTestApnsKeys();

    const vendor = await createTestApnsCertificate({
      keyPair: vendorKeys,
      topic: "com.apple.mgmt.External.vendor",
      commonName: "MDM Vendor",
    });

    const vendorKeyPem = pemEncode(
      "PRIVATE KEY",
      await crypto.subtle.exportKey("pkcs8", vendorKeys.privateKey),
    );

    const result = await buildApnsCsr({
      keyPair,
      subject: { organization: "Acme", organizationalUnit: "tenant-123" },
      vendor: { certificatePem: vendor.pem, privateKeyPem: vendorKeyPem },
    });

    const plist = await decodePlist(result.plist);
    expect(plist.PushCertSignature).not.toBe("");
    expect(plist.PushCertCertificateChain).toContain(
      APPLE_WORLDWIDE_DEVELOPER_RELATIONS_CERTIFICATION_AUTHORITY.split("\n")[0].trim(),
    );
    expect(plist.PushCertCertificateChain).toContain(APPLE_ROOT_CA.split("\n")[0].trim());
    expect(plist.PushCertCertificateChain).toContain(vendor.pem.trim().split("\n")[0]);

    const signature = Uint8Array.from(atob(plist.PushCertSignature), (c) => c.charCodeAt(0));

    const csrDer = Uint8Array.from(atob(plist.PushCertRequestCSR), (c) => c.charCodeAt(0));

    const publicKey = await vendor.certificate.getPublicKey();

    const valid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      publicKey,
      signature,
      csrDer,
    );

    expect(valid).toBe(true);
  });
});
