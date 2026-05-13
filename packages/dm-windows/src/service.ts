import { Context, Effect, Layer } from "effect";
import {
  DiscoverRequest,
  DiscoverResponse,
  GetPolicies,
  GetPoliciesResponse,
  RequestSecurityToken,
  RequestSecurityTokenResponseCollection,
  SoapFault,
  deserializeSoapElement,
  extractSoapBody,
  extractSoapHeader,
  serializeSoapElement,
  serializeSoapEnvelope,
  type SyncML as SyncMLType,
} from "@mattrax/soap";
import { ManagementBackend, MdmOrigin, type WindowsManagementScope } from "@mattrax/management-backend";
import { buildProvisioningDoc, encodeProvisioningDoc, BASE64_ENCODING_TYPE, PROVISION_DOC_TYPE, TOKEN_TYPE } from "./wstep.js";
import { fromManagementResponse, parseSyncML, serializeSyncML, toManagementRequest } from "./syncml.js";

export class WindowsMdmError {
  readonly _tag = "WindowsMdmError";
  constructor(readonly message: string, readonly cause?: unknown) {}
}

export class WindowsMdmService extends Context.Service<
  WindowsMdmService,
  {
    readonly mdmOrigin: MdmOrigin;
    readonly discovery: (xml: string) => Effect.Effect<string, WindowsMdmError>;
    readonly policy: (xml: string) => Effect.Effect<string, WindowsMdmError>;
    readonly enroll: (xml: string) => Effect.Effect<string, WindowsMdmError>;
    readonly management: (xml: string, identityCertificate?: string) => Effect.Effect<string, WindowsMdmError>;
    readonly fault: (message: string, relatesTo?: string) => Effect.Effect<string, never>;
  }
>()("WindowsMdmService") {}

const action = {
  discovery: "http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/DiscoverResponse",
  policy: "http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy/IPolicy/GetPoliciesResponse",
  enroll: "http://docs.oasis-open.org/ws-sx/ws-trust/200512/RSTRC/IssueFinal",
  fault: "http://www.w3.org/2005/08/addressing/fault",
};

function extractBinarySecurityToken(xml: string): string | null {
  const match = xml.match(/<[^>]*BinarySecurityToken\b[^>]*>([\s\S]*?)<\/[^>]*BinarySecurityToken>/i);
  return match?.[1]?.replace(/\s/g, "") ?? null;
}

function contextMap(request: RequestSecurityToken): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const item of request.additionalContext.contextItems) entries[item.name] = item.value;
  return entries;
}

function policyResponse(policy: { minimalKeyLength: string; certificateValidityPeriodSeconds: string; renewalPeriodSeconds: string }): GetPoliciesResponse {
  return {
    response: {
      policyFriendlyName: { xsi: "true" },
      nextUpdateHours: { xsi: "true" },
      policiesNotChanged: { xsi: "true" },
      policies: {
        policy: {
          policyOIDReference: "0",
          cAs: { xsi: "true" },
          attributes: {
            commonName: "MattraxAttributes",
            policySchema: "3",
            hashAlgorithmOIDReference: "0",
            revision: { majorRevision: "101", minorRevision: "0" },
            certificateValidity: { validityPeriodSeconds: policy.certificateValidityPeriodSeconds, renewalPeriodSeconds: policy.renewalPeriodSeconds },
            permission: { enroll: "true", autoEnroll: "false" },
            privateKeyAttributes: {
              minimalKeyLength: policy.minimalKeyLength,
              cryptoProviders: [{ content: "Microsoft Platform Crypto Provider" }, { content: "Microsoft Software Key Storage Provider" }],
            },
          },
        },
      },
    },
    oIDs: { oID: [{ value: "2.16.840.1.101.3.4.2.1", group: "4", oIDReferenceID: "0", defaultName: "szOID_NIST_sha256" }, { value: "1.2.840.113549.1.1.1", group: "3", oIDReferenceID: "1", defaultName: "szOID_RSA_RSA" }] },
  };
}

