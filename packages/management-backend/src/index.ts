import type { Effect } from "effect";
import { Schema, Context } from "effect";

export class ManagementNotSupported extends Schema.TaggedError<ManagementNotSupported>()(
  "ManagementNotSupported",
  {},
) {}

/**
 * The device, tenant or certificate could not be resolved.
 *
 * `recorded` is set by the Windows backend when the same fault has already been
 * written to the durable failure history, so the protocol layer does not append
 * a duplicate row for an unattributable failure it knows nothing about.
 */
export class UnknownDevice extends Schema.TaggedError<UnknownDevice>()("UnknownDevice", {
  recorded: Schema.optional(Schema.Boolean),
}) {}

export class ServerInitiatedUnenrollment extends Schema.TaggedError<ServerInitiatedUnenrollment>()(
  "ServerInitiatedUnenrollment",
  {},
) {}

/** A backend-side failure; `recorded` has the same meaning as on `UnknownDevice`. */
export class InternalServerError extends Schema.TaggedError<InternalServerError>()(
  "InternalServerError",
  {
    recorded: Schema.optional(Schema.Boolean),
  },
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
    /**
     * Verified client address for the audit log, computed by the HTTP layer
     * with the deployment's trusted-proxy policy. Never taken from a device
     * payload and never echoed back to the device.
     */
    clientIp: Schema.optional(Schema.String),
    /** Bounded request `User-Agent` (audit only; not part of MDM protocol). */
    userAgent: Schema.optional(Schema.String),
    mdmOrigin: MdmOrigin,
  }),
  Schema.TaggedStruct("user", {
    udid: Schema.String,
    identityCertificate: Schema.optional(Schema.String),
    identityCertificateFingerprintSha256: Schema.optional(Schema.String),
    identityCertificateSerial: Schema.optional(Schema.String),
    clientIp: Schema.optional(Schema.String),
    userAgent: Schema.optional(Schema.String),
    userId: Schema.String,
    userShortName: Schema.optional(Schema.String),
    /**
     * Which connection the user identity came from. `user-channel` is the
     * macOS/Shared iPad user channel (`UserID`), which is only trusted after
     * `UserAuthenticate`. `user-enrollment` is Apple User Enrollment's user
     * channel (`EnrollmentUserID`), where the enrollment itself is the user.
     */
    source: Schema.Literals(["user-channel", "user-enrollment"]),
    /** The per-enrollment identifier Apple sends for a user enrollment. */
    enrollmentId: Schema.optional(Schema.String),
    mdmOrigin: MdmOrigin,
  }),
]);

export type CheckinScope = typeof CheckinScope.Type;

