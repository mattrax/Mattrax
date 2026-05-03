import { Schema } from "effect";
import { DiscoverNs, PolicyNs } from "./namespaces.js";

// ---------------------------------------------------------------------------
// Discovery Service
// ---------------------------------------------------------------------------

export const DiscoverRequest = Schema.Struct({
  request: Schema.Struct({
    emailAddress: Schema.optional(Schema.String).pipe(
      Schema.annotateKey({ soapElementName: "EmailAddress" })
    ),
    requestVersion: Schema.String.pipe(
      Schema.annotateKey({ soapElementName: "RequestVersion" })
    ),
    deviceType: Schema.String.pipe(
      Schema.annotateKey({ soapElementName: "DeviceType" })
    ),
    applicationVersion: Schema.String.pipe(
      Schema.annotateKey({ soapElementName: "ApplicationVersion" })
    ),
    osEdition: Schema.Number.pipe(
      Schema.annotateKey({ soapElementName: "OSEdition" })
    ),
    authPolicies: Schema.Array(
      Schema.String.pipe(Schema.annotateKey({ soapElementName: "AuthPolicy" }))
    ).pipe(Schema.annotateKey({ soapElementName: "AuthPolicies" })),
  }).pipe(
    Schema.annotate({
      identifier: "request",
    })
  ),
}).pipe(
  Schema.annotate({
    identifier: "Discover",
    soapNamespace: DiscoverNs,
  })
);

export type DiscoverRequest = typeof DiscoverRequest.Type;

export const DiscoverResult = Schema.Struct({
  authPolicy: Schema.String.pipe(
    Schema.annotateKey({ soapElementName: "AuthPolicy" })
  ),
  enrollmentVersion: Schema.String.pipe(
    Schema.annotateKey({ soapElementName: "EnrollmentVersion" })
  ),
  enrollmentPolicyServiceUrl: Schema.String.pipe(
    Schema.annotateKey({ soapElementName: "EnrollmentPolicyServiceUrl" })
  ),
  enrollmentServiceUrl: Schema.String.pipe(
    Schema.annotateKey({ soapElementName: "EnrollmentServiceUrl" })
  ),
  authServiceUrl: Schema.optional(Schema.String).pipe(
    Schema.annotateKey({ soapElementName: "AuthenticationServiceUrl" })
  ),
}).pipe(
  Schema.annotate({
    identifier: "DiscoverResult",
  })
);

export type DiscoverResult = typeof DiscoverResult.Type;

export const DiscoverResponse = Schema.Struct({
  discoverResult: DiscoverResult.pipe(
    Schema.annotateKey({ soapElementName: "DiscoverResult" })
  ),
}).pipe(
  Schema.annotate({
    identifier: "DiscoverResponse",
    soapNamespace: DiscoverNs,
  })
);

export type DiscoverResponse = typeof DiscoverResponse.Type;

// ---------------------------------------------------------------------------
// Policy Service (MS-XCEP)
// ---------------------------------------------------------------------------

export const GetPoliciesClient = Schema.Struct({
  lastUpdate: Schema.optional(Schema.String).pipe(
    Schema.annotateKey({ soapElementName: "lastUpdate", soapOptionalNil: true })
  ),
  preferredLanguage: Schema.optional(Schema.String).pipe(
    Schema.annotateKey({ soapElementName: "preferredLanguage", soapOptionalNil: true })
  ),
  tpmManufacturer: Schema.optional(Schema.String).pipe(
    Schema.annotateKey({ soapElementName: "TPMManufacturer" })
  ),
  tpmFirmwareVersion: Schema.optional(Schema.String).pipe(
    Schema.annotateKey({ soapElementName: "TPMFirmwareVersion" })
  ),
}).pipe(
  Schema.annotate({
    identifier: "client",
  })
);

export type GetPoliciesClient = typeof GetPoliciesClient.Type;

export const GetPolicies = Schema.Struct({
  client: GetPoliciesClient.pipe(Schema.annotateKey({ soapElementName: "client" })),
  requestFilter: Schema.optional(Schema.String).pipe(
    Schema.annotateKey({ soapElementName: "requestFilter", soapOptionalNil: true })
  ),
}).pipe(
  Schema.annotate({
    identifier: "GetPolicies",
    soapNamespace: PolicyNs,
  })
);

export type GetPolicies = typeof GetPolicies.Type;

// ---------------------------------------------------------------------------
// Enrollment Service (MS-WSTEP)
// ---------------------------------------------------------------------------

export const BinarySecurityToken = Schema.Struct({
  valueType: Schema.String.pipe(
    Schema.annotateKey({ soapAttribute: true, soapAttributeName: "ValueType" })
  ),
  encodingType: Schema.String.pipe(
    Schema.annotateKey({ soapAttribute: true, soapAttributeName: "EncodingType" })
  ),
  content: Schema.String,
}).pipe(
  Schema.annotate({
    identifier: "BinarySecurityToken",
  })
);

export type BinarySecurityToken = typeof BinarySecurityToken.Type;

export const ContextItem = Schema.Struct({
  name: Schema.String.pipe(
    Schema.annotateKey({ soapAttribute: true, soapAttributeName: "Name" })
  ),
  value: Schema.String.pipe(Schema.annotateKey({ soapElementName: "Value" })),
}).pipe(
  Schema.annotate({
    identifier: "ContextItem",
  })
);

