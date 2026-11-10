import { Schema, Context, Effect } from "effect";

export class ManagementNotSupported extends Schema.TaggedError<ManagementNotSupported>()(
  "ManagementNotSupported",
  {},
) {}
export class UnknownDevice extends Schema.TaggedError<UnknownDevice>()("UnknownDevice", {}) {}
export class ServerInitiatedUnenrollment extends Schema.TaggedError<ServerInitiatedUnenrollment>()(
  "ServerInitiatedUnenrollment",
  {},
) {}
export class InternalServerError extends Schema.TaggedError<InternalServerError>()(
  "InternalServerError",
  {},
) {}

export class MdmOrigin extends Schema.Class<MdmOrigin>("MdmOrigin")({
  url: Schema.String,
}) {
  assetUrl(identifier: string): string {
    return `${this.url}/mdm/apple/assets/${identifier}`;
  }
}

export const CheckinScope = Schema.Union([
  Schema.TaggedStruct("device", {
    udid: Schema.String,
    identityCertificate: Schema.optional(Schema.String),
    /**
     * SHA-256 of the CMS signer certificate, set only after the request
     * signature has been verified. Backends use it to bind a UDID to the
     * identity certificate that first enrolled it.
     */
    identityCertificateFingerprintSha256: Schema.optional(Schema.String),
    /**
     * Serial number (lowercase hex) of the mTLS identity certificate presented
     * by the device. Backends use it to bind the SCEP certificate issued at
     * enrollment to this device, enabling per-device revocation and health.
     */
    identityCertificateSerial: Schema.optional(Schema.String),
    mdmOrigin: MdmOrigin,
  }),
  Schema.TaggedStruct("user", {
    udid: Schema.String,
    identityCertificate: Schema.optional(Schema.String),
    identityCertificateFingerprintSha256: Schema.optional(Schema.String),
    identityCertificateSerial: Schema.optional(Schema.String),
    userId: Schema.String,
    userShortName: Schema.optional(Schema.String),
    mdmOrigin: MdmOrigin,
  }),
]);
export type CheckinScope = typeof CheckinScope.Type;

