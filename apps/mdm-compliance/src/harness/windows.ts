import { Effect, Layer, Match, Schema } from "effect";
import { HttpRouter } from "effect/http";
import {
  ManagementBackend,
  ManagementManifest,
  ManagementNotSupported,
  UnknownDevice,
  type WindowsDeviceEvent,
  type WindowsDiscoveryRequest,
  type WindowsEnrollmentPolicy,
  type WindowsEnrollmentRequest,
  type WindowsManagementRequest,
  type WindowsManagementResponse,
  type WindowsManagementScope,
} from "@mattrax/management-backend";
import {
  WindowsMdmService,
  WindowsMdmServiceLive,
  windowsMdmRoutes,
  parseSyncML,
} from "@mattrax/dm-windows";
import {
  DiscoverResponse,
  GetPoliciesResponse,
  RequestSecurityTokenResponseCollection,
  deserializeSoapElement,
  extractSoapBody,
} from "@mattrax/soap";

export type WindowsHarnessState = {
  discovery: WindowsDiscoveryRequest[];
  policy: Array<{ authToken: string; tenantToken?: string }>;
  enrollments: WindowsEnrollmentRequest[];
  management: Array<{ scope: WindowsManagementScope; request: WindowsManagementRequest }>;
  events: Array<{ scope: WindowsManagementScope; event: WindowsDeviceEvent }>;
  discoveryResponse: {
    authPolicy: string;
    enrollmentVersion: string;
    enrollmentPolicyServiceUrl: string;
    enrollmentServiceUrl: string;
    authServiceUrl?: string;
  } | null;
  enrollmentPolicy: WindowsEnrollmentPolicy | null;
  enrollmentResult: {
    deviceId: string;
    signedCertificate: string;
    identityCertificate: string;
    username: string;
    secret: string;
    providerId: string;
  } | null;
  managementResponse: WindowsManagementResponse;
  discoveryError: "unknown" | "unsupported" | null;
  policyError: "unknown" | "unsupported" | null;
  enrollmentError: "unknown" | "unsupported" | null;
  managementError: "unknown" | "unsupported" | null;
};

export type WindowsHarness = {
  readonly handler: (request: Request) => Promise<Response>;
  readonly state: WindowsHarnessState;
  readonly service: WindowsMdmService.Service;
  readonly origin: string;
};

