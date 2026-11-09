import { Schema } from "effect";
import { DiscoverNs, PolicyNs, EnrollmentNs } from "./namespaces.js";

// ---------------------------------------------------------------------------
// Discovery Service
// ---------------------------------------------------------------------------

export const DiscoverRequest = Schema.Struct({
  request: Schema.Struct({
    emailAddress: Schema.optional(Schema.String).pipe(
      Schema.annotateKey({ soapElementName: "EmailAddress" }),
    ),
    requestVersion: Schema.String.pipe(Schema.annotateKey({ soapElementName: "RequestVersion" })),
    deviceType: Schema.String.pipe(Schema.annotateKey({ soapElementName: "DeviceType" })),
    applicationVersion: Schema.String.pipe(
      Schema.annotateKey({ soapElementName: "ApplicationVersion" }),
    ),
    osEdition: Schema.Number.pipe(Schema.annotateKey({ soapElementName: "OSEdition" })),
    authPolicies: Schema.Array(
      Schema.String.pipe(Schema.annotateKey({ soapElementName: "AuthPolicy" })),
    ).pipe(Schema.annotateKey({ soapElementName: "AuthPolicies" })),
  }).pipe(
    Schema.annotate({
      identifier: "request",
    }),
  ),
}).pipe(
  Schema.annotate({
    identifier: "Discover",
    soapNamespace: DiscoverNs,
  }),
);

export type DiscoverRequest = typeof DiscoverRequest.Type;

export const DiscoverResult = Schema.Struct({
  authPolicy: Schema.String.pipe(Schema.annotateKey({ soapElementName: "AuthPolicy" })),
  enrollmentVersion: Schema.String.pipe(
    Schema.annotateKey({ soapElementName: "EnrollmentVersion" }),
  ),
  enrollmentPolicyServiceUrl: Schema.String.pipe(
    Schema.annotateKey({ soapElementName: "EnrollmentPolicyServiceUrl" }),
  ),
  enrollmentServiceUrl: Schema.String.pipe(
    Schema.annotateKey({ soapElementName: "EnrollmentServiceUrl" }),
  ),
  authServiceUrl: Schema.optional(Schema.String).pipe(
    Schema.annotateKey({ soapElementName: "AuthenticationServiceUrl" }),
  ),
}).pipe(
  Schema.annotate({
    identifier: "DiscoverResult",
  }),
);

export type DiscoverResult = typeof DiscoverResult.Type;

export const DiscoverResponse = Schema.Struct({
  discoverResult: DiscoverResult.pipe(Schema.annotateKey({ soapElementName: "DiscoverResult" })),
}).pipe(
  Schema.annotate({
    identifier: "DiscoverResponse",
    soapNamespace: DiscoverNs,
  }),
);

export type DiscoverResponse = typeof DiscoverResponse.Type;

// ---------------------------------------------------------------------------
// Policy Service (MS-XCEP)
// ---------------------------------------------------------------------------

export const GetPoliciesClient = Schema.Struct({
  lastUpdate: Schema.optional(Schema.String).pipe(
    Schema.annotateKey({ soapElementName: "lastUpdate", soapOptionalNil: true }),
  ),
  preferredLanguage: Schema.optional(Schema.String).pipe(
    Schema.annotateKey({ soapElementName: "preferredLanguage", soapOptionalNil: true }),
  ),
  tpmManufacturer: Schema.optional(Schema.String).pipe(
    Schema.annotateKey({ soapElementName: "TPMManufacturer" }),
  ),
  tpmFirmwareVersion: Schema.optional(Schema.String).pipe(
    Schema.annotateKey({ soapElementName: "TPMFirmwareVersion" }),
  ),
}).pipe(
  Schema.annotate({
    identifier: "client",
  }),
);

export type GetPoliciesClient = typeof GetPoliciesClient.Type;

export const GetPolicies = Schema.Struct({
  client: GetPoliciesClient.pipe(Schema.annotateKey({ soapElementName: "client" })),
  requestFilter: Schema.optional(Schema.String).pipe(
    Schema.annotateKey({ soapElementName: "requestFilter", soapOptionalNil: true }),
  ),
}).pipe(
  Schema.annotate({
    identifier: "GetPolicies",
    soapNamespace: PolicyNs,
  }),
);

