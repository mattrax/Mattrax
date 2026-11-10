import { Effect } from "effect";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { ScepError } from "./schema.js";
import { base64ToArrayBuffer, importPrivateKeyJwk } from "@mattrax/crypto";
import { certToPem, createDeviceCertificate, pemToCert } from "./pkcs7.js";

/**
 * Microsoft client-authentication certificate extension. Windows MDM (MS-MDE2)
 * issues the identity certificate used by the DM client with this EKU.
 */
export const CLIENT_AUTH_EKU_OID = "1.3.6.1.5.5.7.3.2";

/**
 * Microsoft `szOID_DEVICE_ID` extension. Windows expects the enrolled device
 * identifier in this extension on the management identity certificate.
 */
export const MS_DEVICE_ID_OID = "1.3.6.1.4.1.311.66.1.0";

const decodeCsr = (csr: string | ArrayBuffer): ArrayBuffer => {
  if (typeof csr !== "string") return csr;
  const input = csr.trim();
  if (input.includes("CERTIFICATE REQUEST")) {
    // Accept both the PKCS#10 "CERTIFICATE REQUEST" and legacy "NEW
    // CERTIFICATE REQUEST" PEM labels.
    const base64 = input
      .replace(/-----BEGIN [^-]+-----/g, "")
      .replace(/-----END [^-]+-----/g, "")
      .replace(/\s/g, "");
    return base64ToArrayBuffer(base64);
  }
  return base64ToArrayBuffer(input.replace(/\s/g, ""));
};

const subjectFromCsr = (csr: pkijs.CertificationRequest, fallback: string) => {
  const subject: Array<{ type: string; value: string }> = [];
  for (const rdn of csr.subject.typesAndValues) {
    const value = rdn.value.valueBlock as { value?: unknown } | undefined;
    if (typeof value?.value === "string") {
      subject.push({ type: rdn.type, value: value.value });
    }
  }
  if (!subject.some((item) => item.type === "2.5.4.3")) {
    subject.push({ type: "2.5.4.3", value: fallback });
  }
  return subject;
};

const microsoftDeviceIdExtension = (deviceId: string) =>
  new pkijs.Extension({
    extnID: MS_DEVICE_ID_OID,
    critical: false,
    // MS-MDE2 carries the device identifier as a UTF8String.
    extnValue: new asn1js.Utf8String({ value: deviceId }).toBER(false),
  });

export type SignCsrOptions = {
  /** Base64 DER (as sent in the WSTEP BinarySecurityToken) or PEM CSR. */
  readonly csr: string | ArrayBuffer;
  readonly caCertPem: string;
  readonly caPrivateKeyJwk: JsonWebKey;
  readonly notBefore?: Date;
  readonly notAfter?: Date;
  /** Value stored in the Microsoft DeviceID extension. */
  readonly deviceId?: string;
  /**
   * Replaces any OU in the CSR subject. Callers use this to pin the certificate
   * to an authenticated tenant instead of trusting CSR content.
   */
  readonly organizationalUnit?: string;
};

export type SignedCsr = {
  readonly certificate: pkijs.Certificate;
  readonly certificatePem: string;
};

/**
 * Sign a PKCS#10 certificate request with the SCEP device CA.
 *
 * This is the Windows WSTEP counterpart to `ScepService.pkiOperation`: the WSTEP
 * enrollment request carries a plain PKCS#10 CSR rather than a SCEP PKCSReq
 * CMS message, so the SCEP service cannot be reused directly.
 */
export const signScepCsr = (options: SignCsrOptions): Effect.Effect<SignedCsr, ScepError> =>
  Effect.tryPromise({
    try: async () => {
      const csr = pkijs.CertificationRequest.fromBER(decodeCsr(options.csr));
      if (!(await csr.verify())) {
        throw new Error("CSR signature is invalid");
      }

      const caCert = pemToCert(options.caCertPem);
      const caPrivateKey = await importPrivateKeyJwk(options.caPrivateKeyJwk);
      const deviceId = options.deviceId ?? "Windows Device";
      // Windows emits a CN containing `!` and NULs in its CSR. Normalize to the
      // enrollment DeviceID so check-in can bind the certificate to the device.
      const subject = subjectFromCsr(csr, deviceId).filter((item) => item.type !== "2.5.4.3");
      subject.push({ type: "2.5.4.3", value: deviceId });

      if (options.organizationalUnit) {
        const filtered = subject.filter((item) => item.type !== "2.5.4.11");
        filtered.push({ type: "2.5.4.11", value: options.organizationalUnit });
        subject.length = 0;
        subject.push(...filtered);
      }

      const notBefore = options.notBefore ?? new Date();
      const notAfter =
        options.notAfter ?? new Date(notBefore.getTime() + 365 * 24 * 60 * 60 * 1000);

      // createDeviceCertificate already adds the client-auth EKU; adding it
      // here would produce a duplicate 2.5.29.37 extension.
      const extensions = options.deviceId ? [microsoftDeviceIdExtension(options.deviceId)] : [];

      const certificate = await createDeviceCertificate(
        Math.floor(Math.random() * 0x7fffffff),
        subject,
        await csr.getPublicKey(),
        caCert,
        caPrivateKey,
        { notBefore, notAfter, extensions },
      );

      return { certificate, certificatePem: certToPem(certificate) };
    },
    catch: (cause) => new ScepError({ message: "Failed to sign certificate request", cause }),
  });
