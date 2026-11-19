import { Cause, Context, Data, Effect, Layer, Predicate, Schema } from "effect";
import {
  deserializeSoapElement,
  extractSoapBody,
  extractSoapHeader,
  serializeSoapElement,
  serializeSoapEnvelope,
} from "@mattrax/soap";
import {
  DiscoverRequest,
  DiscoverResponse,
  GetPolicies,
  GetPoliciesResponse,
  RequestSecurityToken,
  RequestSecurityTokenResponseCollection,
  SoapFault,
  type SyncML as SyncMLType,
} from "./messages.js";
import {
  ManagementBackend,
  MdmOrigin,
  type WindowsFailurePhase,
  type WindowsManagementScope,
} from "@mattrax/management-backend";
import {
  buildProvisioningDoc,
  encodeProvisioningDoc,
  BASE64_ENCODING_TYPE,
  PROVISION_DOC_TYPE,
  TOKEN_TYPE,
} from "./wstep.js";
import {
  fromManagementResponse,
  parseSyncML,
  serializeSyncML,
  toManagementRequest,
} from "./syncml.js";

export class WindowsMdmError extends Data.TaggedError("WindowsMdmError")<{
  message: string;
  cause?: unknown;
  /** Where the fault happened, when it is more specific than the endpoint. */
  phase?: WindowsFailurePhase;
  /** Stable code for the recorded failure history. */
  code?: string;
  /** The backend wrote this failure to its durable history. */
  recorded?: boolean;
}> {}

/**
 * Request-scoped context the HTTP layer forwards from URL/headers. The tenant
 * token travels in `?tenant=` and identifies which organization the enrollment
 * link belongs to; the identity fields come from the verified mTLS handshake.
 */
export type WindowsMdmRequestContext = {
  readonly tenantToken?: string;
  readonly identityCertificate?: string;
  readonly identityCertificateSerial?: string;
};

export interface WindowsMdmServiceContract {
  readonly mdmOrigin: MdmOrigin;
  readonly discovery: (
    xml: string,
    context?: WindowsMdmRequestContext,
  ) => Effect.Effect<string, WindowsMdmError>;
  readonly policy: (
    xml: string,
    context?: WindowsMdmRequestContext,
  ) => Effect.Effect<string, WindowsMdmError>;
  readonly enroll: (
    xml: string,
    context?: WindowsMdmRequestContext,
  ) => Effect.Effect<string, WindowsMdmError>;
  readonly management: (
    xml: string,
    context?: WindowsMdmRequestContext,
  ) => Effect.Effect<string, WindowsMdmError>;
  readonly fault: (message: string, relatesTo?: string) => Effect.Effect<string, never>;
}

export class WindowsMdmService extends Context.Service<
  WindowsMdmService,
  WindowsMdmServiceContract
>()("WindowsMdmService") {}

export declare namespace WindowsMdmService {
  export type Service = WindowsMdmServiceContract;
}

const ManagementCheckinEvent = Schema.TaggedStruct("ManagementCheckin", {
  deviceId: Schema.String,
});

const action = {
  discovery:
    "http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/DiscoverResponse",
  policy:
    "http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy/IPolicy/GetPoliciesResponse",
  enroll: "http://docs.oasis-open.org/ws-sx/ws-trust/200512/RSTRC/IssueFinal",
  fault: "http://www.w3.org/2005/08/addressing/fault",
};

function extractBinarySecurityToken(xml: string): string | null {
  const match = xml.match(
    /<[^>]*BinarySecurityToken\b[^>]*>([\s\S]*?)<\/[^>]*BinarySecurityToken>/i,
  );

  return match?.[1]?.replace(/\s/g, "") ?? null;
}

function contextMap(request: RequestSecurityToken) {
  const entries: Record<string, string> = {};

  for (const item of request.additionalContext.contextItems) entries[item.name] = item.value;

  return entries;
}