export type GetPolicies = typeof GetPolicies.Type;

export const ContentAttr = Schema.Struct({
  xsi: Schema.optional(Schema.String).pipe(
    Schema.annotateKey({ soapAttribute: true, soapAttributeName: "xsi:nil" }),
  ),
  xmlns: Schema.optional(Schema.String).pipe(
    Schema.annotateKey({ soapAttribute: true, soapAttributeName: "xmlns" }),
  ),
  content: Schema.optional(Schema.String).pipe(Schema.annotateKey({ soapTextContent: true })),
}).pipe(Schema.annotate({ identifier: "ContentAttr" }));
export type ContentAttr = typeof ContentAttr.Type;

export const GenericNil = Schema.Struct({
  xsi: Schema.optional(Schema.String).pipe(
    Schema.annotateKey({ soapAttribute: true, soapAttributeName: "xsi:nil" }),
  ),
}).pipe(Schema.annotate({ identifier: "GenericNil" }));

export const ProviderAttr = Schema.Struct({
  content: Schema.String.pipe(Schema.annotateKey({ soapTextContent: true })),
}).pipe(Schema.annotate({ identifier: "Provider" }));

export const GetPoliciesResponse = Schema.Struct({
  response: Schema.Struct({
    policyFriendlyName: ContentAttr.pipe(
      Schema.annotateKey({ soapElementName: "policyFriendlyName" }),
    ),
    nextUpdateHours: ContentAttr.pipe(Schema.annotateKey({ soapElementName: "nextUpdateHours" })),
    policiesNotChanged: ContentAttr.pipe(
      Schema.annotateKey({ soapElementName: "policiesNotChanged" }),
    ),
    policies: Schema.Struct({
      policy: Schema.Struct({
        policyOIDReference: Schema.String.pipe(
          Schema.annotateKey({ soapElementName: "policyOIDReference" }),
        ),
        cAs: GenericNil.pipe(Schema.annotateKey({ soapElementName: "cAs" })),
        attributes: Schema.Struct({
          commonName: Schema.String.pipe(Schema.annotateKey({ soapElementName: "commonName" })),
          policySchema: Schema.String.pipe(Schema.annotateKey({ soapElementName: "policySchema" })),
          hashAlgorithmOIDReference: Schema.String.pipe(
            Schema.annotateKey({ soapElementName: "hashAlgorithmOIDReference" }),
          ),
          revision: Schema.Struct({
            majorRevision: Schema.String.pipe(
              Schema.annotateKey({ soapElementName: "majorRevision" }),
            ),
            minorRevision: Schema.String.pipe(
              Schema.annotateKey({ soapElementName: "minorRevision" }),
            ),
          })
            .pipe(Schema.annotate({ identifier: "revision" }))
            .pipe(Schema.annotateKey({ soapElementName: "revision" })),
          certificateValidity: Schema.Struct({
            validityPeriodSeconds: Schema.String.pipe(
              Schema.annotateKey({ soapElementName: "validityPeriodSeconds" }),
            ),
            renewalPeriodSeconds: Schema.String.pipe(
              Schema.annotateKey({ soapElementName: "renewalPeriodSeconds" }),
            ),
          })
            .pipe(Schema.annotate({ identifier: "certificateValidity" }))
            .pipe(Schema.annotateKey({ soapElementName: "certificateValidity" })),
          permission: Schema.Struct({
            enroll: Schema.String.pipe(Schema.annotateKey({ soapElementName: "enroll" })),
            autoEnroll: Schema.String.pipe(Schema.annotateKey({ soapElementName: "autoEnroll" })),
          })
            .pipe(Schema.annotate({ identifier: "permission" }))
            .pipe(Schema.annotateKey({ soapElementName: "permission" })),
          privateKeyAttributes: Schema.Struct({
            minimalKeyLength: Schema.String.pipe(
              Schema.annotateKey({ soapElementName: "minimalKeyLength" }),
            ),
            cryptoProviders: Schema.Array(ProviderAttr).pipe(
              Schema.annotateKey({ soapElementName: "cryptoProviders" }),
            ),
          })
            .pipe(Schema.annotate({ identifier: "privateKeyAttributes" }))
            .pipe(Schema.annotateKey({ soapElementName: "privateKeyAttributes" })),
        })
          .pipe(Schema.annotate({ identifier: "attributes" }))
          .pipe(Schema.annotateKey({ soapElementName: "attributes" })),
      })
        .pipe(Schema.annotate({ identifier: "policy" }))
        .pipe(Schema.annotateKey({ soapElementName: "policy" })),
    })
      .pipe(Schema.annotate({ identifier: "policies" }))
      .pipe(Schema.annotateKey({ soapElementName: "policies" })),
  })
    .pipe(Schema.annotate({ identifier: "response" }))
    .pipe(Schema.annotateKey({ soapElementName: "response" })),
  oIDs: Schema.Struct({
    oID: Schema.Array(
      Schema.Struct({
        value: Schema.String.pipe(Schema.annotateKey({ soapElementName: "value" })),
        group: Schema.String.pipe(Schema.annotateKey({ soapElementName: "group" })),
        oIDReferenceID: Schema.String.pipe(
          Schema.annotateKey({ soapElementName: "oIDReferenceID" }),
        ),
        defaultName: Schema.String.pipe(Schema.annotateKey({ soapElementName: "defaultName" })),
      }).pipe(Schema.annotate({ identifier: "oID" })),
    ).pipe(Schema.annotateKey({ soapElementName: "oID" })),
  })
    .pipe(Schema.annotate({ identifier: "oIDs" }))
    .pipe(Schema.annotateKey({ soapElementName: "oIDs" })),
}).pipe(Schema.annotate({ identifier: "GetPoliciesResponse", soapNamespace: PolicyNs }));

