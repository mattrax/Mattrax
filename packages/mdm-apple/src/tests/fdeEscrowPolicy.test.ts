import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { certificateDer, createEscrowCertificate, pemEncode } from "@mattrax/scep";

import {
  applyEscrowCertificate,
  inspectMobileconfig,
  validateConfiguration,
  validateEscrowConfiguration,
} from "@mattrax/mdm-core";

const certificate = async (commonName: string) => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  return pemEncode(
    "CERTIFICATE",
    (await createEscrowCertificate(keyPair, commonName)).toSchema().toBER(false),
  );
};

const fingerprint = async (pem: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(await certificateDer(pem))),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

const escrowProfile = async (options: { certificatePem?: string } = {}) => {
  const certificatePayload = options.certificatePem
    ? await certificatePemToBase64(options.certificatePem)
    : "";

  const certificatePayloadXml = options.certificatePem
    ? `<dict>
<key>PayloadType</key><string>com.apple.security.pkcs1</string>
<key>PayloadIdentifier</key><string>app.mattrax.escrow.certificate</string>
<key>PayloadUUID</key><string>33333333-3333-3333-3333-333333333333</string>
<key>PayloadVersion</key><integer>1</integer>
<key>PayloadContent</key><data>${certificatePayload}</data>
</dict>`
    : "";

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadType</key><string>Configuration</string>
<key>PayloadIdentifier</key><string>app.mattrax.escrow</string>
<key>PayloadDisplayName</key><string>FileVault escrow</string>
<key>PayloadUUID</key><string>11111111-1111-1111-1111-111111111111</string>
<key>PayloadVersion</key><integer>1</integer>
<key>PayloadContent</key><array>
<dict>
<key>PayloadType</key><string>com.apple.security.FDERecoveryKeyEscrow</string>
<key>PayloadIdentifier</key><string>app.mattrax.escrow.payload</string>
<key>PayloadUUID</key><string>22222222-2222-2222-2222-222222222222</string>
<key>PayloadVersion</key><integer>1</integer>
<key>Location</key><string>Mattrax</string>
<key>EncryptCertPayloadUUID</key><string>33333333-3333-3333-3333-333333333333</string>
</dict>
${certificatePayloadXml}
</array>
</dict></plist>`;

  return btoa(xml);
};

/** Minimal PEM → base64 DER for embedding a test certificate in the plist. */
const certificatePemToBase64 = async (pem: string) => {
  const der = await certificateDer(pem);
  let binary = "";

  for (const byte of der) binary += String.fromCharCode(byte);

  return btoa(binary);
};

describe("FileVault escrow profile validation", () => {
  it("rejects an escrow profile when the tenant has no escrow key", async () => {
    await expect(
      Effect.runPromise(
        validateConfiguration(
          "mttx.apple.custom.escrow",
          { content: await escrowProfile() },
          { escrowCertificateFingerprintSha256: null },
        ),
      ),
    ).rejects.toThrow(/no FileVault escrow key/);
  });

  it("rejects a certificate Mattrax holds no private key for", async () => {
    const tenant = await certificate("Tenant escrow");
    const foreign = await certificate("Foreign escrow");

    const bytes = Uint8Array.from(atob(await escrowProfile({ certificatePem: foreign })), (char) =>
      char.charCodeAt(0),
    );

    const inspection = (await inspectMobileconfig(bytes))!;

    await expect(
      validateEscrowConfiguration(inspection, {
        certificateFingerprintSha256: await fingerprint(tenant),
      }),
    ).resolves.toMatch(/does not hold the private key/);
  });

  it("accepts a profile pinned to the tenant certificate", async () => {
    const tenant = await certificate("Tenant escrow");

    await expect(
      Effect.runPromise(
        validateConfiguration(
          "mttx.apple.custom.escrow",
          { content: await escrowProfile({ certificatePem: tenant }) },
          { escrowCertificateFingerprintSha256: await fingerprint(tenant) },
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts a designer profile with no certificate payload (delivery injects one)", async () => {
    const tenant = await certificate("Tenant escrow");

    await expect(
      Effect.runPromise(
        validateConfiguration(
          "mttx.apple.custom.escrow",
          { content: await escrowProfile() },
          { escrowCertificateFingerprintSha256: await fingerprint(tenant) },
        ),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("applyEscrowCertificate", () => {
  it("injects the tenant certificate under the referenced payload UUID", async () => {
    const tenant = await certificate("Tenant escrow");
    const bytes = Uint8Array.from(atob(await escrowProfile()), (char) => char.charCodeAt(0));

    const rewritten = await applyEscrowCertificate(bytes, tenant);
    expect("content" in rewritten).toBe(true);

    if (!("content" in rewritten))
      throw new Error("expected the escrow certificate to be injected");

    const inspection = await inspectMobileconfig(rewritten.content);

    const certificatePayload = inspection?.payloads.find(
      (payload) => payload.type === "com.apple.security.pkcs1",
    );

    expect(certificatePayload?.uuid).toBe("33333333-3333-3333-3333-333333333333");
    expect(Array.from(certificatePayload!.certificateDer ?? [])).toEqual(
      Array.from(await certificateDer(tenant)),
    );
  });

  it("leaves a profile without an escrow payload untouched", async () => {
    const tenant = await certificate("Tenant escrow");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>PayloadType</key><string>Configuration</string><key>PayloadIdentifier</key><string>x</string><key>PayloadContent</key><array/></dict></plist>`;

    const bytes = new TextEncoder().encode(xml);

    const rewritten = await applyEscrowCertificate(bytes, tenant);

    expect(rewritten).toEqual({ content: bytes });
  });

  it("does not serve a signed escrow profile it cannot rewrite", async () => {
    // A DER object that is not a signed profile still fails closed.
    const tenant = await certificate("Tenant escrow");
    const bytes = new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x00]);

    const rewritten = await applyEscrowCertificate(bytes, tenant);

    expect(rewritten).toEqual({
      error: "The stored configuration profile could not be decoded.",
    });
  });
});
