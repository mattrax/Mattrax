import { Data, Effect } from "effect";
import { arrayBufferToBase64, pemDecode, toArrayBuffer, uint8ArrayToBase64 } from "@mattrax/crypto";
import { serializeSoapElement } from "@mattrax/soap";
import {
  WapProvisioningDoc,
  type WapProvisioningDoc as WapProvisioningDocType,
} from "./messages.js";
import type { WindowsEnrollmentResult } from "@mattrax/management-backend";

export class WstepError extends Data.TaggedError("WstepError")<{
  message: string;
  cause?: unknown;
}> {}

export const TOKEN_TYPE =
  "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken";

export const PROVISION_DOC_TYPE =
  "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentProvisionDoc";

export const PKCS10_VALUE_TYPE =
  "http://schemas.microsoft.com/windows/pki/2009/01/enrollment#PKCS10";

export const BASE64_ENCODING_TYPE =
  "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary";

export const ISSUE_REQUEST_TYPE = "http://docs.oasis-open.org/ws-sx/ws-trust/200512/Issue";

const certificateDer = (certificate: string): ArrayBuffer | null => {
  try {
    return pemDecode("CERTIFICATE", certificate);
  } catch {
    return null;
  }
};

/**
 * Windows uses the certificate thumbprint (SHA-1 over DER) as the WAP
 * provisioning characteristic name. Non-PEM input is hashed verbatim so callers
 * that pass placeholder strings still produce a document.
 */
export function certificateFingerprint(certificate: string): Effect.Effect<string, WstepError> {
  return Effect.tryPromise({
    try: async () => {
      const der = certificateDer(certificate);
      const bytes = der ?? toArrayBuffer(new TextEncoder().encode(certificate));
      const digest = await crypto.subtle.digest("SHA-1", bytes);

      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    },
    catch: (cause) => new WstepError({ message: "Failed to fingerprint certificate", cause }),
  });
}

/**
 * `EncodedCertificate` in a WAP provisioning document is base64 DER, not PEM.
 * Fall back to the input unchanged when it is not a PEM certificate.
 */
export function encodedCertificate(certificate: string): string {
  const der = certificateDer(certificate);

  return der ? arrayBufferToBase64(der) : certificate;
}

export function buildProvisioningDoc(
  result: WindowsEnrollmentResult,
  managementUrl: string,
): Effect.Effect<string, WstepError> {
  return Effect.gen(function* () {
    const rootFingerprint = yield* certificateFingerprint(result.identityCertificate);
    const clientFingerprint = yield* certificateFingerprint(result.signedCertificate);

    const doc: WapProvisioningDocType = {
      version: "1.1",
      characteristics: [
        {
          type: "WSTEP",
          characteristics: [
            {
              type: "Renew",
              params: [
                { name: "ROBOSupport", value: "true", datatype: "boolean" },
                { name: "RenewPeriod", value: "180", datatype: "integer" },
                { name: "RetryInterval", value: "4", datatype: "integer" },
              ],
            },
          ],
        },
        {
          type: "CertificateStore",
          characteristics: [
            {
              type: "Root",
              characteristics: [
                {
                  type: "System",
                  characteristics: [
                    {
                      type: rootFingerprint,
                      params: [
                        {
                          name: "EncodedCertificate",
                          value: encodedCertificate(result.identityCertificate),
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: "My",
              characteristics: [
                {
                  type: "System",
                  characteristics: [
                    {
                      type: clientFingerprint,
                      params: [
                        {
                          name: "EncodedCertificate",
                          value: encodedCertificate(result.signedCertificate),
                        },
                      ],
                    },
                    { type: "PrivateKeyContainer" },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "APPLICATION",
          params: [
            { name: "PROVIDER-ID", value: result.providerId },
            { name: "APPID", value: "w7" },
            { name: "NAME", value: result.providerId },
            { name: "ADDR", value: managementUrl },
            { name: "DEFAULTENCODING", value: "application/vnd.syncml.dm+xml" },
            { name: "CONNRETRYFREQ", value: "1" },
            { name: "INITIALBACKOFFTIME", value: "16000" },
            { name: "MAXBACKOFFTIME", value: "120000" },
          ],
          characteristics: [
            {
              type: "APPAUTH",
              params: [
                { name: "AAUTHLEVEL", value: "CLIENT" },
                { name: "AAUTHTYPE", value: "DIGEST" },
                { name: "AAUTHSECRET", value: "dummy" },
                { name: "AAUTHDATA", value: "nonce" },
              ],
            },
            {
              type: "APPAUTH",
              params: [
                { name: "AAUTHLEVEL", value: "APPSRV" },
                { name: "AAUTHTYPE", value: "DIGEST" },
                { name: "AAUTHNAME", value: result.username },
                { name: "AAUTHSECRET", value: result.secret },
                { name: "AAUTHDATA", value: "nonce" },
              ],
            },
          ],
        },
        {
          type: "DMClient",
          characteristics: [
            {
              type: "Provider",
              characteristics: [
                {
                  type: result.providerId,
                  characteristics: [
                    {
                      type: "Poll",
                      params: [
                        { name: "AllUsersPollOnFirstLogin", value: "true", datatype: "boolean" },
                        { name: "PollOnLogin", value: "true", datatype: "boolean" },
                        { name: "NumberOfFirstRetries", value: "0", datatype: "integer" },
                        { name: "IntervalForFirstSetOfRetries", value: "1", datatype: "integer" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    return yield* serializeSoapElement(WapProvisioningDoc, doc).pipe(
      Effect.mapError(
        (cause) => new WstepError({ message: "Failed to serialize provisioning document", cause }),
      ),
    );
  });
}

export function encodeProvisioningDoc(xml: string): string {
  return uint8ArrayToBase64(new TextEncoder().encode(xml));
}