export type GetPoliciesResponse = typeof GetPoliciesResponse.Type;

// ---------------------------------------------------------------------------
// Enrollment Service (MS-WSTEP)
// ---------------------------------------------------------------------------

export const BinarySecurityToken = Schema.Struct({
  valueType: Schema.String.pipe(
    Schema.annotateKey({ soapAttribute: true, soapAttributeName: "ValueType" }),
  ),
  encodingType: Schema.String.pipe(
    Schema.annotateKey({ soapAttribute: true, soapAttributeName: "EncodingType" }),
  ),
  content: Schema.String.pipe(Schema.annotateKey({ soapTextContent: true })),
}).pipe(
  Schema.annotate({
    identifier: "BinarySecurityToken",
  }),
);

export type BinarySecurityToken = typeof BinarySecurityToken.Type;

export const ContextItem = Schema.Struct({
  name: Schema.String.pipe(Schema.annotateKey({ soapAttribute: true, soapAttributeName: "Name" })),
  value: Schema.String.pipe(Schema.annotateKey({ soapElementName: "Value" })),
}).pipe(
  Schema.annotate({
    identifier: "ContextItem",
  }),
);

export type ContextItem = typeof ContextItem.Type;

export const AdditionalContext = Schema.Struct({
  contextItems: Schema.Array(ContextItem).pipe(
    Schema.annotateKey({ soapElementName: "ContextItem" }),
  ),
}).pipe(
  Schema.annotate({
    identifier: "AdditionalContext",
    soapNamespace: "http://schemas.xmlsoap.org/ws/2006/12/authorization",
    soapNamespacePrefix: "ac",
  }),
);

export type AdditionalContext = typeof AdditionalContext.Type;

export const RequestSecurityToken = Schema.Struct({
  tokenType: Schema.String.pipe(Schema.annotateKey({ soapElementName: "TokenType" })),
  requestType: Schema.String.pipe(Schema.annotateKey({ soapElementName: "RequestType" })),
  binarySecurityToken: BinarySecurityToken.pipe(
    Schema.annotateKey({ soapElementName: "BinarySecurityToken" }),
  ),
  additionalContext: AdditionalContext.pipe(
    Schema.annotateKey({ soapElementName: "AdditionalContext" }),
  ),
}).pipe(
  Schema.annotate({
    identifier: "RequestSecurityToken",
    soapNamespace: "http://docs.oasis-open.org/ws-sx/ws-trust/200512",
    soapNamespacePrefix: "wst",
  }),
);

