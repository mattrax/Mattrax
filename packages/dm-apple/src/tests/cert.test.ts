import { describe, it, expect } from "vitest";
import { extractTopicFromCertPem } from "../cert.js";
import * as pkijs from "pkijs";
import * as asn1js from "asn1js";
import { pemEncode } from "@mattrax/crypto";

async function generateTestCertWithTopic(topic: string, useUid = true): Promise<string> {
  const algorithm: RsaHashedKeyGenParams = {
    name: "RSASSA-PKCS1-v1_5",
    hash: "SHA-256",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
  };

  const keyPair = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"] as const);

  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 1 });

  const subjectOid = useUid ? "0.9.2342.19200300.100.1.1" : "2.5.4.3";

  const subjectRdn = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      new pkijs.AttributeTypeAndValue({
        type: subjectOid,
        value: new asn1js.Utf8String({ value: topic }),
      }),
    ],
  });

  cert.issuer = subjectRdn;
  cert.subject = subjectRdn;
  cert.notBefore.value = new Date();
  const notAfter = new Date();
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + 1);
  cert.notAfter.value = notAfter;

  await cert.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  await cert.sign(keyPair.privateKey, "SHA-256");

  return pemEncode("CERTIFICATE", cert.toSchema().toBER(false));
}

describe("cert", () => {
  describe("extractTopicFromCertPem", () => {
    it("extracts UID topic from a valid cert", async () => {
      const pem = await generateTestCertWithTopic("com.apple.mgmt.External.test", true);
      const topic = await extractTopicFromCertPem(pem);
      expect(topic).toBe("com.apple.mgmt.External.test");
    });

    it("falls back to CN when UID is absent", async () => {
      const pem = await generateTestCertWithTopic("com.apple.mgmt.External.cn", false);
      const topic = await extractTopicFromCertPem(pem);
      expect(topic).toBe("com.apple.mgmt.External.cn");
    });

    it("returns null for invalid PEM", async () => {
      const topic = await extractTopicFromCertPem("not-a-pem");
      expect(topic).toBeNull();
    });

    it("returns null when neither UID nor CN is present", async () => {
      const algorithm: RsaHashedKeyGenParams = {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
      };

      const keyPair = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"] as const);

      const cert = new pkijs.Certificate();
      cert.version = 2;
      cert.serialNumber = new asn1js.Integer({ value: 1 });
      cert.issuer = new pkijs.RelativeDistinguishedNames({ typesAndValues: [] });
      cert.subject = new pkijs.RelativeDistinguishedNames({ typesAndValues: [] });
      cert.notBefore.value = new Date();
      cert.notAfter.value = new Date(Date.now() + 86400000);
      await cert.subjectPublicKeyInfo.importKey(keyPair.publicKey);
      await cert.sign(keyPair.privateKey, "SHA-256");

      const pem = pemEncode("CERTIFICATE", cert.toSchema().toBER(false));
      const topic = await extractTopicFromCertPem(pem);
      expect(topic).toBeNull();
    });
  });
});
