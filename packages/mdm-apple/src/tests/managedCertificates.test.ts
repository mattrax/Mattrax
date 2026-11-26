import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTestSignerCert, generateKeyPair } from "@mattrax/scep/testing";
import { parseManagedCertificates } from "../managedCertificates.js";

describe("parseManagedCertificates", () => {
  it("reads subject, identity flag, fingerprint and expiry from the status item", async () => {
    const keys = await generateKeyPair();
    const cert = await createTestSignerCert(keys, "person@example.com");
    const der = new Uint8Array(cert.toSchema().toBER(false));
    const certificates = await parseManagedCertificates({
      security: {
        certificate: {
          list: [
            {
              identifier: "com.apple.identity.1",
              "subject-summary": "person@example.com",
              "is-identity": true,
              data: der,
            },
            {
              identifier: "removed",
              _removed: true,
            },
          ],
        },
      },
    });

    expect(certificates).toHaveLength(1);
    expect(certificates?.[0]).toMatchObject({
      identifier: "com.apple.identity.1",
      subject: "person@example.com",
      isIdentity: true,
      fingerprintSha256: createHash("sha256").update(der).digest("hex"),
      // X.509 stores whole seconds; pkijs reads the DER value back without ms.
      notAfter: new Date(
        Math.floor(cert.notAfter.value.getTime() / 1000) * 1000,
      ).toISOString(),
    });
  });

  it("distinguishes an absent status item from an empty certificate list", async () => {
    expect(await parseManagedCertificates({})).toBeNull();
    expect(
      await parseManagedCertificates({ security: { certificate: { list: [] } } }),
    ).toEqual([]);
  });
});