export type RequestSecurityToken = typeof RequestSecurityToken.Type;

export const RequestedSecurityToken = Schema.Struct({
  binarySecurityToken: BinarySecurityToken.pipe(
    Schema.annotateKey({ soapElementName: "BinarySecurityToken" }),
  ),
}).pipe(
  Schema.annotate({
    identifier: "RequestedSecurityToken",
  }),
);

export type RequestedSecurityToken = typeof RequestedSecurityToken.Type;

export const RequestSecurityTokenResponse = Schema.Struct({
  tokenType: Schema.String.pipe(Schema.annotateKey({ soapElementName: "TokenType" })),
  dispositionMessage: Schema.String.pipe(
    Schema.annotateKey({ soapElementName: "DispositionMessage" }),
  ),
  requestedSecurityToken: RequestedSecurityToken.pipe(
    Schema.annotateKey({ soapElementName: "RequestedSecurityToken" }),
  ),
  requestID: Schema.String.pipe(Schema.annotateKey({ soapElementName: "RequestID" })),
}).pipe(
  Schema.annotate({
    identifier: "RequestSecurityTokenResponse",
  }),
);

export type RequestSecurityTokenResponse = typeof RequestSecurityTokenResponse.Type;

export const RequestSecurityTokenResponseCollection = Schema.Struct({
  requestSecurityTokenResponse: RequestSecurityTokenResponse.pipe(
    Schema.annotateKey({ soapElementName: "RequestSecurityTokenResponse" }),
  ),
}).pipe(
  Schema.annotate({
    identifier: "RequestSecurityTokenResponseCollection",
    soapNamespace: "http://docs.oasis-open.org/ws-sx/ws-trust/200512",
  }),
);

export type RequestSecurityTokenResponseCollection =
  typeof RequestSecurityTokenResponseCollection.Type;

export const ProvisioningParam = Schema.Struct({
  name: Schema.String.pipe(Schema.annotateKey({ soapAttribute: true, soapAttributeName: "name" })),
  value: Schema.String.pipe(
    Schema.annotateKey({ soapAttribute: true, soapAttributeName: "value" }),
  ),
  datatype: Schema.optional(Schema.String).pipe(
    Schema.annotateKey({ soapAttribute: true, soapAttributeName: "datatype" }),
  ),
}).pipe(Schema.annotate({ identifier: "parm" }));
export type ProvisioningParam = typeof ProvisioningParam.Type;

export interface ProvisioningCharacteristic {
  readonly type: string;
  readonly params?: ReadonlyArray<ProvisioningParam>;
  readonly characteristics?: ReadonlyArray<ProvisioningCharacteristic>;
}

export const ProvisioningCharacteristic: Schema.Schema<ProvisioningCharacteristic> = Schema.Struct({
  type: Schema.String.pipe(Schema.annotateKey({ soapAttribute: true, soapAttributeName: "type" })),
  params: Schema.optional(
    Schema.Array(ProvisioningParam).pipe(Schema.annotateKey({ soapElementName: "parm" })),
  ),
  characteristics: Schema.optional(
    Schema.Array(Schema.suspend(() => ProvisioningCharacteristic)).pipe(
      Schema.annotateKey({ soapElementName: "characteristic" }),
    ),
  ),
}).pipe(Schema.annotate({ identifier: "characteristic" }));

export const WapProvisioningDoc = Schema.Struct({
  version: Schema.String.pipe(
    Schema.annotateKey({ soapAttribute: true, soapAttributeName: "version" }),
  ),
  characteristics: Schema.Array(ProvisioningCharacteristic).pipe(
    Schema.annotateKey({ soapElementName: "characteristic" }),
  ),
}).pipe(Schema.annotate({ identifier: "wap-provisioningdoc", soapNamespace: EnrollmentNs }));
export type WapProvisioningDoc = typeof WapProvisioningDoc.Type;

