import { Context, Effect, Layer, Option, Predicate, Schema } from "effect";
import {
  type AuthenticatePlist,
  type CheckOutPlist,
  type CommandResultPlist,
  type DDMStatusReport,
  type TokenUpdatePlist,
  type UserAuthenticatePlist,
  DeviceUnenrolled,
  MdmError,
  resolveCheckinChannel,
} from "./schema.js";
import {
  AppleDeviceEvent,
  CheckinScope,
  ManagementBackend,
  MdmOrigin,
  type AppleDeviceEventResult,
  type AppleFailureReport,
  type AppleReturnToServiceConfiguration,
} from "@mattrax/management-backend";
import { extractTopicFromCertPem } from "./cert.js";
import { AppleMdmConfig } from "./config.js";
import { buildAppleEnrollmentProfile } from "./enrollment.js";
import { PlistValue, serializePlist } from "@mattrax/plist";
import { verifyAppleProfileToken } from "./tokens.js";
import { verifyMdmSignature, type VerifiedMdmSignature } from "./signature.js";
import { AppleMdmTrust, type AppleMdmTrustService } from "./trust.js";

function base64ToHex(base64: string): string {
  const cleaned = base64.replace(/\s/g, "");
  const padded = cleaned.padEnd(cleaned.length + ((4 - (cleaned.length % 4)) % 4), "=");
  const binary = atob(padded);

  return Array.from(binary)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
}