export const createWindowsHarness = (): WindowsHarness => {
  const origin = "https://mdm.example.test";

  const state: WindowsHarnessState = {
    discovery: [],
    policy: [],
    enrollments: [],
    management: [],
    events: [],
    discoveryResponse: {
      authPolicy: "OnPremise",
      enrollmentVersion: "4.0",
      enrollmentPolicyServiceUrl: `${origin}/mdm/windows/policy`,
      enrollmentServiceUrl: `${origin}/mdm/windows/enroll`,
    },
    enrollmentPolicy: {
      minimalKeyLength: "2048",
      certificateValidityPeriodSeconds: "31536000",
      renewalPeriodSeconds: "18144000",
      authToken: "token-123",
    },
    enrollmentResult: {
      deviceId: "windows-device-1",
      signedCertificate: "signed-certificate",
      identityCertificate: "identity-certificate",
      username: "windows-device-1",
      secret: "device-secret",
      providerId: "Compliance",
    },
    managementResponse: { commands: [] },
    discoveryError: null,
    policyError: null,
    enrollmentError: null,
    managementError: null,
  };

  const failFor = (kind: "unknown" | "unsupported" | null) =>
    Match.value(kind).pipe(
      Match.when("unknown", () => Effect.fail(new UnknownDevice())),
      Match.when("unsupported", () => Effect.fail(new ManagementNotSupported())),
      Match.orElse(() => null),
    );

  const backend = ManagementBackend.of({
    appleDeviceEvent: () => Effect.void,
    getAppleBootstrapToken: () => Effect.succeed(null),
    appleManagementCheckin: () =>
      Effect.succeed(ManagementManifest.members[0].make({})),
    getAppleDeclarationTokens: () =>
      Effect.succeed({
        activationsToken: "",
        configurationsToken: "",
        assetsToken: "",
        managementToken: "",
        declarationsToken: "",
      }),
    getAppleDeclarationItems: () =>
      Effect.succeed({ activations: [], configurations: [], assets: [], management: [] }),
    getAppleDeclaration: () => Effect.succeed(null),
    getAppleAsset: () => Effect.succeed(null),
    windowsDiscovery: (request) => {
      const failure = failFor(state.discoveryError);

      if (failure) return failure;
      state.discovery.push(request);

      return Effect.succeed(
        state.discoveryResponse ?? {
          authPolicy: "OnPremise",
          enrollmentVersion: "4.0",
          enrollmentPolicyServiceUrl: `${origin}/mdm/windows/policy`,
          enrollmentServiceUrl: `${origin}/mdm/windows/enroll`,
        },
      );
    },
    getWindowsEnrollmentPolicy: (authToken, context) => {
      const failure = failFor(state.policyError);

      if (failure) return failure;
      state.policy.push(
        context?.tenantToken ? { authToken, tenantToken: context.tenantToken } : { authToken },
      );

      return Effect.succeed(
        state.enrollmentPolicy ?? {
          minimalKeyLength: "2048",
          certificateValidityPeriodSeconds: "31536000",
          renewalPeriodSeconds: "18144000",
          authToken,
        },
      );
    },
    windowsEnroll: (request) => {
      const failure = failFor(state.enrollmentError);

      if (failure) return failure;
      state.enrollments.push(request);

      return Effect.succeed(
        state.enrollmentResult ?? {
          deviceId: request.deviceId ?? "windows-device",
          signedCertificate: "signed",
          identityCertificate: "identity",
          username: "windows-device",
          secret: "secret",
          providerId: "Compliance",
        },
      );
    },
    windowsManagementCheckin: (scope, request) => {
      const failure = failFor(state.managementError);

      if (failure) return failure;
      state.management.push({ scope, request });

      return Effect.succeed(state.managementResponse);
    },
    windowsDeviceEvent: (scope, event) =>
      Effect.sync(() => {
        state.events.push({ scope, event });
      }),
  });

  const serviceLayer = WindowsMdmServiceLive({ origin, providerId: "Compliance" }).pipe(
    Layer.provideMerge(Layer.succeed(ManagementBackend, backend)),
  );

  const appLayer = windowsMdmRoutes.pipe(Layer.provideMerge(serviceLayer));
  const { handler } = HttpRouter.toWebHandler(appLayer, { disableLogger: true });

  const service = Effect.runSync(
    Effect.provide(Effect.service(WindowsMdmService), serviceLayer),
  );

  return { handler, state, service, origin };
};

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export const windowsSoapEnvelope = (
  body: string,
  options: {
    readonly security?: string | null;
    readonly messageId?: string;
    readonly action?: string;
  } = {},
): string => {
  const security =
    options.security === null
      ? ""
      : `<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><wsse:BinarySecurityToken>${escapeXml(
          options.security ?? "token-123",
        )}</wsse:BinarySecurityToken></wsse:Security>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">
  <s:Header>
    <a:MessageID>${options.messageId ?? "urn:uuid:compliance-message"}</a:MessageID>
    ${options.action ? `<a:Action>${escapeXml(options.action)}</a:Action>` : ""}
    ${security}
  </s:Header>
  <s:Body>${body}</s:Body>
</s:Envelope>`;
};

export const windowsDiscoveryBody = (): string =>
  `<Discover xmlns="http://schemas.microsoft.com/windows/management/2012/01/enrollment"><request><RequestVersion>5.0</RequestVersion><DeviceType>CIMClient_Windows</DeviceType><ApplicationVersion>10.0</ApplicationVersion><OSEdition>48</OSEdition><AuthPolicies><AuthPolicy>OnPremise</AuthPolicy></AuthPolicies></request></Discover>`;

export const windowsPolicyBody = (): string =>
  `<GetPolicies xmlns="http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy"><client><lastUpdate xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/><preferredLanguage xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/></client><requestFilter xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/></GetPolicies>`;