export const SyncMLTarget = Schema.Struct({
  locURI: Schema.String.pipe(Schema.annotateKey({ soapElementName: "LocURI" })),
}).pipe(Schema.annotate({ identifier: "Target" }));
export const SyncMLSource = Schema.Struct({
  locURI: Schema.String.pipe(Schema.annotateKey({ soapElementName: "LocURI" })),
}).pipe(Schema.annotate({ identifier: "Source" }));
export const SyncMLItem = Schema.Struct({
  target: Schema.optional(SyncMLTarget.pipe(Schema.annotateKey({ soapElementName: "Target" }))),
  source: Schema.optional(SyncMLSource.pipe(Schema.annotateKey({ soapElementName: "Source" }))),
  data: Schema.optional(Schema.String.pipe(Schema.annotateKey({ soapElementName: "Data" }))),
}).pipe(Schema.annotate({ identifier: "Item" }));
export type SyncMLItem = typeof SyncMLItem.Type;

const SyncMLCommand = (identifier: string) =>
  Schema.Struct({
    cmdID: Schema.String.pipe(Schema.annotateKey({ soapElementName: "CmdID" })),
    msgRef: Schema.optional(Schema.String.pipe(Schema.annotateKey({ soapElementName: "MsgRef" }))),
    cmdRef: Schema.optional(Schema.String.pipe(Schema.annotateKey({ soapElementName: "CmdRef" }))),
    cmd: Schema.optional(Schema.String.pipe(Schema.annotateKey({ soapElementName: "Cmd" }))),
    targetRef: Schema.optional(
      Schema.String.pipe(Schema.annotateKey({ soapElementName: "TargetRef" })),
    ),
    sourceRef: Schema.optional(
      Schema.String.pipe(Schema.annotateKey({ soapElementName: "SourceRef" })),
    ),
    data: Schema.optional(Schema.String.pipe(Schema.annotateKey({ soapElementName: "Data" }))),
    items: Schema.optional(
      Schema.Array(SyncMLItem).pipe(Schema.annotateKey({ soapElementName: "Item" })),
    ),
  }).pipe(Schema.annotate({ identifier }));

export const SyncMLStatus = SyncMLCommand("Status");
export const SyncMLAlert = SyncMLCommand("Alert");
export const SyncMLGet = SyncMLCommand("Get");
export const SyncMLAdd = SyncMLCommand("Add");
export const SyncMLReplace = SyncMLCommand("Replace");
export const SyncMLDelete = SyncMLCommand("Delete");
export const SyncMLExec = SyncMLCommand("Exec");
export const SyncMLAtomic = Schema.Struct({
  cmdID: Schema.String.pipe(Schema.annotateKey({ soapElementName: "CmdID" })),
  add: Schema.optional(
    Schema.Array(SyncMLAdd).pipe(Schema.annotateKey({ soapElementName: "Add" })),
  ),
  replace: Schema.optional(
    Schema.Array(SyncMLReplace).pipe(Schema.annotateKey({ soapElementName: "Replace" })),
  ),
  exec: Schema.optional(
    Schema.Array(SyncMLExec).pipe(Schema.annotateKey({ soapElementName: "Exec" })),
  ),
}).pipe(Schema.annotate({ identifier: "Atomic" }));