export const AppleDeviceEvent = Schema.Union([
  Schema.TaggedStruct("Authenticate", {
    serialNumber: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    osVersion: Schema.optional(Schema.String),
  }),
  Schema.TaggedStruct("TokenUpdate", {
    pushToken: Schema.String,
    pushMagic: Schema.String,
    topic: Schema.String,
    channel: Schema.Literals(["user", "device"]),
    userId: Schema.optional(Schema.String),
    unlockToken: Schema.optional(Schema.String),
    enrollmentId: Schema.optional(Schema.String),
    awaitingConfiguration: Schema.optional(Schema.Boolean),
    userShortName: Schema.optional(Schema.String),
    userLongName: Schema.optional(Schema.String),
  }),
  Schema.TaggedStruct("CheckOut", { userId: Schema.optional(Schema.String) }),
  Schema.TaggedStruct("BootstrapToken", { token: Schema.String }),
  Schema.TaggedStruct("CommandResult", {
    commandUUID: Schema.String,
    status: Schema.String,
    errorDetail: Schema.optional(Schema.String),
    queryResponses: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  Schema.TaggedStruct("DeclarationStatus", {
    statusItems: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    errors: Schema.optional(
      Schema.Array(
        Schema.Struct({
          statusItem: Schema.optional(Schema.String),
          reasons: Schema.optional(
            Schema.Array(
              Schema.Struct({
                code: Schema.optional(Schema.String),
                description: Schema.optional(Schema.String),
                details: Schema.optional(Schema.Unknown),
              }),
            ),
          ),
        }),
      ),
    ),
  }),
]);
export type AppleDeviceEvent = typeof AppleDeviceEvent.Type;

// Mutually exclusive: what the device should do after a checkin.
// DdmSync and Command cannot both apply at once due to the underlying protocol.
export const ManagementManifest = Schema.Union([
  Schema.TaggedStruct("Idle", {}),
  Schema.TaggedStruct("Command", {
    commandUUID: Schema.String,
    requestType: Schema.String,
    payload: Schema.Unknown,
  }),
  Schema.TaggedStruct("DdmSync", {
    serverToken: Schema.String,
  }),
]);
export type ManagementManifest = typeof ManagementManifest.Type;

export const DdmTokens = Schema.Struct({
  activationsToken: Schema.String,
  configurationsToken: Schema.String,
  assetsToken: Schema.String,
  managementToken: Schema.String,
  /** Combined token that equals the DdmSync server token. */
  declarationsToken: Schema.String,
});
export type DdmTokens = typeof DdmTokens.Type;

export const DdmDeclarationItem = Schema.Struct({
  identifier: Schema.String,
  serverToken: Schema.String,
});
export type DdmDeclarationItem = typeof DdmDeclarationItem.Type;

export const DdmDeclarationItems = Schema.Struct({
  activations: Schema.Array(DdmDeclarationItem),
  configurations: Schema.Array(DdmDeclarationItem),
  assets: Schema.Array(DdmDeclarationItem),
  management: Schema.Array(DdmDeclarationItem),
});
export type DdmDeclarationItems = typeof DdmDeclarationItems.Type;

export const WindowsDiscoveryRequest = Schema.Struct({
  emailAddress: Schema.optional(Schema.String),
  requestVersion: Schema.String,
  deviceType: Schema.String,
  applicationVersion: Schema.String,
  osEdition: Schema.Number,
  authPolicies: Schema.Array(Schema.String),
  mdmOrigin: MdmOrigin,
  /**
   * HMAC-signed tenant enrollment token from the discovery URL
   * (`/mdm/windows/discovery?tenant=<token>`). Discovery has no other tenant
   * identity, so this is how a request is routed to the right organization.
   */
  tenantToken: Schema.optional(Schema.String),
});
export type WindowsDiscoveryRequest = typeof WindowsDiscoveryRequest.Type;

export const WindowsDiscoveryResponse = Schema.Struct({
  authPolicy: Schema.String,
  enrollmentVersion: Schema.String,
  enrollmentPolicyServiceUrl: Schema.String,
  enrollmentServiceUrl: Schema.String,
  authServiceUrl: Schema.optional(Schema.String),
});
export type WindowsDiscoveryResponse = typeof WindowsDiscoveryResponse.Type;

export const WindowsManagementScope = Schema.Struct({
  deviceId: Schema.String,
  identityCertificate: Schema.optional(Schema.String),
  /** Serial from the verified mTLS handshake, when the edge forwards it. */
  identityCertificateSerial: Schema.optional(Schema.String),
  /** Tenant token preserved on the management URL, if the device kept it. */
  tenantToken: Schema.optional(Schema.String),
  mdmOrigin: MdmOrigin,
});
export type WindowsManagementScope = typeof WindowsManagementScope.Type;

export const WindowsEnrollmentPolicy = Schema.Struct({
  minimalKeyLength: Schema.String,
  certificateValidityPeriodSeconds: Schema.String,
  renewalPeriodSeconds: Schema.String,
  authToken: Schema.String,
});
export type WindowsEnrollmentPolicy = typeof WindowsEnrollmentPolicy.Type;

/** Request-scoped tenant identity for the WSTEP policy endpoint. */
export type WindowsEnrollmentContext = {
  readonly tenantToken?: string;
};

export const WindowsEnrollmentRequest = Schema.Struct({
  authToken: Schema.String,
  csr: Schema.String,
  deviceId: Schema.optional(Schema.String),
  deviceName: Schema.optional(Schema.String),
  enrollmentType: Schema.optional(Schema.String),
  context: Schema.Record(Schema.String, Schema.String),
  mdmOrigin: MdmOrigin,
  /** Tenant token from the enrollment URL (or provisioning context). */
  tenantToken: Schema.optional(Schema.String),
});
export type WindowsEnrollmentRequest = typeof WindowsEnrollmentRequest.Type;

export const WindowsEnrollmentResult = Schema.Struct({
  deviceId: Schema.String,
  signedCertificate: Schema.String,
  identityCertificate: Schema.String,
  username: Schema.String,
  secret: Schema.String,
  providerId: Schema.String,
});
export type WindowsEnrollmentResult = typeof WindowsEnrollmentResult.Type;

export const WindowsSyncMLCommand = Schema.Struct({
  kind: Schema.String,
  cmdID: Schema.String,
  locURI: Schema.optional(Schema.String),
  data: Schema.optional(Schema.String),
  format: Schema.optional(Schema.String),
});
export type WindowsSyncMLCommand = typeof WindowsSyncMLCommand.Type;

export const WindowsManagementRequest = Schema.Struct({
  sessionID: Schema.String,
  msgID: Schema.String,
  source: Schema.String,
  target: Schema.String,
  statuses: Schema.Array(Schema.Unknown),
  alerts: Schema.Array(Schema.Unknown),
});
export type WindowsManagementRequest = typeof WindowsManagementRequest.Type;

export const WindowsManagementResponse = Schema.Struct({
  commands: Schema.Array(WindowsSyncMLCommand),
});
export type WindowsManagementResponse = typeof WindowsManagementResponse.Type;

export const WindowsDeviceEvent = Schema.Union([
  Schema.TaggedStruct("Enrolled", { deviceId: Schema.String }),
  Schema.TaggedStruct("ManagementCheckin", { deviceId: Schema.String }),
  Schema.TaggedStruct("CommandResult", {
    deviceId: Schema.String,
    status: Schema.String,
    commandRef: Schema.optional(Schema.String),
  }),
]);
export type WindowsDeviceEvent = typeof WindowsDeviceEvent.Type;

export declare namespace ManagementBackend {
  export type Service = {
    // Device lifecycle and protocol events (device-initiated)
    readonly appleDeviceEvent: (
      scope: CheckinScope,
      event: AppleDeviceEvent,
    ) => Effect.Effect<void, ManagementNotSupported | UnknownDevice | InternalServerError>;
    readonly getAppleBootstrapToken: (
      scope: CheckinScope,
    ) => Effect.Effect<string | null, ManagementNotSupported | UnknownDevice | InternalServerError>;

    // Regular device checkin: returns what the device should do next (imperative)
    readonly appleManagementCheckin: (
      scope: CheckinScope,
    ) => Effect.Effect<
      ManagementManifest,
      ManagementNotSupported | UnknownDevice | ServerInitiatedUnenrollment | InternalServerError
    >;

    // DDM sub-endpoint handlers (device-initiated)
    readonly getAppleDeclarationTokens: (
      scope: CheckinScope,
    ) => Effect.Effect<DdmTokens, ManagementNotSupported | UnknownDevice | InternalServerError>;
    readonly getAppleDeclarationItems: (
      scope: CheckinScope,
    ) => Effect.Effect<
      DdmDeclarationItems,
      ManagementNotSupported | UnknownDevice | InternalServerError
    >;
    readonly getAppleDeclaration: (
      scope: CheckinScope,
      type: string,
      identifier: string,
    ) => Effect.Effect<
      Record<string, unknown> | null,
      ManagementNotSupported | UnknownDevice | InternalServerError
    >;
    readonly getAppleAsset: (
      identityCertificate: string | undefined,
      identifier: string,
      token?: string,
    ) => Effect.Effect<
      { content: Uint8Array; contentType: string } | null,
      ManagementNotSupported | UnknownDevice | InternalServerError
    >;
    /**
     * Fetch the legacy `.mobileconfig` behind a DDM `com.apple.configuration.legacy`
     * declaration. The device-facing route verifies the signed URL before calling
     * this, so this lookup only resolves policy content.
     */
    readonly getAppleProfile?: (
      policyId: string,
      kind: string,
    ) => Effect.Effect<
      { content: Uint8Array; contentType: string } | null,
      ManagementNotSupported | UnknownDevice | InternalServerError
    >;

    readonly windowsDiscovery: (
      request: WindowsDiscoveryRequest,
    ) => Effect.Effect<
      WindowsDiscoveryResponse,
      ManagementNotSupported | UnknownDevice | InternalServerError
    >;
    readonly getWindowsEnrollmentPolicy: (
      authToken: string,
      context?: WindowsEnrollmentContext,
    ) => Effect.Effect<
      WindowsEnrollmentPolicy,
      ManagementNotSupported | UnknownDevice | InternalServerError
    >;
    readonly windowsEnroll: (
      request: WindowsEnrollmentRequest,
    ) => Effect.Effect<
      WindowsEnrollmentResult,
      ManagementNotSupported | UnknownDevice | InternalServerError
    >;
    readonly windowsManagementCheckin: (
      scope: WindowsManagementScope,
      request: WindowsManagementRequest,
    ) => Effect.Effect<
      WindowsManagementResponse,
      ManagementNotSupported | UnknownDevice | InternalServerError
    >;
    readonly windowsDeviceEvent: (
      scope: WindowsManagementScope,
      event: WindowsDeviceEvent,
    ) => Effect.Effect<void, ManagementNotSupported | UnknownDevice | InternalServerError>;
  };
}

export class ManagementBackend extends Context.Service<
  ManagementBackend,
  ManagementBackend.Service
>()("ManagementBackend") {}