export const WindowsMdmServiceLive = (config: { origin: string; providerId?: string }) => Layer.effect(
  WindowsMdmService,
  Effect.gen(function* () {
    const backend = yield* ManagementBackend;
    const mdmOrigin = new MdmOrigin({ url: config.origin });
    const providerId = config.providerId ?? "Mattrax";
    const url = (path: string) => `${config.origin}/mdm/windows/${path}`;

    const envelope = (body: string, relatesTo: string | undefined, actionValue: string) => serializeSoapEnvelope({
      header: { action: actionValue, relatesTo, messageId: `urn:uuid:${crypto.randomUUID()}` },
      body,
      namespaces: { xsi: "http://www.w3.org/2001/XMLSchema-instance", xsd: "http://www.w3.org/2001/XMLSchema" },
    });

    const fault = (message: string, relatesTo?: string) => Effect.succeed(envelope(
      Effect.runSync(serializeSoapElement(SoapFault, { code: { value: "s:Receiver" }, reason: { text: { lang: "en-us", content: message } } })),
      relatesTo,
      action.fault,
    ));

    return WindowsMdmService.of({
      mdmOrigin,
      fault,
      discovery: (xml) => Effect.gen(function* () {
        const header = extractSoapHeader(xml);
        const body = extractSoapBody(xml);
        const req = yield* deserializeSoapElement(body, DiscoverRequest).pipe(Effect.mapError((cause) => new WindowsMdmError("Invalid discovery request", cause)));
        const result = yield* backend.windowsDiscovery({
          ...req.request,
          mdmOrigin,
          emailAddress: req.request.emailAddress,
        }).pipe(Effect.mapError((cause) => new WindowsMdmError("Discovery backend failed", cause)));
        const response: DiscoverResponse = {
          discoverResult: {
            authPolicy: result.authPolicy,
            enrollmentVersion: result.enrollmentVersion,
            enrollmentPolicyServiceUrl: result.enrollmentPolicyServiceUrl || url("policy"),
            enrollmentServiceUrl: result.enrollmentServiceUrl || url("enroll"),
            authServiceUrl: result.authServiceUrl,
          },
        };
        const responseBody = yield* serializeSoapElement(DiscoverResponse, response).pipe(Effect.mapError((cause) => new WindowsMdmError("Failed to serialize discovery response", cause)));
        return envelope(responseBody, header.messageId, action.discovery);
      }),
      policy: (xml) => Effect.gen(function* () {
        const header = extractSoapHeader(xml);
        const token = extractBinarySecurityToken(header.securityXml ?? xml);
        if (!token) return yield* Effect.fail(new WindowsMdmError("Missing binary security token"));
        const body = extractSoapBody(xml);
        yield* deserializeSoapElement(body, GetPolicies).pipe(Effect.mapError((cause) => new WindowsMdmError("Invalid policy request", cause)));
        const policy = yield* backend.getWindowsEnrollmentPolicy(token).pipe(Effect.mapError((cause) => new WindowsMdmError("Policy backend failed", cause)));
        const responseBody = yield* serializeSoapElement(GetPoliciesResponse, policyResponse(policy)).pipe(Effect.mapError((cause) => new WindowsMdmError("Failed to serialize policy response", cause)));
        return envelope(responseBody, header.messageId, action.policy);
      }),
      enroll: (xml) => Effect.gen(function* () {
        const header = extractSoapHeader(xml);
        const token = extractBinarySecurityToken(header.securityXml ?? xml);
        if (!token) return yield* Effect.fail(new WindowsMdmError("Missing binary security token"));
        const req = yield* deserializeSoapElement(extractSoapBody(xml), RequestSecurityToken).pipe(Effect.mapError((cause) => new WindowsMdmError("Invalid enrollment request", cause)));
        const ctx = contextMap(req);
        const result = yield* backend.windowsEnroll({
          authToken: token,
          csr: req.binarySecurityToken.content,
          deviceId: ctx.DeviceID ?? ctx.DeviceId,
          deviceName: ctx.DeviceName,
          enrollmentType: ctx.EnrollmentType,
          context: ctx,
          mdmOrigin,
        }).pipe(Effect.mapError((cause) => new WindowsMdmError("Enrollment backend failed", cause)));
        const provisioning = yield* buildProvisioningDoc({ ...result, providerId: result.providerId || providerId }, url("management")).pipe(Effect.mapError((cause) => new WindowsMdmError("Provisioning document failed", cause)));
        const response: RequestSecurityTokenResponseCollection = {
          requestSecurityTokenResponse: {
            tokenType: TOKEN_TYPE,
            dispositionMessage: "",
            requestedSecurityToken: { binarySecurityToken: { valueType: PROVISION_DOC_TYPE, encodingType: BASE64_ENCODING_TYPE, content: encodeProvisioningDoc(provisioning) } },
            requestID: "0",
          },
        };
        const responseBody = yield* serializeSoapElement(RequestSecurityTokenResponseCollection, response).pipe(Effect.mapError((cause) => new WindowsMdmError("Failed to serialize enrollment response", cause)));
        return envelope(responseBody, header.messageId, action.enroll);
      }),
      management: (xml, identityCertificate) => Effect.gen(function* () {
        const sync = yield* parseSyncML(xml).pipe(Effect.mapError((cause) => new WindowsMdmError("Invalid SyncML request", cause)));
        const scope: WindowsManagementScope = { deviceId: sync.syncHdr.source.locURI, identityCertificate, mdmOrigin };
        const backendResponse = yield* backend.windowsManagementCheckin(scope, toManagementRequest(sync)).pipe(Effect.mapError((cause) => new WindowsMdmError("Management backend failed", cause)));
        yield* backend.windowsDeviceEvent(scope, { _tag: "ManagementCheckin", deviceId: scope.deviceId }).pipe(Effect.match({ onFailure: () => undefined, onSuccess: () => undefined }));
        const response: SyncMLType = fromManagementResponse(sync, backendResponse);
        return yield* serializeSyncML(response).pipe(Effect.mapError((cause) => new WindowsMdmError("Failed to serialize SyncML response", cause)));
      }),
    });
  }),
);