export const SyncML = Schema.Struct({
  syncHdr: Schema.Struct({
    verDTD: Schema.String.pipe(Schema.annotateKey({ soapElementName: "VerDTD" })),
    verProto: Schema.String.pipe(Schema.annotateKey({ soapElementName: "VerProto" })),
    sessionID: Schema.String.pipe(Schema.annotateKey({ soapElementName: "SessionID" })),
    msgID: Schema.String.pipe(Schema.annotateKey({ soapElementName: "MsgID" })),
    target: SyncMLTarget.pipe(Schema.annotateKey({ soapElementName: "Target" })),
    source: SyncMLSource.pipe(Schema.annotateKey({ soapElementName: "Source" })),
  })
    .pipe(Schema.annotate({ identifier: "SyncHdr" }))
    .pipe(Schema.annotateKey({ soapElementName: "SyncHdr" })),
  syncBody: Schema.Struct({
    status: Schema.optional(
      Schema.Array(SyncMLStatus).pipe(Schema.annotateKey({ soapElementName: "Status" })),
    ),
    alert: Schema.optional(
      Schema.Array(SyncMLAlert).pipe(Schema.annotateKey({ soapElementName: "Alert" })),
    ),
    get: Schema.optional(
      Schema.Array(SyncMLGet).pipe(Schema.annotateKey({ soapElementName: "Get" })),
    ),
    add: Schema.optional(
      Schema.Array(SyncMLAdd).pipe(Schema.annotateKey({ soapElementName: "Add" })),
    ),
    replace: Schema.optional(
      Schema.Array(SyncMLReplace).pipe(Schema.annotateKey({ soapElementName: "Replace" })),
    ),
    delete: Schema.optional(
      Schema.Array(SyncMLDelete).pipe(Schema.annotateKey({ soapElementName: "Delete" })),
    ),
    exec: Schema.optional(
      Schema.Array(SyncMLExec).pipe(Schema.annotateKey({ soapElementName: "Exec" })),
    ),
    atomic: Schema.optional(
      Schema.Array(SyncMLAtomic).pipe(Schema.annotateKey({ soapElementName: "Atomic" })),
    ),
    final: Schema.optional(
      Schema.Struct({})
        .pipe(Schema.annotate({ identifier: "Final" }))
        .pipe(Schema.annotateKey({ soapElementName: "Final" })),
    ),
  })
    .pipe(Schema.annotate({ identifier: "SyncBody" }))
    .pipe(Schema.annotateKey({ soapElementName: "SyncBody" })),
}).pipe(Schema.annotate({ identifier: "SyncML", soapNamespace: "SYNCML:SYNCML1.2" }));

export type SyncML = typeof SyncML.Type;

// ---------------------------------------------------------------------------
// SOAP Fault
// ---------------------------------------------------------------------------

export const SoapFaultCode = Schema.Struct({
  value: Schema.String.pipe(
    Schema.annotateKey({ soapElementName: "Value", soapNamespacePrefix: "s" }),
  ),
  subcode: Schema.optional(
    Schema.Struct({
      value: Schema.String.pipe(
        Schema.annotateKey({ soapElementName: "Value", soapNamespacePrefix: "s" }),
      ),
    }).pipe(Schema.annotate({ identifier: "Subcode", soapNamespacePrefix: "s" })),
  ).pipe(Schema.annotateKey({ soapElementName: "Subcode", soapNamespacePrefix: "s" })),
}).pipe(
  Schema.annotate({
    identifier: "Code",
    soapNamespacePrefix: "s",
  }),
);

export type SoapFaultCode = typeof SoapFaultCode.Type;

export const SoapFaultReason = Schema.Struct({
  text: Schema.Struct({
    lang: Schema.String.pipe(
      Schema.annotateKey({ soapAttribute: true, soapAttributeName: "xml:lang" }),
    ),
    content: Schema.String.pipe(Schema.annotateKey({ soapTextContent: true })),
  }).pipe(
    Schema.annotate({ identifier: "Text", soapElementName: "Text", soapNamespacePrefix: "s" }),
  ),
}).pipe(
  Schema.annotate({
    identifier: "Reason",
    soapNamespacePrefix: "s",
  }),
);

export type SoapFaultReason = typeof SoapFaultReason.Type;

export const SoapFault = Schema.Struct({
  code: SoapFaultCode.pipe(
    Schema.annotateKey({ soapElementName: "Code", soapNamespacePrefix: "s" }),
  ),
  reason: SoapFaultReason.pipe(
    Schema.annotateKey({ soapElementName: "Reason", soapNamespacePrefix: "s" }),
  ),
}).pipe(
  Schema.annotate({
    identifier: "Fault",
    soapNamespacePrefix: "s",
  }),
);

export type SoapFault = typeof SoapFault.Type;
