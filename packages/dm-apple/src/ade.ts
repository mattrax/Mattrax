/**
 * Automated Device Enrollment (ADE) MachineInfo parsing.
 *
 * During Setup Assistant an ADE device POSTs a CMS-signed plist (MachineInfo)
 * to the enrollment URL registered in its ADE profile. Apple signs that request
 * with the device's built-in identity certificate; here we verify the CMS
 * signature against Apple's published device CA and read the serial and UDID.
 *
 * This is the only authentication an ADE enrollment request has: the profile
 * response carries a SCEP challenge, so serving it for an unverified serial
 * would hand out tenant credentials. Keep the verification fail-closed.
 *
 * Apple's `Apple iPhone Device CA` expired in 2014 but Apple still uses it to
 * issue device identities, so chain validity windows are deliberately not
 * enforced for that anchor.
 */
import * as pkijs from "pkijs";
import { Effect, Schema } from "effect";
import { parsePlist, PlistValue } from "@mattrax/plist";

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
  }
}

/** Bound the CMS body before ASN.1 parsing. */
export const MAX_ADE_MACHINE_INFO_BYTES = 64 * 1024;

const SIGNED_DATA_OID = "1.2.840.113549.1.7.2";
const BASIC_CONSTRAINTS_OID = "2.5.29.19";

