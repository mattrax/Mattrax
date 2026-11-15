import { describe, expect, it } from "vitest";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { parseMobileconfigPreview, payloadCategory } from "../src/mobileconfig.js";

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
  }
}

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadDisplayName</key><string>Test Wi-Fi Network</string>
      <key>PayloadIdentifier</key><string>com.apple.wifi.managed.test</string>
      <key>PayloadType</key><string>com.apple.wifi.managed</string>
      <key>PayloadUUID</key><string>12345678-1234-1234-1234-123456789ABC</string>
      <key>PayloadVersion</key><integer>1</integer>
    </dict>
    <dict>
      <key>PayloadDisplayName</key><string>Test Restrictions</string>
      <key>PayloadIdentifier</key><string>com.apple.restrictions.test</string>
      <key>PayloadType</key><string>com.apple.restrictions</string>
      <key>PayloadUUID</key><string>87654321-4321-4321-4321-123456789DEF</string>
      <key>PayloadVersion</key><integer>1</integer>
    </dict>
  </array>
  <key>PayloadDisplayName</key><string>Test Profile</string>
  <key>PayloadDescription</key><string>A test configuration profile</string>
  <key>PayloadOrganization</key><string>Test Organization</string>
  <key>PayloadIdentifier</key><string>com.test.profile</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>ABCDEF12-3456-7890-ABCD-EF1234567890</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>`;

describe("mobileconfig preview", () => {
  it("parses metadata and friendly payload categories", async () => {
    const preview = await parseMobileconfigPreview(btoa(sample));
    expect(preview).toMatchObject({
      displayName: "Test Profile",
      description: "A test configuration profile",
      organization: "Test Organization",
      identifier: "com.test.profile",
      type: "Configuration",
      uuid: "ABCDEF12-3456-7890-ABCD-EF1234567890",
    });
    expect(preview.payloads).toEqual([
      expect.objectContaining({
        type: "com.apple.wifi.managed",
        category: "Wi-Fi",
        identifier: "com.apple.wifi.managed.test",
        displayName: "Test Wi-Fi Network",
      }),
      expect.objectContaining({
        type: "com.apple.restrictions",
        category: "Restrictions",
      }),
    ]);
  });

  it("accepts a data URL prefix and a single payload", async () => {
    const single = sample.replace(
      /<array>[\s\S]*<\/array>/,
      `<dict><key>PayloadType</key><string>com.apple.mail.managed</string></dict>`,
    );

    const preview = await parseMobileconfigPreview(
      `data:application/x-apple-aspen-config;base64,${btoa(single)}`,
    );

    expect(preview.payloads).toEqual([
      expect.objectContaining({ type: "com.apple.mail.managed", category: "Email Account" }),
    ]);
  });

  it("rejects invalid base64 and invalid plists", async () => {
    await expect(parseMobileconfigPreview("not base64!")).rejects.toThrow("base64");
    await expect(parseMobileconfigPreview(btoa("not a plist"))).rejects.toThrow();
  });

  it("maps unknown payload types to themselves", () => {
    expect(payloadCategory("com.example.custom")).toBe("com.example.custom");
  });

  it("extracts the embedded plist from a PKCS#7 signed mobileconfig", async () => {
    // SAFETY: WebCrypto returns a `CryptoKeyPair` for the RSA key pair it was
    // asked to generate; the DOM runtime type is wider than that overload.
    const keyPair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
      } satisfies RsaHashedKeyGenParams,
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;

    const name = new pkijs.RelativeDistinguishedNames({
      typesAndValues: [
        new pkijs.AttributeTypeAndValue({
          type: "2.5.4.3",
          value: new asn1js.Utf8String({ value: "Signer" }),
        }),
      ],
    });

    const certificate = new pkijs.Certificate();
    certificate.version = 2;
    certificate.serialNumber = new asn1js.Integer({ value: 1 });
    certificate.issuer = name;
    certificate.subject = name;
    certificate.notBefore.value = new Date();
    certificate.notAfter.value = new Date(Date.now() + 86_400_000);
    await certificate.subjectPublicKeyInfo.importKey(keyPair.publicKey);
    await certificate.sign(keyPair.privateKey, "SHA-256");

    const signedData = new pkijs.SignedData({
      version: 1,
      digestAlgorithms: [
        new pkijs.AlgorithmIdentifier({
          algorithmId: "2.16.840.1.101.3.4.2.1",
          algorithmParams: new asn1js.Null(),
        }),
      ],
      encapContentInfo: new pkijs.EncapsulatedContentInfo({
        eContentType: pkijs.ContentInfo.DATA,
        eContent: new asn1js.OctetString({ valueHex: new TextEncoder().encode(sample).buffer }),
      }),
      certificates: [certificate],
      signerInfos: [],
    });

    signedData.signerInfos.push(
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({
          issuer: certificate.issuer,
          serialNumber: certificate.serialNumber,
        }),
        digestAlgorithm: new pkijs.AlgorithmIdentifier({
          algorithmId: "2.16.840.1.101.3.4.2.1",
          algorithmParams: new asn1js.Null(),
        }),
        signatureAlgorithm: new pkijs.AlgorithmIdentifier({
          algorithmId: "1.2.840.113549.1.1.11",
          algorithmParams: new asn1js.Null(),
        }),
        signature: new asn1js.OctetString({ valueHex: new ArrayBuffer(0) }),
      }),
    );
    await signedData.sign(keyPair.privateKey, 0, "SHA-256");

    const der = new pkijs.ContentInfo({
      contentType: pkijs.ContentInfo.SIGNED_DATA,
      content: signedData.toSchema(),
    })
      .toSchema()
      .toBER(false);

    const preview = await parseMobileconfigPreview(
      btoa(String.fromCharCode(...new Uint8Array(der))),
    );

    expect(preview.displayName).toBe("Test Profile");
    expect(preview.payloads).toHaveLength(2);
  });
});