export const AppleDeviceEvent = Schema.Union([
  Schema.TaggedStruct("Authenticate", {
    serialNumber: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    osVersion: Schema.optional(Schema.String),
    /** Present for an Apple User Enrollment, which has no UDID. */
    enrollmentId: Schema.optional(Schema.String),
    /**
     * `user` is Apple User Enrollment (BYOD): one user is enrolled, no device
     * identity is available, and the accessible command/payload set is smaller.
     */
    enrollmentMode: Schema.Literals(["device", "user"]),
  }),
  /**
   * macOS opens a user-channel session with a two-transaction handshake. The
   * backend validates the device/user binding and records it; the protocol
   * layer answers with a DigestChallenge (or 410 when the user is not managed).
   */
  Schema.TaggedStruct("UserAuthenticate", {}),
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

/**
 * Optional payload returned by an Apple device event.
 *
 * `Authenticate` may carry a signed Automated Device Enrollment profile so a
 * device enrolling from Setup Assistant receives its tenant profile from the
 * check-in instead of having to install it from the signed URL. The value is
 * base64 because the same result crosses the management webhook boundary.
 * Devices that are not ADE, or that are already managed, return no result.
 */
export const AppleDeviceEventResult = Schema.Struct({
  /** CMS-signed Apple enrollment profile, base64 encoded. */
  enrollmentProfile: Schema.optional(Schema.String),
});

export type AppleDeviceEventResult = typeof AppleDeviceEventResult.Type;

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

/**
 * The configuration the server returns for a `ReturnToService` check-in.
 *
 * The Wi-Fi profile is a complete `.mobileconfig`; Apple installs it after the
 * erase so the device can reach the MDM server. The bootstrap token is the raw
 * escrowed bytes (Apple's `BootstrapToken` is a `<data>` value). The device
 * fetches its ADE enrollment profile from Apple when `enabled` is true, so no
 * `MDMProfileData` is included here.
 */
export const AppleReturnToServiceConfiguration = Schema.Struct({
  enabled: Schema.Boolean,
  wifiProfileData: Schema.optional(Schema.Uint8Array),
  bootstrapToken: Schema.optional(Schema.Uint8Array),
  /** Why return to service is unavailable; diagnostics only, never sent. */
  reason: Schema.optional(Schema.String),
});

export type AppleReturnToServiceConfiguration = typeof AppleReturnToServiceConfiguration.Type;

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
  /** Verified client address for the audit log (never sent to the device). */
  clientIp: Schema.optional(Schema.String),
  /** Bounded request `User-Agent` (audit only). */
  userAgent: Schema.optional(Schema.String),
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
  /** Verified client certificate DER, standard base64, from the trusted edge. */
  identityCertificateDerBase64: Schema.optional(Schema.String),
  /** Tenant token preserved on the management URL, if the device kept it. */
  tenantToken: Schema.optional(Schema.String),
  /** Verified client address for the audit log (never sent to the device). */
  clientIp: Schema.optional(Schema.String),
  /** Bounded request `User-Agent` (audit only). */
  userAgent: Schema.optional(Schema.String),
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
  /** Verified client address for the audit log (never sent to the device). */
  readonly clientIp?: string;
  /** Bounded request `User-Agent` (audit only). */
  readonly userAgent?: string;
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
  /** Verified client address for the audit log (never sent to the device). */
  clientIp: Schema.optional(Schema.String),
  /** Bounded request `User-Agent` (audit only). */
  userAgent: Schema.optional(Schema.String),
  /** Subject from the edge-verified mTLS handshake, when presented. */
  identityCertificate: Schema.optional(Schema.String),
  /** Serial from the edge-verified mTLS handshake, when presented. */
  identityCertificateSerial: Schema.optional(Schema.String),
  /** Verified client certificate DER, standard base64, from the trusted edge. */
  identityCertificateDerBase64: Schema.optional(Schema.String),
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
  /**
   * OMA-DM `<Results>` blocks returned by the device for server `Get`
   * commands. Each block carries `CmdRef` and `Item`/`Source`/`Data` entries;
   * the inventory parser reads them.
   */
  results: Schema.optional(Schema.Array(Schema.Unknown)),
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

/** Where in the Windows protocol a failed request stopped. */
export const WindowsFailurePhase = Schema.Literals([
  "discovery",
  "wstep",
  "enrollment",
  "policy",
  "command",
]);

export type WindowsFailurePhase = typeof WindowsFailurePhase.Type;

/**
 * A protocol-level Windows fault reported by the SOAP/SyncML layer.
 *
 * Those failures (a malformed envelope, a missing security token, an
 * unparseable SyncML body) happen above the management backend, so the HTTP
 * layer hands the request context back for tenant/device attribution. The
 * backend only records it; the SOAP fault returned to the device is unchanged.
 */
export const WindowsFailureReport = Schema.Struct({
  phase: WindowsFailurePhase,
  /** Stable machine-readable cause, e.g. `missing_token`. */
  code: Schema.String,
  /** Curated, already-redacted reason; the recorder bounds it again. */
  message: Schema.String,
  detail: Schema.optional(Schema.String),
  tenantToken: Schema.optional(Schema.String),
  identityCertificate: Schema.optional(Schema.String),
  identityCertificateSerial: Schema.optional(Schema.String),
  /** Windows `DeviceID` the request asserted, when it got that far. */
  deviceId: Schema.optional(Schema.String),
  /** Verified client address for the audit log. */
  clientIp: Schema.optional(Schema.String),
  /** Bounded request `User-Agent` (audit only). */
  userAgent: Schema.optional(Schema.String),
});

export type WindowsFailureReport = typeof WindowsFailureReport.Type;

/**
 * A failed Apple check-in reported by the protocol layer.
 *
 * Apple has no SOAP-style fault envelope: an unparseable plist, an invalid
 * DDM status report or a signature failure is answered with an empty 400. The
 * handler hands the request context back so the backend can attribute the
 * failure to a tenant (from the identity certificate OU) and record a bounded
 * reason. Attribution is best effort; an unattributable failure is dropped
 * rather than guessed.
 */
export const AppleFailureReport = Schema.Struct({
  /** Stable machine-readable cause, e.g. `invalid_plist`. */
  code: Schema.String,
  /** Bounded, already-redacted reason. */
  message: Schema.String,
  /** Which check-in step failed (`checkin`, `authenticate`, `declaration`…). */
  phase: Schema.optional(Schema.String),
  udid: Schema.optional(Schema.String),
  userId: Schema.optional(Schema.String),
  identityCertificate: Schema.optional(Schema.String),
  identityCertificateFingerprintSha256: Schema.optional(Schema.String),
  identityCertificateSerial: Schema.optional(Schema.String),
  clientIp: Schema.optional(Schema.String),
  userAgent: Schema.optional(Schema.String),
});

export type AppleFailureReport = typeof AppleFailureReport.Type;

export declare namespace ManagementBackend {
  export type Service = {
    // Device lifecycle and protocol events (device-initiated)
    readonly appleDeviceEvent: (
      scope: CheckinScope,
      event: AppleDeviceEvent,
    ) => Effect.Effect<
      void | AppleDeviceEventResult,
      ManagementNotSupported | UnknownDevice | InternalServerError
    >;
    readonly getAppleBootstrapToken: (
      scope: CheckinScope,
    ) => Effect.Effect<string | null, ManagementNotSupported | UnknownDevice | InternalServerError>;
    /**
     * Answer Apple's `ReturnToService` check-in. Apple sends this before erasing
     * an ADE device that is configured for return to service; the response
     * carries the Wi-Fi profile and escrowed bootstrap token the device uses to
     * reconnect and re-enroll.
     */
    readonly appleReturnToServiceConfiguration: (
      scope: CheckinScope,
    ) => Effect.Effect<
      AppleReturnToServiceConfiguration,
      ManagementNotSupported | UnknownDevice | InternalServerError
    >;

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
      Schema.JsonObject | null,
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
     * Serve the OTA manifest an iPhone/iPad downloads for an uploaded `.ipa`.
     *
     * `InstallApplication` accepts a `ManifestURL`, not an inline manifest, so
     * the catalogue has to host the plist itself. The URL is signed and bound
     * to one enrolled device, exactly like the package asset it points at.
     * Optional so protocol adapters without a database keep working.
     */
    readonly getAppleManifest?: (
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
      deviceId: string,
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
    /**
     * Persist an Apple check-in failure the protocol layer detected (an
     * unparseable payload, a bad signature or an invalid DDM report). Optional
     * so protocol adapters without a database (the compliance harness) keep
     * working; the 400 the device receives is never affected.
     */
    readonly appleRecordFailure?: (report: AppleFailureReport) => Effect.Effect<void>;
    /**
     * Persist a fault that never reached the Windows backend (bad SOAP/SyncML).
     * Optional so protocol adapters without a database (the compliance harness)
     * keep working; the fault response is never affected.
     */
    readonly windowsRecordFailure?: (report: WindowsFailureReport) => Effect.Effect<void>;
  };
}

export class ManagementBackend extends Context.Service<
  ManagementBackend,
  ManagementBackend.Service
>()("ManagementBackend") {}