function policyResponse(policy: {
  minimalKeyLength: string;
  certificateValidityPeriodSeconds: string;
  renewalPeriodSeconds: string;
}): GetPoliciesResponse {
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
            certificateValidity: {
              validityPeriodSeconds: policy.certificateValidityPeriodSeconds,
              renewalPeriodSeconds: policy.renewalPeriodSeconds,
            },
            permission: { enroll: "true", autoEnroll: "false" },
            privateKeyAttributes: {
              minimalKeyLength: policy.minimalKeyLength,
              cryptoProviders: [
                { content: "Microsoft Platform Crypto Provider" },
                { content: "Microsoft Software Key Storage Provider" },
              ],
            },
          },
        },
      },
    },
    oIDs: {
      oID: [
        {
          value: "2.16.840.1.101.3.4.2.1",
          group: "4",
          oIDReferenceID: "0",
          defaultName: "szOID_NIST_sha256",
        },
        {
          value: "1.2.840.113549.1.1.1",
          group: "3",
          oIDReferenceID: "1",
          defaultName: "szOID_RSA_RSA",
        },
      ],
    },
  };
}

export const WindowsMdmServiceLive = (config: { origin: string; providerId?: string }) =>
  Layer.effect(
    WindowsMdmService,
    Effect.gen(function* () {
      const backend = yield* ManagementBackend;
      const mdmOrigin = new MdmOrigin({ url: config.origin });
      const providerId = config.providerId ?? "Mattrax";
      const url = (path: string) => `${config.origin}/mdm/windows/${path}`;

      /**
       * `UnknownDevice` covers an invalid/expired tenant token as well as an
       * unknown device. Give the operator a concrete recovery step instead of
       * leaking the generic backend error into the SOAP fault.
       *
       * A backend failure carries whether it was written to the durable
       * history, so an unattributable failure is still recorded here.
       */
      const backendRecorded = (cause: unknown): boolean =>
        Schema.is(Schema.Struct({ recorded: Schema.optional(Schema.Boolean) }))(cause)
          ? cause.recorded === true
          : false;

      const backendError = (message: string, cause: unknown) => {
        const recorded = backendRecorded(cause);

        if (Predicate.isTagged(cause, "UnknownDevice"))
          return new WindowsMdmError({
            message:
              "This Windows enrollment link is invalid or has expired. Open a fresh enrollment link from the tenant's enrollment page.",
            cause,
            code: "unknown_device",
            recorded,
          });

        return new WindowsMdmError({
          message,
          cause,
          code: Predicate.isTagged(cause, "InternalServerError") ? "internal_error" : undefined,
          recorded,
        });
      };

      /**
       * Persist a fault the backend never wrote. Never affects the response and
       * never throws: the fault the device receives is already decided.
       */
      const recordFault = (
        phase: WindowsFailurePhase,
        context: WindowsMdmRequestContext,
        cause: Cause.Cause<unknown>,
        fallbackMessage: string,
        deviceId?: string,
      ) =>
        Effect.suspend(() => {
          const record = backend.windowsRecordFailure;

          // A shutdown or client abort is not a Windows failure.
          if (!record || Cause.hasInterruptsOnly(cause)) return Effect.void;

          let error: unknown;

          try {
            error = Cause.squash(cause);
          } catch {
            error = undefined;
          }

          const mdmError = error instanceof WindowsMdmError ? error : undefined;

          if (mdmError?.recorded) return Effect.void;

          const code =
            mdmError?.code ??
            (Predicate.isTagged(error, "UnknownDevice")
              ? "unknown_device"
              : Predicate.isTagged(error, "InternalServerError")
                ? "internal_error"
                : "soap_fault");

          return record({
            phase: mdmError?.phase ?? phase,
            code,
            message: mdmError?.message.trim() || fallbackMessage,
            detail: mdmError?.cause === undefined ? undefined : String(mdmError.cause),
            tenantToken: context.tenantToken,
            identityCertificate: context.identityCertificate,
            identityCertificateSerial: context.identityCertificateSerial,
            deviceId,
          }).pipe(Effect.catchCause(() => Effect.void));
        });

      const envelope = (body: string, relatesTo: string | undefined, actionValue: string) =>
        serializeSoapEnvelope({
          header: { action: actionValue, relatesTo, messageId: `urn:uuid:${crypto.randomUUID()}` },
          body,
          namespaces: {
            xsi: "http://www.w3.org/2001/XMLSchema-instance",
            xsd: "http://www.w3.org/2001/XMLSchema",
          },
        });

      const fault = (message: string, relatesTo?: string) =>
        Effect.succeed(
          envelope(
            Effect.runSync(
              serializeSoapElement(SoapFault, {
                code: { value: "s:Receiver" },
                reason: { text: { lang: "en-us", content: message } },
              }),
            ),
            relatesTo,
            action.fault,
          ),
        );

      return WindowsMdmService.of({
        mdmOrigin,
        fault,
        discovery: (xml, context = {}) =>
          Effect.gen(function* () {
            const header = extractSoapHeader(xml);
            const body = extractSoapBody(xml);

            const req = yield* deserializeSoapElement(body, DiscoverRequest).pipe(
              Effect.mapError(
                (cause) =>
                  new WindowsMdmError({
                    message: "Invalid discovery request",
                    cause,
                    phase: "discovery",
                    code: "invalid_request",
                  }),
              ),
            );

            const result = yield* backend
              .windowsDiscovery({
                ...req.request,
                mdmOrigin,
                emailAddress: req.request.emailAddress,
                tenantToken: context.tenantToken,
              })
              .pipe(Effect.mapError((cause) => backendError("Discovery backend failed", cause)));

            const response: DiscoverResponse = {
              discoverResult: {
                authPolicy: result.authPolicy,
                enrollmentVersion: result.enrollmentVersion,
                enrollmentPolicyServiceUrl: result.enrollmentPolicyServiceUrl || url("policy"),
                enrollmentServiceUrl: result.enrollmentServiceUrl || url("enroll"),
                authServiceUrl: result.authServiceUrl,
              },
            };

            const responseBody = yield* serializeSoapElement(DiscoverResponse, response).pipe(
              Effect.mapError(
                (cause) =>
                  new WindowsMdmError({
                    message: "Failed to serialize discovery response",
                    cause,
                    phase: "discovery",
                    code: "response_serialization_failed",
                  }),
              ),
            );

            return envelope(responseBody, header.messageId, action.discovery);
          }).pipe(
            Effect.tapCause((cause) =>
              recordFault("discovery", context, cause, "Invalid SOAP request"),
            ),
          ),
        policy: (xml, context = {}) =>
          Effect.gen(function* () {
            const header = extractSoapHeader(xml);
            const token = extractBinarySecurityToken(header.securityXml ?? "");

            if (!token)
              return yield* Effect.fail(
                new WindowsMdmError({
                  message: "Missing binary security token",
                  phase: "policy",
                  code: "missing_token",
                }),
              );
            const body = extractSoapBody(xml);
            yield* deserializeSoapElement(body, GetPolicies).pipe(
              Effect.mapError(
                (cause) =>
                  new WindowsMdmError({
                    message: "Invalid policy request",
                    cause,
                    phase: "policy",
                    code: "invalid_request",
                  }),
              ),
            );

            const policy = yield* backend
              .getWindowsEnrollmentPolicy(token, { tenantToken: context.tenantToken })
              .pipe(Effect.mapError((cause) => backendError("Policy backend failed", cause)));

            const responseBody = yield* serializeSoapElement(
              GetPoliciesResponse,
              policyResponse(policy),
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new WindowsMdmError({
                    message: "Failed to serialize policy response",
                    cause,
                    phase: "policy",
                    code: "response_serialization_failed",
                  }),
              ),
            );

            return envelope(responseBody, header.messageId, action.policy);
          }).pipe(
            Effect.tapCause((cause) =>
              recordFault("policy", context, cause, "Invalid SOAP request"),
            ),
          ),
        enroll: (xml, context = {}) => {
          let requestDeviceId: string | undefined;

          return Effect.gen(function* () {
            const header = extractSoapHeader(xml);
            const token = extractBinarySecurityToken(header.securityXml ?? "");

            if (!token)
              return yield* Effect.fail(
                new WindowsMdmError({
                  message: "Missing binary security token",
                  phase: "enrollment",
                  code: "missing_token",
                }),
              );

            const req = yield* deserializeSoapElement(
              extractSoapBody(xml),
              RequestSecurityToken,
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new WindowsMdmError({
                    message: "Invalid enrollment request",
                    cause,
                    phase: "enrollment",
                    code: "invalid_request",
                  }),
              ),
            );

            const ctx = contextMap(req);
            requestDeviceId = ctx.DeviceID ?? ctx.DeviceId;

            const result = yield* backend
              .windowsEnroll({
                authToken: token,
                csr: req.binarySecurityToken.content,
                deviceId: ctx.DeviceID ?? ctx.DeviceId,
                deviceName: ctx.DeviceName,
                enrollmentType: ctx.EnrollmentType,
                context: ctx,
                mdmOrigin,
                tenantToken: context.tenantToken,
              })
              .pipe(Effect.mapError((cause) => backendError("Enrollment backend failed", cause)));

            // Keep the tenant token on the management URL too. The certificate
            // OU remains the authoritative identity, but preserving the token
            // lets a device that has not yet presented mTLS resolve its tenant.
            const managementUrl = context.tenantToken
              ? `${url("management")}?tenant=${encodeURIComponent(context.tenantToken)}`
              : url("management");

            const provisioning = yield* buildProvisioningDoc(
              { ...result, providerId: result.providerId || providerId },
              managementUrl,
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new WindowsMdmError({
                    message: "Provisioning document failed",
                    cause,
                    phase: "wstep",
                    code: "provisioning_document_failed",
                  }),
              ),
            );

            const response: RequestSecurityTokenResponseCollection = {
              requestSecurityTokenResponse: {
                tokenType: TOKEN_TYPE,
                dispositionMessage: "",
                requestedSecurityToken: {
                  binarySecurityToken: {
                    valueType: PROVISION_DOC_TYPE,
                    encodingType: BASE64_ENCODING_TYPE,
                    content: encodeProvisioningDoc(provisioning),
                  },
                },
                requestID: "0",
              },
            };

            const responseBody = yield* serializeSoapElement(
              RequestSecurityTokenResponseCollection,
              response,
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new WindowsMdmError({
                    message: "Failed to serialize enrollment response",
                    cause,
                    phase: "enrollment",
                    code: "response_serialization_failed",
                  }),
              ),
            );

            return envelope(responseBody, header.messageId, action.enroll);
          }).pipe(
            Effect.tapCause((cause) =>
              recordFault("enrollment", context, cause, "Invalid SOAP request", requestDeviceId),
            ),
          );
        },
        management: (xml, context = {}) => {
          let requestDeviceId: string | undefined;

          return Effect.gen(function* () {
            const sync = yield* parseSyncML(xml).pipe(
              Effect.mapError(
                (cause) =>
                  new WindowsMdmError({
                    message: "Invalid SyncML request",
                    cause,
                    phase: "command",
                    code: "invalid_syncml",
                  }),
              ),
            );

            requestDeviceId = sync.syncHdr.source.locURI;

            const scope: WindowsManagementScope = {
              deviceId: sync.syncHdr.source.locURI,
              identityCertificate: context.identityCertificate,
              identityCertificateSerial: context.identityCertificateSerial,
              tenantToken: context.tenantToken,
              mdmOrigin,
            };

            const backendResponse = yield* backend
              .windowsManagementCheckin(scope, toManagementRequest(sync))
              .pipe(Effect.mapError((cause) => backendError("Management backend failed", cause)));

            // The event is an acknowledgement (a command result or the tail of
            // enrollment). The backend records its own failure, but it must be
            // logged instead of disappearing: the device already has its
            // response, so this never changes the SyncML status.
            yield* backend
              .windowsDeviceEvent(scope, ManagementCheckinEvent.make({ deviceId: scope.deviceId }))
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning(
                    `Windows device event failed for ${scope.deviceId}: ${String(cause)}`,
                  ),
                ),
              );
            const response: SyncMLType = fromManagementResponse(sync, backendResponse);

            return yield* serializeSyncML(response).pipe(
              Effect.mapError(
                (cause) =>
                  new WindowsMdmError({
                    message: "Failed to serialize SyncML response",
                    cause,
                    phase: "command",
                    code: "response_serialization_failed",
                  }),
              ),
            );
          }).pipe(
            Effect.tapCause((cause) =>
              recordFault("command", context, cause, "Invalid SyncML request", requestDeviceId),
            ),
          );
        },
      });
    }),
  );
