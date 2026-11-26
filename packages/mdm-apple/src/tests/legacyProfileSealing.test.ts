import { describe, expect, it } from "vitest";
import { buildLegacyProfile } from "../policy.js";
import {
  installProfilePayload,
  openCommandPayload,
  sealLegacyInstallProfilePayload,
} from "../legacyDelivery.js";

const pfx = new Uint8Array([0x30, 0x82, 0x01, 0x02]);
const password = "legacy-pfx-secret";

describe("legacy Apple profile command sealing", () => {
  it("stores neither the PFX nor the password and opens the delivered payload", async () => {
    const row = {
      policyId: "policy-1",
      kind: "mttx.apple.pfx.smime",
      hash: "hash",
      organizationId: "tenant-1",
      data: {
        materialSha256: "a".repeat(64),
        certificatePem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
        subject: "person@example.com",
        notAfter: "2027-01-01T00:00:00.000Z",
        fingerprintSha256: "b".repeat(64),
      },
    };
    const profile = await buildLegacyProfile(row, {
      material: { pfx, password },
    });

    expect(profile).not.toBeNull();
    const plaintext = installProfilePayload({
      identifier: "app.mattrax.policy-1.mttx.apple.pfx.smime",
      policyId: row.policyId,
      kind: row.kind,
      ...profile!,
    });
    const pfxBase64 = Buffer.from(pfx).toString("base64");
    expect(Buffer.from(plaintext.Payload, "base64").toString("utf8")).toContain(pfxBase64);

    const stored = await sealLegacyInstallProfilePayload("command-secret", {
      identifier: "app.mattrax.policy-1.mttx.apple.pfx.smime",
      policyId: row.policyId,
      kind: row.kind,
      ...profile!,
    });

    expect(JSON.stringify(stored)).not.toContain(pfxBase64);
    expect(JSON.stringify(stored)).not.toContain(password);
    await expect(openCommandPayload("command-secret", stored)).resolves.toEqual(plaintext);
  });
});
