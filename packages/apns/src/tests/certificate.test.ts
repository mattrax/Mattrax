import { describe, expect, it } from "vitest";
import {
  certificateMatchesKey,
  isApnsMdmTopic,
  parseApnsCertificate,
  validateApnsCertificate,
} from "../certificate.js";
import { createTestApnsCertificate, createTestApnsKeys } from "./helpers.js";

describe("APNs certificate parsing", () => {
  it("extracts the UID topic, common name and expiry", async () => {
    const keys = await createTestApnsKeys();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const { pem } = await createTestApnsCertificate({
      keyPair: keys,
      topic: "com.apple.mgmt.External.abc123",
      commonName: "Acme MDM",
      notAfter: expires,
    });

    const parsed = parseApnsCertificate(pem);
    expect(parsed.topic).toBe("com.apple.mgmt.External.abc123");
    expect(parsed.commonName).toBe("Acme MDM");
    expect(Math.floor(parsed.notAfter.getTime() / 1000)).toBe(Math.floor(expires.getTime() / 1000));
  });

  it("accepts only MDM-shaped topics", () => {
    expect(isApnsMdmTopic("com.apple.mgmt.External.abc")).toBe(true);
    expect(isApnsMdmTopic("com.apple.mgmt.AccountDrivenEnrollment.abc")).toBe(true);
    expect(isApnsMdmTopic("com.example.other")).toBe(false);
    expect(isApnsMdmTopic("com.apple.mgmt.")).toBe(false);
  });

  it("rejects expired and not-yet-valid certificates", async () => {
    const keys = await createTestApnsKeys();

    const expired = await createTestApnsCertificate({
      keyPair: keys,
      topic: "com.apple.mgmt.External.abc123",
      notBefore: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      notAfter: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    await expect(validateApnsCertificate(expired.pem)).rejects.toThrow(/expired/);

    const future = await createTestApnsCertificate({
      keyPair: keys,
      topic: "com.apple.mgmt.External.abc123",
      notBefore: new Date(Date.now() + 24 * 60 * 60 * 1000),
      notAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await expect(validateApnsCertificate(future.pem)).rejects.toThrow(/not valid yet/);
  });

  it("rejects certificates whose topic is not an APNs MDM topic", async () => {
    const keys = await createTestApnsKeys();

    const { pem } = await createTestApnsCertificate({
      keyPair: keys,
      topic: "com.example.not-mdm",
    });

    await expect(validateApnsCertificate(pem)).rejects.toThrow(/Invalid APNs topic/);
  });

  it("checks the certificate against the pending private key", async () => {
    const keys = await createTestApnsKeys();
    const other = await createTestApnsKeys();

    const { certificate, pem } = await createTestApnsCertificate({
      keyPair: keys,
      topic: "com.apple.mgmt.External.abc123",
    });

    await expect(certificateMatchesKey(certificate, keys.privateKey)).resolves.toBe(true);
    await expect(certificateMatchesKey(certificate, other.privateKey)).resolves.toBe(false);
    await expect(
      validateApnsCertificate(pem, { privateKey: keys.privateKey }),
    ).resolves.toMatchObject({ topic: "com.apple.mgmt.External.abc123" });
    await expect(validateApnsCertificate(pem, { privateKey: other.privateKey })).rejects.toThrow(
      /pending private key/,
    );
  });
});