function deterministicUuid(input: string): Effect.Effect<string, MdmError> {
  return Effect.tryPromise({
    try: async () => {
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
      const bytes = new Uint8Array(hash).slice(0, 16);
      bytes[6] = (bytes[6] & 0x0f) | 0x50;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;

      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
    catch: (cause) => new MdmError({ message: "Failed to create deterministic UUID", cause }),
  });
}

const declarationsTimestamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Request metadata the protocol layer hands to the backend for the audit log.
 * It is deliberately separate from the device payload: the MDM protocol never
 * sees an address, and a device cannot assert one.
 */
export type RequestAuditContext = {
  readonly clientIp?: string;
  readonly userAgent?: string;
};

export class AppleMdmService extends Context.Service<AppleMdmService, AppleMdmService.Service>()(
  "AppleMdmService",
) {
  static readonly make = (options: {
    readonly backend: ManagementBackend.Service;
    readonly config: AppleMdmConfig.Service;
    readonly topic: string;
    readonly trust?: AppleMdmTrustService;
  }): AppleMdmService.Service =>
    makeAppleMdmService(options.backend, options.config, options.topic, options.trust);

  /**
   * Hosts must provide `AppleMdmConfig` (origin, vendor certificate, auth
   * secret). Tests and the standalone apps wire their own config layer.
   */
  static readonly layer = Layer.effect(
    AppleMdmService,
    Effect.gen(function* () {
      const backend = yield* ManagementBackend;
      const config = yield* AppleMdmConfig;
      const topic = yield* AppleMdmTopic;
      const trust = yield* Effect.serviceOption(AppleMdmTrust);

      return AppleMdmService.make({
        backend,
        config,
        topic: yield* topic.get,
        trust: Option.getOrUndefined(trust),
      });
    }),
  );
}

export declare namespace AppleMdmService {
  export type Service = {
    readonly mdmOrigin: MdmOrigin;
    readonly verifyDeviceSignature: (input: {
      readonly signature?: string;
      readonly body: ArrayBuffer;
      readonly identityCertificateSubject?: string;
      readonly identityCertificateSerial?: string;
      readonly identityCertificateFingerprintSha256?: string;
    }) => Effect.Effect<VerifiedMdmSignature | null, MdmError>;
    readonly handleAuthenticate: (
      auth: AuthenticatePlist,
      identityCertificate?: string,
      identityFingerprintSha256?: string,
      identityCertificateSerial?: string,
      context?: RequestAuditContext,
    ) => Effect.Effect<AppleDeviceEventResult | void, MdmError>;
    /**
     * Handle macOS's two-transaction user-channel authentication.
     *
     * `null` means the device or user is not managed, which the route turns
     * into Apple's 410 so the client stops asking for that user. A returned
     * dictionary is the plist body of the 200 response.
     */
    readonly handleUserAuthenticate: (
      auth: UserAuthenticatePlist,
      identityCertificate?: string,
      identityFingerprintSha256?: string,
      identityCertificateSerial?: string,
      context?: RequestAuditContext,
    ) => Effect.Effect<
      { readonly digestChallenge?: string; readonly authToken?: string } | null,
      MdmError
    >;
    readonly handleTokenUpdate: (
      update: TokenUpdatePlist,
      identityCertificate?: string,
      identityFingerprintSha256?: string,
      identityCertificateSerial?: string,
      context?: RequestAuditContext,
    ) => Effect.Effect<void, MdmError>;
    readonly handleCheckOut: (
      checkout: CheckOutPlist,
      identityCertificate?: string,
      identityFingerprintSha256?: string,
      identityCertificateSerial?: string,
      context?: RequestAuditContext,
    ) => Effect.Effect<void, MdmError>;
    readonly handleCommandResult: (
      result: CommandResultPlist,
      identityCertificate?: string,
      identityFingerprintSha256?: string,
      identityCertificateSerial?: string,
      context?: RequestAuditContext,
    ) => Effect.Effect<void, MdmError>;
    readonly handleSetBootstrapToken: (
      token: string,
      identityCertificate?: string,
      udid?: string,
      identityCertificateSerial?: string,
      identityCertificateFingerprintSha256?: string,
    ) => Effect.Effect<void, MdmError>;
    readonly handleGetBootstrapToken: (
      identityCertificate?: string,
      udid?: string,
      identityCertificateSerial?: string,
      identityCertificateFingerprintSha256?: string,
    ) => Effect.Effect<string | null, MdmError>;
    readonly handleReturnToService: (
      scope: CheckinScope,
    ) => Effect.Effect<AppleReturnToServiceConfiguration, MdmError>;
    readonly handleStatusReport: (
      scope: CheckinScope,
      report: DDMStatusReport,
    ) => Effect.Effect<void, MdmError>;
    readonly handleCheckin: (
      scope: CheckinScope,
    ) => Effect.Effect<
      { commandUUID: string; requestType: string; payload: PlistValue } | null,
      MdmError | DeviceUnenrolled
    >;
    readonly handleDeclarativeTokens: (
      scope: CheckinScope,
    ) => Effect.Effect<{ SyncTokens: { DeclarationsToken: string; Timestamp: string } }, MdmError>;
    readonly handleDeclarationItems: (scope: CheckinScope) => Effect.Effect<
      {
        Declarations: {
          Activations: Array<{ Identifier: string; ServerToken: string }>;
          Configurations: Array<{ Identifier: string; ServerToken: string }>;
          Assets: Array<{ Identifier: string; ServerToken: string }>;
          Management: Array<{ Identifier: string; ServerToken: string }>;
        };
        DeclarationsToken: string;
      },
      MdmError
    >;
    readonly handleDeclaration: (
      scope: CheckinScope,
      type: string,
      identifier: string,
    ) => Effect.Effect<Schema.JsonObject, MdmError>;
    readonly handleAsset: (
      identityCertificate: string | undefined,
      identifier: string,
      token?: string,
    ) => Effect.Effect<{ content: Uint8Array; contentType: string } | null, MdmError>;
    readonly handleProfile: (
      deviceToken: string,
      policyId: string,
      kind: string,
      token: string | undefined,
      deviceId: string | undefined,
      expiresAt: number | undefined,
    ) => Effect.Effect<{ content: Uint8Array; contentType: string } | null, MdmError>;
    /**
     * Record a check-in the protocol layer rejected. Best effort: the backend
     * swallows write failures so the 400 the device receives is unchanged.
     */
    readonly recordFailure: (report: AppleFailureReport) => Effect.Effect<void>;
    readonly generateEnrollmentProfile: (options?: {
      readonly challenge?: string;
      readonly organizationId?: string;
      readonly organizationName?: string;
      readonly supportEmail?: string;
      readonly displayName?: string;
      readonly identifier?: string;
      /** Issue an Apple User Enrollment (BYOD) profile for this Managed Apple Account. */
      readonly managedAppleAccount?: string;
    }) => Effect.Effect<string, MdmError>;
  };
}

const placeholderTopic = "com.apple.mgmt.External.placeholder";

const PlistDictionary = Schema.Record(Schema.String, PlistValue);

const [DeviceCheckinScope, UserCheckinScope] = CheckinScope.members;

const [
  AuthenticateEvent,
  UserAuthenticateEvent,
  TokenUpdateEvent,
  CheckOutEvent,
  BootstrapTokenEvent,
  CommandResultEvent,
  DeclarationStatusEvent,
] = AppleDeviceEvent.members;

/**
 * Build the check-in scope for a resolved device/user channel.
 *
 * The identity certificate fields are identical on both channels: a user
 * connection is still authenticated by the device's mTLS identity and never by
 * a user password. The route and the service share this so the scope a command
 * result is attributed to is the same one its check-in used.
 */
export const appleCheckinScope = (
  mdmOrigin: MdmOrigin,
  channel: NonNullable<ReturnType<typeof resolveCheckinChannel>>,
  identityCertificate?: string,
  identityCertificateFingerprintSha256?: string,
  identityCertificateSerial?: string,
  context: { readonly clientIp?: string; readonly userAgent?: string } = {},
): CheckinScope => {
  const identity = {
    identityCertificate,
    identityCertificateFingerprintSha256,
    identityCertificateSerial,
    clientIp: context.clientIp,
    userAgent: context.userAgent,
    mdmOrigin,
  };

  if (channel.kind === "device")
    return DeviceCheckinScope.make({ udid: channel.deviceIdentifier, ...identity });

  return UserCheckinScope.make({
    udid: channel.deviceIdentifier,
    enrollmentId: channel.enrollmentId,
    source: channel.source,
    userId: channel.userId,
    userShortName: channel.userShortName,
    ...identity,
  });
};

export class AppleMdmTopic extends Context.Service<AppleMdmTopic, AppleMdmTopic.Service>()(
  "AppleMdmTopic",
) {
  static readonly make = (config: AppleMdmConfig.Service): AppleMdmTopic.Service => {
    let cached: string | undefined;

    return AppleMdmTopic.of({
      get: Effect.sync(() => {
        cached ??= config.cloudAppleVendorCert
          ? (extractTopicFromCertPem(config.cloudAppleVendorCert) ?? placeholderTopic)
          : placeholderTopic;

        return cached;
      }),
    });
  };

  static readonly layer = Layer.effect(
    AppleMdmTopic,
    Effect.gen(function* () {
      const config = yield* AppleMdmConfig;

      return AppleMdmTopic.make(config);
    }),
  );
}

export declare namespace AppleMdmTopic {
  export type Service = {
    readonly get: Effect.Effect<string>;
  };
}

const makeAppleMdmService = (
  backend: ManagementBackend.Service,
  config: AppleMdmConfig.Service,
  topic: string,
  trust?: AppleMdmTrustService,
): AppleMdmService.Service => {
  const toMdmError =
    (message: string) =>
    (cause: unknown): MdmError =>
      cause instanceof MdmError ? cause : new MdmError({ message, cause });

  const verifyDeviceSignature: AppleMdmService.Service["verifyDeviceSignature"] = (input) =>
    Effect.gen(function* () {
      // Hosts that do not wire trust keep the historical behaviour. Once a
      // host opts in (Cloud), a missing signature or CA is fatal.
      if (!trust) return null;

      if (!input.signature) {
        if (trust.requireSignature)
          return yield* Effect.fail(new MdmError({ message: "Missing Mdm-Signature" }));

        return null;
      }

      // Resolve the tenant's CA from the identity certificate subject (its OU)
      // so one tenant's identity can never be verified (or trusted) against
      // another tenant's CA.
      const caCertPems = yield* trust.caCertPems(input.identityCertificateSubject);

      if (caCertPems.length === 0) {
        if (trust.requireSignature)
          return yield* Effect.fail(
            new MdmError({ message: "No SCEP CA configured to verify Mdm-Signature" }),
          );

        return null;
      }

      return yield* Effect.tryPromise({
        try: () =>
          verifyMdmSignature({
            signature: input.signature!,
            body: input.body,
            caCertPems,
            identityCertificateSubject: input.identityCertificateSubject,
            identityCertificateSerial: input.identityCertificateSerial,
            identityCertificateFingerprintSha256: input.identityCertificateFingerprintSha256,
          }),
        catch: (cause) =>
          new MdmError({
            message: cause instanceof Error ? cause.message : "Invalid Mdm-Signature",
          }),
      });
    });

  const mdmOrigin = new MdmOrigin({ url: config.origin });

  const channelScope = (
    channel: ReturnType<typeof resolveCheckinChannel>,
    identityCertificate?: string,
    identityFingerprintSha256?: string,
    identityCertificateSerial?: string,
    context: RequestAuditContext = {},
  ): CheckinScope | null =>
    channel
      ? appleCheckinScope(
          mdmOrigin,
          channel,
          identityCertificate,
          identityFingerprintSha256,
          identityCertificateSerial,
          context,
        )
      : null;

  const handleAuthenticate = (
    auth: AuthenticatePlist,
    identityCertificate?: string,
    identityFingerprintSha256?: string,
    identityCertificateSerial?: string,
    context: RequestAuditContext = {},
  ): Effect.Effect<AppleDeviceEventResult | void, MdmError> => {
    const scope = channelScope(
      resolveCheckinChannel(auth),
      identityCertificate,
      identityFingerprintSha256,
      identityCertificateSerial,
      context,
    );

    if (!Predicate.isTagged(scope, "device"))
      return Effect.fail(new MdmError({ message: "Authenticate has no device identifier" }));

    return backend
      .appleDeviceEvent(
        scope,
        AuthenticateEvent.make({
          serialNumber: auth.SerialNumber,
          model: auth.Model ?? auth.ModelName ?? auth.ProductName,
          osVersion: auth.OSVersion,
          enrollmentId: auth.EnrollmentID,
          // `UDID` is forbidden for an Apple User Enrollment, which reports the
          // per-enrollment identifier instead. The distinction decides how the
          // device and its (mandatory) user are displayed and managed.
          enrollmentMode: auth.UDID ? "device" : "user",
        }),
      )
      .pipe(
        // `Authenticate` is the first transaction of enrollment, so this span is
        // the enrollment's backend time.
        Effect.withSpan("mdm.apple.backend.enroll", { kind: "client" }),
        Effect.catchTag("ManagementNotSupported", () => Effect.void),
        Effect.mapError(toMdmError("Failed to send Authenticate event")),
      );
  };

  const handleUserAuthenticate = (
    auth: UserAuthenticatePlist,
    identityCertificate?: string,
    identityFingerprintSha256?: string,
    identityCertificateSerial?: string,
    context: RequestAuditContext = {},
  ): Effect.Effect<
    { readonly digestChallenge?: string; readonly authToken?: string } | null,
    MdmError
  > =>
    Effect.gen(function* () {
      // Mattrax never asks for a password: the first transaction answers with
      // an empty DigestChallenge, which Apple defines as "no AuthToken is
      // required". A digest can therefore only be an unsolicited reply from a
      // stale challenge; Apple requires an empty AuthToken (not a 410) so the
      // client ends the handshake instead of retrying.
      if (auth.DigestResponse !== undefined) return { authToken: "" };

      const scope = channelScope(
        resolveCheckinChannel(auth),
        identityCertificate,
        identityFingerprintSha256,
        identityCertificateSerial,
        context,
      );

      if (!Predicate.isTagged(scope, "user"))
        return yield* new MdmError({ message: "UserAuthenticate has no user identifier" });

      // A 410 tells the client to stop managing this user for the whole login
      // session. Only unknown/unenrolled devices, or a device that the tenant
      // has not bound to this user, reach that branch.
      const managed = yield* backend.appleDeviceEvent(scope, UserAuthenticateEvent.make({})).pipe(
        Effect.as(true),
        Effect.catchTag("UnknownDevice", () => Effect.succeed(false)),
        Effect.catchTag("ManagementNotSupported", () => Effect.succeed(false)),
        Effect.mapError(toMdmError("Failed to send UserAuthenticate event")),
      );

      return managed ? { digestChallenge: "" } : null;
    });

  const handleTokenUpdate = (
    update: TokenUpdatePlist,
    identityCertificate?: string,
    identityFingerprintSha256?: string,
    identityCertificateSerial?: string,
    context: RequestAuditContext = {},
  ): Effect.Effect<void, MdmError> => {
    const channel = resolveCheckinChannel(update);

    if (!channel)
      return Effect.fail(new MdmError({ message: "TokenUpdate has no device identifier" }));

    const scope = channelScope(
      channel,
      identityCertificate,
      identityFingerprintSha256,
      identityCertificateSerial,
      context,
    );

    if (!scope) return Effect.fail(new MdmError({ message: "TokenUpdate has no device scope" }));

    const pushToken = base64ToHex(update.Token);

    return backend
      .appleDeviceEvent(
        scope,
        TokenUpdateEvent.make({
          pushToken,
          pushMagic: update.PushMagic,
          topic: update.Topic,
          channel: channel.kind === "user" ? "user" : "device",
          userId: channel.kind === "user" ? channel.userId : undefined,
          unlockToken: update.UnlockToken,
          enrollmentId: update.EnrollmentID,
          awaitingConfiguration: update.AwaitingConfiguration,
          userShortName: update.UserShortName,
          userLongName: update.UserLongName,
        }),
      )
      .pipe(
        // A device token for an unknown UDID is ignored: the device identity is
        // already checked by the caller. A user channel, however, must belong
        // to a user this device authenticated; silently accepting it would let
        // any managed device register an arbitrary user's push channel.
        Effect.catchTag("UnknownDevice", () =>
          channel.kind === "user"
            ? Effect.fail(
                new MdmError({ message: "User channel is not authenticated for this device" }),
              )
            : Effect.void,
        ),
        Effect.mapError(toMdmError("Failed to send TokenUpdate event")),
      );
  };

  const handleCheckOut = (
    checkout: CheckOutPlist,
    identityCertificate?: string,
    identityFingerprintSha256?: string,
    identityCertificateSerial?: string,
    context: RequestAuditContext = {},
  ): Effect.Effect<void, MdmError> => {
    const channel = resolveCheckinChannel(checkout);

    if (!channel)
      return Effect.fail(new MdmError({ message: "CheckOut has no device identifier" }));

    const scope = channelScope(
      channel,
      identityCertificate,
      identityFingerprintSha256,
      identityCertificateSerial,
      context,
    );

    if (!scope) return Effect.fail(new MdmError({ message: "CheckOut has no device scope" }));

    return backend
      .appleDeviceEvent(
        scope,
        CheckOutEvent.make({ userId: channel.kind === "user" ? channel.userId : undefined }),
      )
      .pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.void),
        Effect.catchTag("UnknownDevice", () => Effect.void),
        Effect.mapError(toMdmError("Failed to send CheckOut event")),
      );
  };

  const handleCommandResult = (
    result: CommandResultPlist,
    identityCertificate?: string,
    identityFingerprintSha256?: string,
    identityCertificateSerial?: string,
    context: RequestAuditContext = {},
  ): Effect.Effect<void, MdmError> => {
    const channel = resolveCheckinChannel(result);

    if (!channel)
      return Effect.fail(new MdmError({ message: "Command result has no device identifier" }));

    const scope = channelScope(
      channel,
      identityCertificate,
      identityFingerprintSha256,
      identityCertificateSerial,
      context,
    );

    if (!scope) return Effect.fail(new MdmError({ message: "Command result has no device scope" }));

    const detail = result.ErrorChain
      ? result.ErrorChain.map((e) => `${e.ErrorDomain ?? ""}:${e.ErrorCode}`).join(", ")
      : undefined;

    if (!result.CommandUUID) return Effect.void;

    return backend
      .appleDeviceEvent(
        scope,
        CommandResultEvent.make({
          commandUUID: result.CommandUUID,
          status: result.Status,
          errorDetail: detail,
          queryResponses: result.QueryResponses,
        }),
      )
      .pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.void),
        Effect.catchTag("UnknownDevice", () => Effect.void),
        Effect.mapError(toMdmError("Failed to send CommandResult event")),
      );
  };

  /** Command payload keys Apple requires as plist `<data>` rather than `<string>`. */
  const DATA_PAYLOAD_KEYS: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
    ["ClearPasscode", ["UnlockToken"]],
    // The `.mobileconfig` bytes are a data field; a string is rejected.
    ["InstallProfile", ["Payload"]],
    // DER certificate the replacement personal recovery key is wrapped for.
    ["RotateFileVaultKey", ["ReplyEncryptionCertificate"]],
    // A managed local admin's password hash is a binary plist `<data>` value.
    ["AccountConfiguration", ["AutoSetupAdminAccounts.0.passwordHash"]],
    // Return to Service carries the Wi-Fi/MDM profile and bootstrap token as
    // data values. A JSON payload has no byte type, so they are base64 in the
    // queue and decoded when the command plist is built.
    [
      "EraseDevice",
      [
        "ReturnToService.WiFiProfileData",
        "ReturnToService.MDMProfileData",
        "ReturnToService.BootstrapToken",
      ],
    ],
  ]);

  /**
   * Replace base64 strings at dotted paths with plist `<data>` bytes. Array
   * indices are supported (`AutoSetupAdminAccounts.0.passwordHash`); paths that
   * do not exist are left alone so an optional key stays absent. A path
   * resolves to a single value, so only that value is copied.
   */
  const setDataAt = (value: PlistValue, parts: ReadonlyArray<string>): PlistValue => {
    const [head, ...rest] = parts;

    if (head === undefined)
      return Schema.is(Schema.String)(value)
        ? Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
        : value;

    if (Schema.is(PlistDictionary)(value)) {
      if (!(head in value)) return value;

      // SAFETY: the predicate above proves `value` is a string-keyed record, so
      // copying it into a mutable record cannot change the value's shape.
      const copy = Object.assign({} as Record<string, PlistValue>, value);

      copy[head] = setDataAt(value[head]!, rest);

      return copy;
    }

    if (Array.isArray(value)) {
      const index = Number(head);

      if (!Number.isInteger(index) || index < 0 || index >= value.length) return value;
      const copy = [...value];

      copy[index] = setDataAt(copy[index]!, rest);

      return copy;
    }

    return value;
  };

  const decodeDataPaths = (payload: PlistValue, paths: ReadonlyArray<string>): PlistValue =>
    paths.reduce((current, path) => setDataAt(current, path.split(".")), payload);

  const handleCheckin = (
    scope: CheckinScope,
  ): Effect.Effect<
    { commandUUID: string; requestType: string; payload: PlistValue } | null,
    MdmError | DeviceUnenrolled
  > =>
    Effect.gen(function* () {
      const manifest = yield* backend.appleManagementCheckin(scope).pipe(
        // The management backend call gets its own span so a slow check-in can
        // be split into protocol, backend and SQL time without guessing.
        Effect.withSpan("mdm.apple.backend.checkin", { kind: "client" }),
        // Unknown devices must receive Apple's 410 Gone so they stop checking
        // in and remove the (now meaningless) management profile. An Idle 200
        // would leave a deleted or unenrolled device polling forever.
        Effect.catchTag("UnknownDevice", () => Effect.fail(new DeviceUnenrolled())),
        Effect.catchTag("ServerInitiatedUnenrollment", () => Effect.fail(new DeviceUnenrolled())),
        Effect.mapError((error) =>
          error instanceof DeviceUnenrolled
            ? error
            : new MdmError({ message: "Management backend checkin failed" }),
        ),
      );

      if (Predicate.isTagged(manifest, "Idle")) return null;

      if (Predicate.isTagged(manifest, "Command")) {
        let payload = Schema.is(PlistValue)(manifest.payload) ? manifest.payload : null;

        // Command payloads are stored as JSON, which has no byte type. Apple
        // expects `<data>` for these keys, so a base64 string is decoded here
        // (the same place the plist is built) rather than in the command queue.
        const dataPaths = DATA_PAYLOAD_KEYS.get(manifest.requestType) ?? [];

        if (payload && dataPaths.length > 0 && Schema.is(PlistDictionary)(payload))
          payload = decodeDataPaths(payload, dataPaths);

        return {
          commandUUID: manifest.commandUUID,
          requestType: manifest.requestType,
          payload: payload ?? {},
        };
      }

      if (!Predicate.isTagged(manifest, "DdmSync")) return null;

      const uuid = yield* deterministicUuid(`dcm:${scope.udid}:${manifest.serverToken}`);

      return { commandUUID: uuid, requestType: "DeclarativeManagement", payload: {} };
    });

  const handleDeclarativeTokens = (
    scope: CheckinScope,
  ): Effect.Effect<{ SyncTokens: { DeclarationsToken: string; Timestamp: string } }, MdmError> =>
    Effect.gen(function* () {
      const tokens = yield* backend.getAppleDeclarationTokens(scope).pipe(
        Effect.catchTag("UnknownDevice", () =>
          Effect.fail(new MdmError({ message: "Unknown device" })),
        ),
        Effect.mapError(toMdmError("Management backend cannot provide declaration tokens")),
      );

      return {
        SyncTokens: {
          DeclarationsToken: tokens.declarationsToken,
          Timestamp: declarationsTimestamp(),
        },
      };
    });

  const handleDeclarationItems = (scope: CheckinScope) =>
    Effect.gen(function* () {
      const items = yield* backend.getAppleDeclarationItems(scope).pipe(
        Effect.catchTag("UnknownDevice", () =>
          Effect.fail(new MdmError({ message: "Unknown device" })),
        ),
        Effect.mapError(toMdmError("Management backend cannot provide declaration items")),
      );

      const tokens = yield* backend.getAppleDeclarationTokens(scope).pipe(
        Effect.catchTag("UnknownDevice", () =>
          Effect.fail(new MdmError({ message: "Unknown device" })),
        ),
        Effect.mapError(toMdmError("Management backend cannot provide declaration tokens")),
      );

      const toItems = (arr: typeof items.activations) =>
        arr.map((d) => ({ Identifier: d.identifier, ServerToken: d.serverToken }));

      return {
        Declarations: {
          Activations: toItems(items.activations),
          Configurations: toItems(items.configurations),
          Assets: toItems(items.assets),
          Management: toItems(items.management),
        },
        DeclarationsToken: tokens.declarationsToken,
      };
    });

  const handleDeclaration = (
    scope: CheckinScope,
    type: string,
    identifier: string,
  ): Effect.Effect<Schema.JsonObject, MdmError> =>
    Effect.gen(function* () {
      const decl = yield* backend.getAppleDeclaration(scope, type, identifier).pipe(
        Effect.catchTag("UnknownDevice", () =>
          Effect.fail(new MdmError({ message: "Unknown device" })),
        ),
        Effect.mapError(toMdmError("Management backend cannot fetch declaration")),
      );

      if (!decl)
        return yield* Effect.fail(new MdmError({ message: `Declaration ${identifier} not found` }));

      return decl;
    });

  const handleAsset = (
    identityCertificate: string | undefined,
    identifier: string,
    token?: string,
  ): Effect.Effect<{ content: Uint8Array; contentType: string } | null, MdmError> =>
    backend.getAppleAsset(identityCertificate, identifier, token).pipe(
      Effect.catchTag("ManagementNotSupported", () => Effect.succeed(null)),
      Effect.catchTag("UnknownDevice", () => Effect.succeed(null)),
      Effect.mapError(toMdmError("Failed to fetch asset")),
    );

  const profileSecret = (): string | undefined => config.authSecret;

  const handleProfile = (
    deviceToken: string,
    policyId: string,
    kind: string,
    token: string | undefined,
    deviceId: string | undefined,
    expiresAt: number | undefined,
  ): Effect.Effect<{ content: Uint8Array; contentType: string } | null, MdmError> =>
    Effect.gen(function* () {
      const secret = profileSecret();

      // DDM profile fetches are unauthenticated at the transport level, so a
      // valid signature is mandatory. Fail closed when the host has not
      // configured a secret.
      if (!secret || !token || !deviceId || expiresAt === undefined) return null;

      if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000))
        return null;

      // The device id and expiry are in the signed message, not trusted from
      // the URL alone. A leaked link stops working and cannot be re-pointed.
      const valid = yield* Effect.promise(() =>
        verifyAppleProfileToken(secret, token, {
          policyId,
          kind,
          deviceToken,
          deviceId,
          expiresAt,
        }),
      );

      if (!valid) return null;

      if (!backend.getAppleProfile) return null;

      return yield* backend.getAppleProfile(policyId, kind, deviceId).pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.succeed(null)),
        Effect.catchTag("UnknownDevice", () => Effect.succeed(null)),
        Effect.mapError(toMdmError("Failed to fetch profile")),
      );
    });

  const handleSetBootstrapToken = (
    token: string,
    identityCertificate?: string,
    udid?: string,
    identityCertificateSerial?: string,
    identityCertificateFingerprintSha256?: string,
  ): Effect.Effect<void, MdmError> =>
    Effect.gen(function* () {
      if (!udid) return yield* new MdmError({ message: "Bootstrap token has no UDID" });

      // A UDID in the plist is caller-supplied. Bind the escrow write to the
      // certificate presented on this connection so one enrolled device cannot
      // overwrite another device's bootstrap token.
      const scope: CheckinScope = DeviceCheckinScope.make({
        udid,
        identityCertificate,
        identityCertificateSerial,
        identityCertificateFingerprintSha256,
        mdmOrigin,
      });

      yield* backend.appleDeviceEvent(scope, BootstrapTokenEvent.make({ token })).pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.void),
        Effect.catchTag("UnknownDevice", () => Effect.void),
        Effect.mapError(toMdmError("Failed to set bootstrap token")),
      );
    });

  const handleGetBootstrapToken = (
    identityCertificate?: string,
    udid?: string,
    identityCertificateSerial?: string,
    identityCertificateFingerprintSha256?: string,
  ): Effect.Effect<string | null, MdmError> =>
    Effect.gen(function* () {
      if (!udid) return null;

      // Same binding as the write path: a claimed UDID must match the
      // certificate on this connection before its escrowed token is returned.
      const scope: CheckinScope = DeviceCheckinScope.make({
        udid,
        identityCertificate,
        identityCertificateSerial,
        identityCertificateFingerprintSha256,
        mdmOrigin,
      });

      return yield* backend.getAppleBootstrapToken(scope).pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.succeed(null)),
        Effect.catchTag("UnknownDevice", () => Effect.succeed(null)),
        Effect.mapError(toMdmError("Failed to get bootstrap token")),
      );
    });

  const handleReturnToService = (
    scope: CheckinScope,
  ): Effect.Effect<AppleReturnToServiceConfiguration, MdmError> =>
    backend.appleReturnToServiceConfiguration(scope).pipe(
      Effect.catchTag("ManagementNotSupported", () =>
        Effect.succeed({ enabled: false, reason: "Return to service is not supported" }),
      ),
      Effect.catchTag("UnknownDevice", () =>
        Effect.fail(new MdmError({ message: "Unknown device" })),
      ),
      Effect.mapError(toMdmError("Failed to build the return-to-service configuration")),
    );

  const handleStatusReport = (
    scope: CheckinScope,
    report: DDMStatusReport,
  ): Effect.Effect<void, MdmError> =>
    backend
      .appleDeviceEvent(
        scope,
        DeclarationStatusEvent.make({
          statusItems: report.StatusItems,
          errors: report.Errors?.map((e) => ({
            statusItem: e.StatusItem,
            reasons: e.Reasons?.map((r) => ({
              code: r.Code,
              description: r.Description,
              details: r.Details,
            })),
          })),
        }),
      )
      .pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.void),
        Effect.catchTag("UnknownDevice", () => Effect.void),
        Effect.mapError(toMdmError("Failed to send DeclarationStatus event")),
      );

  const generateEnrollmentProfile = (options?: {
    readonly challenge?: string;
    readonly organizationId?: string;
    readonly organizationName?: string;
    readonly supportEmail?: string;
    readonly displayName?: string;
    readonly identifier?: string;
    /** Issue an Apple User Enrollment (BYOD) profile for this Managed Apple Account. */
    readonly managedAppleAccount?: string;
  }): Effect.Effect<string, MdmError> =>
    serializePlist(
      Schema.decodeUnknownSync(PlistValue)(
        buildAppleEnrollmentProfile({
          origin: config.origin,
          topic,
          organizationId: options?.organizationId ?? config.organizationId ?? "",
          organizationName: options?.organizationName ?? config.organizationName ?? "Mattrax",
          supportEmail: options?.supportEmail ?? config.supportEmail,
          challenge: options?.challenge ?? crypto.randomUUID(),
          displayName: options?.displayName,
          identifier: options?.identifier,
          userEnrollment: options?.managedAppleAccount
            ? { managedAppleAccount: options.managedAppleAccount }
            : undefined,
        }),
      ),
    ).pipe(
      Effect.mapError(
        (cause) => new MdmError({ message: "Failed to serialize enrollment profile", cause }),
      ),
    );

  /**
   * Record a rejected check-in. Best effort: the report is bounded and
   * written by the backend, and any failure is logged rather than changing the
   * empty 400 Apple expects.
   */
  const recordFailure = (report: AppleFailureReport): Effect.Effect<void> =>
    backend.appleRecordFailure
      ? backend.appleRecordFailure(report).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`Failed to record the Apple check-in failure: ${String(cause)}`),
          ),
        )
      : Effect.void;

  return AppleMdmService.of({
    mdmOrigin,
    verifyDeviceSignature,
    handleAuthenticate,
    handleUserAuthenticate,
    handleTokenUpdate,
    handleCheckOut,
    handleCommandResult,
    handleSetBootstrapToken,
    handleGetBootstrapToken,
    handleReturnToService,
    handleStatusReport,
    handleCheckin,
    handleDeclarativeTokens,
    handleDeclarationItems,
    handleDeclaration,
    handleAsset,
    handleProfile,
    generateEnrollmentProfile,
    recordFailure,
  });
};

export const AppleMdmServiceLive = AppleMdmService.layer;
