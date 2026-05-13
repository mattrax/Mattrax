import { Effect } from "effect";
import { arrayBufferToBase64, sha256 } from "@mattrax/crypto";
import { serializeSoapElement, WapProvisioningDoc, type WapProvisioningDoc as WapProvisioningDocType } from "@mattrax/soap";
import type { WindowsEnrollmentResult } from "@mattrax/management-backend";

export class WstepError {
  readonly _tag = "WstepError";
  constructor(readonly message: string, readonly cause?: unknown) {}
}

export const TOKEN_TYPE = "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken";
export const PROVISION_DOC_TYPE = "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentProvisionDoc";
export const PKCS10_VALUE_TYPE = "http://schemas.microsoft.com/windows/pki/2009/01/enrollment#PKCS10";
export const BASE64_ENCODING_TYPE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary";
export const ISSUE_REQUEST_TYPE = "http://docs.oasis-open.org/ws-sx/ws-trust/200512/Issue";

export function certificateFingerprint(certificate: string): Effect.Effect<string, WstepError> {
  return Effect.tryPromise({
    try: async () => {
      const digest = await sha256(new TextEncoder().encode(certificate).buffer as ArrayBuffer);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    },
    catch: (cause) => new WstepError("Failed to fingerprint certificate", cause),
  });
}

export function buildProvisioningDoc(result: WindowsEnrollmentResult, managementUrl: string): Effect.Effect<string, WstepError> {
  return Effect.gen(function* () {
    const rootFingerprint = yield* certificateFingerprint(result.identityCertificate);
    const clientFingerprint = yield* certificateFingerprint(result.signedCertificate);
    const doc: WapProvisioningDocType = {
      version: "1.1",
      characteristics: [
        {
          type: "CertificateStore",
          characteristics: [
            { type: "Root", characteristics: [{ type: "System", characteristics: [{ type: rootFingerprint, params: [{ name: "EncodedCertificate", value: result.identityCertificate }] }] }] },
            { type: "My", characteristics: [{ type: "System", characteristics: [{ type: clientFingerprint, params: [{ name: "EncodedCertificate", value: result.signedCertificate }] }, { type: "PrivateKeyContainer" }] }] },
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
          ],
          characteristics: [
            { type: "APPAUTH", params: [{ name: "AAUTHLEVEL", value: "CLIENT" }, { name: "AAUTHTYPE", value: "DIGEST" }, { name: "AAUTHSECRET", value: "dummy" }, { name: "AAUTHDATA", value: "nonce" }] },
            { type: "APPAUTH", params: [{ name: "AAUTHLEVEL", value: "APPSRV" }, { name: "AAUTHTYPE", value: "DIGEST" }, { name: "AAUTHNAME", value: result.username }, { name: "AAUTHSECRET", value: result.secret }, { name: "AAUTHDATA", value: "nonce" }] },
          ],
        },
        {
          type: "DMClient",
          characteristics: [{ type: "Provider", characteristics: [{ type: result.providerId, characteristics: [{ type: "Poll", params: [{ name: "PollOnLogin", value: "true", datatype: "boolean" }] }] }] }],
        },
      ],
    };
    return yield* serializeSoapElement(WapProvisioningDoc, doc).pipe(
      Effect.mapError((cause) => new WstepError("Failed to serialize provisioning document", cause)),
    );
  });
}

export function encodeProvisioningDoc(xml: string): string {
  return arrayBufferToBase64(new TextEncoder().encode(xml).buffer as ArrayBuffer);
}