export type ContextItem = typeof ContextItem.Type;

export const AdditionalContext = Schema.Struct({
  contextItems: Schema.Array(ContextItem).pipe(
    Schema.annotateKey({ soapElementName: "ContextItem" })
  ),
}).pipe(
  Schema.annotate({
    identifier: "AdditionalContext",
    soapNamespace: "http://schemas.xmlsoap.org/ws/2006/12/authorization",
    soapNamespacePrefix: "ac",
  })
);

export type AdditionalContext = typeof AdditionalContext.Type;

export const RequestSecurityToken = Schema.Struct({
  tokenType: Schema.String.pipe(Schema.annotateKey({ soapElementName: "TokenType" })),
  requestType: Schema.String.pipe(Schema.annotateKey({ soapElementName: "RequestType" })),
  binarySecurityToken: BinarySecurityToken.pipe(
    Schema.annotateKey({ soapElementName: "BinarySecurityToken" })
  ),
  additionalContext: AdditionalContext.pipe(
    Schema.annotateKey({ soapElementName: "AdditionalContext" })
  ),
}).pipe(
  Schema.annotate({
    identifier: "RequestSecurityToken",
    soapNamespace: "http://docs.oasis-open.org/ws-sx/ws-trust/200512",
    soapNamespacePrefix: "wst",
  })
);

export type RequestSecurityToken = typeof RequestSecurityToken.Type;

export const RequestedSecurityToken = Schema.Struct({
  binarySecurityToken: BinarySecurityToken.pipe(
    Schema.annotateKey({ soapElementName: "BinarySecurityToken" })
  ),
}).pipe(
  Schema.annotate({
    identifier: "RequestedSecurityToken",
  })
);

export type RequestedSecurityToken = typeof RequestedSecurityToken.Type;

export const RequestSecurityTokenResponse = Schema.Struct({
  tokenType: Schema.String.pipe(Schema.annotateKey({ soapElementName: "TokenType" })),
  dispositionMessage: Schema.String.pipe(Schema.annotateKey({ soapElementName: "DispositionMessage" })),
  requestedSecurityToken: RequestedSecurityToken.pipe(
    Schema.annotateKey({ soapElementName: "RequestedSecurityToken" })
  ),
  requestID: Schema.String.pipe(Schema.annotateKey({ soapElementName: "RequestID" })),
}).pipe(
  Schema.annotate({
    identifier: "RequestSecurityTokenResponse",
  })
);

export type RequestSecurityTokenResponse = typeof RequestSecurityTokenResponse.Type;

export const RequestSecurityTokenResponseCollection = Schema.Struct({
  requestSecurityTokenResponse: RequestSecurityTokenResponse.pipe(
    Schema.annotateKey({ soapElementName: "RequestSecurityTokenResponse" })
  ),
}).pipe(
  Schema.annotate({
    identifier: "RequestSecurityTokenResponseCollection",
    soapNamespace: "http://docs.oasis-open.org/ws-sx/ws-trust/200512",
  })
);

export type RequestSecurityTokenResponseCollection = typeof RequestSecurityTokenResponseCollection.Type;

// ---------------------------------------------------------------------------
// SOAP Fault
// ---------------------------------------------------------------------------

export const SoapFaultCode = Schema.Struct({
  value: Schema.String.pipe(Schema.annotateKey({ soapElementName: "Value", soapNamespacePrefix: "s" })),
  subcode: Schema.optional(
    Schema.Struct({
      value: Schema.String.pipe(Schema.annotateKey({ soapElementName: "Value", soapNamespacePrefix: "s" })),
    }).pipe(Schema.annotate({ identifier: "Subcode", soapNamespacePrefix: "s" }))
  ).pipe(Schema.annotateKey({ soapElementName: "Subcode", soapNamespacePrefix: "s" })),
}).pipe(
  Schema.annotate({
    identifier: "Code",
    soapNamespacePrefix: "s",
  })
);

export type SoapFaultCode = typeof SoapFaultCode.Type;

export const SoapFaultReason = Schema.Struct({
  text: Schema.Struct({
    lang: Schema.String.pipe(
      Schema.annotateKey({ soapAttribute: true, soapAttributeName: "xml:lang" })
    ),
    content: Schema.String.pipe(
      Schema.annotateKey({ soapTextContent: true })
    ),
  }).pipe(Schema.annotate({ identifier: "Text", soapElementName: "Text", soapNamespacePrefix: "s" })),
}).pipe(
  Schema.annotate({
    identifier: "Reason",
    soapNamespacePrefix: "s",
  })
);

export type SoapFaultReason = typeof SoapFaultReason.Type;

export const SoapFault = Schema.Struct({
  code: SoapFaultCode.pipe(Schema.annotateKey({ soapElementName: "Code", soapNamespacePrefix: "s" })),
  reason: SoapFaultReason.pipe(Schema.annotateKey({ soapElementName: "Reason", soapNamespacePrefix: "s" })),
}).pipe(
  Schema.annotate({
    identifier: "Fault",
    soapNamespacePrefix: "s",
  })
);

export type SoapFault = typeof SoapFault.Type;