export const windowsEnrollBody = (
  options: {
    readonly csr?: string;
    readonly deviceId?: string;
    readonly deviceName?: string;
  } = {},
): string =>
  `<wst:RequestSecurityToken xmlns:wst="http://docs.oasis-open.org/ws-sx/ws-trust/200512"><TokenType>token</TokenType><RequestType>issue</RequestType><BinarySecurityToken ValueType="pkcs10" EncodingType="base64">${escapeXml(
    options.csr ?? "Y3Ny",
  )}</BinarySecurityToken><ac:AdditionalContext xmlns:ac="http://schemas.xmlsoap.org/ws/2006/12/authorization"><ContextItem Name="DeviceID"><Value>${escapeXml(
    options.deviceId ?? "windows-device-1",
  )}</Value></ContextItem><ContextItem Name="DeviceName"><Value>${escapeXml(
    options.deviceName ?? "DESKTOP-COMPLIANCE",
  )}</Value></ContextItem></ac:AdditionalContext></wst:RequestSecurityToken>`;

export const windowsSyncMLBody = (
  options: {
    readonly msgId?: string;
    readonly sessionId?: string;
    readonly command?: "alert" | "replace" | "exec" | "get";
  } = {},
): string => {
  const command = options.command ?? "alert";

  const commandXml = Match.value(command).pipe(
    Match.when("alert", () => `<Alert><CmdID>2</CmdID><Data>1201</Data></Alert>`),
    Match.when(
      "replace",
      () =>
        `<Replace><CmdID>2</CmdID><Item><Target><LocURI>./DevDetail/Ext/Microsoft/DeviceName</LocURI></Target><Data>DESKTOP-COMPLIANCE</Data></Item></Replace>`,
    ),
    Match.when(
      "exec",
      () =>
        `<Exec><CmdID>2</CmdID><Item><Target><LocURI>./Device/Vendor/MSFT/RemoteWipe/doWipe</LocURI></Target></Item></Exec>`,
    ),
    Match.orElse(
      () => `<Get><CmdID>2</CmdID><Item><Target><LocURI>./DevInfo/DevId</LocURI></Target></Item></Get>`,
    ),
  );

  return `<SyncML xmlns="SYNCML:SYNCML1.2"><SyncHdr><VerDTD>1.2</VerDTD><VerProto>DM/1.2</VerProto><SessionID>${options.sessionId ?? "session-1"}</SessionID><MsgID>${options.msgId ?? "1"}</MsgID><Target><LocURI>https://mdm.example.test/mdm/windows/management</LocURI></Target><Source><LocURI>windows-device-1</LocURI></Source></SyncHdr><SyncBody>${commandXml}<Final/></SyncBody></SyncML>`;
};

export const windowsPost = (
  path: string,
  body: string,
  options: { tenantToken?: string } = {},
): Request =>
  new Request(
    `${origin}${path}${options.tenantToken ? `?tenant=${encodeURIComponent(options.tenantToken)}` : ""}`,
    {
      method: "POST",
      headers: { "content-type": "application/soap+xml" },
      body,
    },
  );

const origin = "https://mdm.example.test";

export const decodeWindowsResponse = async <A>(
  response: Response,
  schema: Schema.Decoder<A>,
): Promise<A> => {
  const text = await response.text();
  const body = extractSoapBody(text);

  return Effect.runPromise(deserializeSoapElement(body, schema));
};

export const windowsDiscoveryResponse = (response: Response) =>
  decodeWindowsResponse<DiscoverResponse>(response, DiscoverResponse);

export const windowsPolicyResponse = (response: Response) =>
  decodeWindowsResponse<GetPoliciesResponse>(response, GetPoliciesResponse);

export const windowsEnrollmentResponse = (response: Response) =>
  decodeWindowsResponse<RequestSecurityTokenResponseCollection>(
    response,
    RequestSecurityTokenResponseCollection,
  );

export const windowsSyncMLResponse = async (response: Response) =>
  Effect.runPromise(parseSyncML(await response.text()));