const APPLE_DEVICE_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIDaTCCAlGgAwIBAgIBATANBgkqhkiG9w0BAQUFADB5MQswCQYDVQQGEwJVUzET
MBEGA1UEChMKQXBwbGUgSW5jLjEmMCQGA1UECxMdQXBwbGUgQ2VydGlmaWNhdGlv
biBBdXRob3JpdHkxLTArBgNVBAMTJEFwcGxlIGlQaG9uZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTAeFw0wNzA0MTYyMjU0NDZaFw0xNDA0MTYyMjU0NDZaMFoxCzAJ
BgNVBAYTAlVTMRMwEQYDVQQKEwpBcHBsZSBJbmMuMRUwEwYDVQQLEwxBcHBsZSBp
UGhvbmUxHzAdBgNVBAMTFkFwcGxlIGlQaG9uZSBEZXZpY2UgQ0EwgZ8wDQYJKoZI
hvcNAQEBBQADgY0AMIGJAoGBAPGUSsnquloYYK3Lok1NTlQZaRdZB2bLl+hmmkdf
Rq5nerVKc1SxywT2vTa4DFU4ioSDMVJl+TPhl3ecK0wmsCU/6TKqewh0lOzBSzgd
Z04IUpRai1mjXNeT9KD+VYW7TEaXXm6yd0UvZ1y8Cxi/WblshvcqdXbSGXH0KWO5
JQuvAgMBAAGjgZ4wgZswDgYDVR0PAQH/BAQDAgGGMA8GA1UdEwEB/wQFMAMBAf8w
HQYDVR0OBBYEFLL+ISNEhpVqedWBJo5zENinTI50MB8GA1UdIwQYMBaAFOc0Ki4i
3jlga7SUzneDYS8xoHw1MDgGA1UdHwQxMC8wLaAroCmGJ2h0dHA6Ly93d3cuYXBw
bGUuY29tL2FwcGxlY2EvaXBob25lLmNybDANBgkqhkiG9w0BAQUFAAOCAQEAd13P
Z3pMViukVHe9WUg8Hum+0I/0kHKvjhwVd/IMwGlXyU7DhUYWdja2X/zqj7W24Aq5
7dEKm3fqqxK5XCFVGY5HI0cRsdENyTP7lxSiiTRYj2mlPedheCn+k6T5y0U4Xr40
FXwWb2nWqCF1AgIudhgvVbxlvqcxUm8Zz7yDeJ0JFovXQhyO5fLUHRLCQFssAbf8
B4i8rYYsBUhYTspVJcxVpIIltkYpdIRSIARA49HNvKK4hzjzMS/OhKQpVKw+OCEZ
xptCVeN2pjbdt9uzi175oVo/u6B2ArKAW17u6XEHIdDMOe7cb33peVI6TD15W4MI
pyQPbp8orlXe+tA8JA==
-----END CERTIFICATE-----`;

const APPLE_ROOT_PEM = `-----BEGIN CERTIFICATE-----
MIIEuzCCA6OgAwIBAgIBAjANBgkqhkiG9w0BAQUFADBiMQswCQYDVQQGEwJVUzET
MBEGA1UEChMKQXBwbGUgSW5jLjEmMCQGA1UECxMdQXBwbGUgQ2VydGlmaWNhdGlv
biBBdXRob3JpdHkxFjAUBgNVBAMTDUFwcGxlIFJvb3QgQ0EwHhcNMDYwNDI1MjE0
MDM2WhcNMzUwMjA5MjE0MDM2WjBiMQswCQYDVQQGEwJVUzETMBEGA1UEChMKQXBw
bGUgSW5jLjEmMCQGA1UECxMdQXBwbGUgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkx
FjAUBgNVBAMTDUFwcGxlIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAw
ggEKAoIBAQDkkakJH5HbHkdQ6wXtXnmELes2oldMVeyLGYne+Uts9QerIjAC6Bg+
+FAJ039BqJj50cpmnCRrEdCju+QbKsMflZ56DKRHi1vUFjczy8QPTc4UadHJGXL1
XQ7Vf1+b8iUDulWPTV0N8WQ1IxVLFVkds5T39pyez1C6wVhQZ48ItCD3y6wsIG9w
tj8BMIy3Q88PnT3zK0koGsj+zrW5DtleHNbLPbU6rfQPDgCSC7EhFi501TwN22IW
q6NxkkdTVcGvL0Gz+PvjcM3mo0xFfh9Ma1CWQYnEdGILEINBhzOKgbEwWOxaBDKM
aLOPHd5lc/9nXmW8Sdh2nzMUZaF3lMktAgMBAAGjggF6MIIBdjAOBgNVHQ8BAf8E
BAMCAQYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUK9BpR5R2Cf70a40uQKb3
R01/CF4wHwYDVR0jBBgwFoAUK9BpR5R2Cf70a40uQKb3R01/CF4wggERBgNVHSAE
ggEIMIIBBDCCAQAGCSqGSIb3Y2QFATCB8jAqBggrBgEFBQcCARYeaHR0cHM6Ly93
d3cuYXBwbGUuY29tL2FwcGxlY2EvMIHDBggrBgEFBQcCAjCBthqBs1JlbGlhbmNl
IG9uIHRoaXMgY2VydGlmaWNhdGUgYnkgYW55IHBhcnR5IGFzc3VtZXMgYWNjZXB0
YW5jZSBvZiB0aGUgdGhlbiBhcHBsaWNhYmxlIHN0YW5kYXJkIHRlcm1zIGFuZCBj
b25kaXRpb25zIG9mIHVzZSwgY2VydGlmaWNhdGUgcG9saWN5IGFuZCBjZXJ0aWZp
Y2F0aW9uIHByYWN0aWNlIHN0YXRlbWVudHMuMA0GCSqGSIb3DQEBBQUAA4IBAQBc
NplMLXi37Yyb3PN3m/J20ncwT8EfhYOFG5k9RzfyqZtAjizUsZAS2L70c5vu0mQP
y3lPNNiiPvl4/2vIB+x9OYOLUyDTOMSxv5pPCmv/K/xZpwUJfBdAVhEedNO3iyM7
R6PVbyTi69G3cN8PReEnyvFteO3ntRcXqNx+IjXKJdXZD9Zr1KIkIxH3oayPc4Fg
xhtbCS+SsvhESPBgOJ4V9T0mZyCKM2r3DYLP3uujL/lTaltkwGMzd/c6ByxW69oP
IQ7aunMZT7XZNn/Bh1XZp5m5MkL72NVxnn6hUrcbvZNCJBIqxw8dtk2cXmPIS4AX
UKqK1drk/NAJBzewdXUh
-----END CERTIFICATE-----`;

export type AppleAdeMachineInfo = {
  readonly serial: string;
  readonly udid: string;
  readonly product?: string;
  readonly osVersion?: string;
  readonly deviceName?: string;
};

export class AppleAdeEnrollmentError extends Error {
  readonly code: "invalid_request" | "untrusted_signer" | "unknown_device";

  constructor(code: AppleAdeEnrollmentError["code"], message: string) {
    super(message);
    this.name = "AppleAdeEnrollmentError";
    this.code = code;
  }
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

const decodePem = (pem: string): Uint8Array => {
  const match = /-----BEGIN (?:TRUSTED )?CERTIFICATE-----([\s\S]*?)-----END/.exec(pem);
  const binary = atob((match?.[1] ?? "").replace(/\s/g, ""));

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const parseCertificate = (pem: string): pkijs.Certificate =>
  pkijs.Certificate.fromBER(toArrayBuffer(decodePem(pem)));

const isCertificateAuthority = (certificate: pkijs.Certificate): boolean => {
  const extension = certificate.extensions?.find((item) => item.extnID === BASIC_CONSTRAINTS_OID);

  return extension?.parsedValue instanceof pkijs.BasicConstraints
    ? extension.parsedValue.cA
    : false;
};

const parseSignedData = (bytes: Uint8Array) => {
  if (bytes.byteLength === 0)
    throw new AppleAdeEnrollmentError("invalid_request", "The enrollment request is empty");

  if (bytes.byteLength > MAX_ADE_MACHINE_INFO_BYTES)
    throw new AppleAdeEnrollmentError("invalid_request", "The enrollment request is too large");

  let contentInfo: pkijs.ContentInfo;

  try {
    contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(bytes));
  } catch {
    throw new AppleAdeEnrollmentError(
      "invalid_request",
      "The enrollment request is not a CMS SignedData structure",
    );
  }

  if (contentInfo.contentType !== SIGNED_DATA_OID || !contentInfo.content)
    throw new AppleAdeEnrollmentError(
      "invalid_request",
      "The enrollment request is not a CMS SignedData structure",
    );

  const signedData = new pkijs.SignedData({ schema: contentInfo.content });

  const certificates = (signedData.certificates ?? []).filter(
    (certificate): certificate is pkijs.Certificate => certificate instanceof pkijs.Certificate,
  );

  return { signedData, certificates };
};

const verifyWithAnchors = async (
  signer: pkijs.Certificate,
  anchors: ReadonlyArray<pkijs.Certificate>,
): Promise<boolean> => {
  for (const anchor of anchors) {
    if (!isCertificateAuthority(anchor)) continue;

    if (!signer.issuer.isEqual(anchor.subject)) continue;

    try {
      if (await signer.verify(anchor)) return true;
    } catch {
      // Try the next anchor.
    }
  }

  return false;
};

/**
 * Verify and decode an ADE MachineInfo request.
 *
 * Throws {@link AppleAdeEnrollmentError} for malformed or untrusted input.
 * `anchors` exists for tests and for deployments that pin an updated Apple
 * device CA; production defaults to Apple's published device CA and root.
 */
export async function parseAppleAdeMachineInfo(
  input: Uint8Array,
  options: { readonly anchors?: ReadonlyArray<string> } = {},
): Promise<AppleAdeMachineInfo> {
  const { signedData, certificates } = parseSignedData(input);

  if (signedData.signerInfos.length !== 1 || certificates.length === 0)
    throw new AppleAdeEnrollmentError(
      "invalid_request",
      "The enrollment request must carry exactly one signer",
    );

  const eContent = signedData.encapContentInfo.eContent;

  if (!eContent)
    throw new AppleAdeEnrollmentError(
      "invalid_request",
      "The enrollment request must encapsulate MachineInfo",
    );

  const content = new Uint8Array(eContent.getValue());

  let result: pkijs.SignedDataVerifyResult;

  try {
    result = await signedData.verify({
      signer: 0,
      checkChain: false,
      extendedMode: true,
    });
  } catch {
    throw new AppleAdeEnrollmentError(
      "invalid_request",
      "The enrollment request signature is invalid",
    );
  }

  if (result.signatureVerified !== true || !result.signerCertificate)
    throw new AppleAdeEnrollmentError(
      "invalid_request",
      "The enrollment request signature is invalid",
    );

  const anchors = (options.anchors ?? [APPLE_DEVICE_CA_PEM, APPLE_ROOT_PEM]).map(parseCertificate);

  if (!(await verifyWithAnchors(result.signerCertificate, anchors)))
    throw new AppleAdeEnrollmentError(
      "untrusted_signer",
      "The enrollment request was not signed by an Apple device identity",
    );

  const plist = await Effect.runPromise(parsePlist(new TextDecoder().decode(content)));

  const record = Schema.is(Schema.Record(Schema.String, PlistValue))(plist) ? plist : undefined;

  const text = (key: string) => {
    const value = record?.[key];

    return Schema.is(Schema.String)(value) && value.trim() ? value.trim() : undefined;
  };

  const serial = text("SERIAL");

  if (!serial)
    throw new AppleAdeEnrollmentError(
      "invalid_request",
      "The enrollment request does not contain a device serial number",
    );

  return {
    serial,
    udid: text("UDID") ?? serial,
    product: text("PRODUCT"),
    osVersion: text("OS_VERSION"),
    deviceName: text("DEVICE_NAME"),
  };
}
