import { Context, Effect, Layer, Option, Predicate, Schema } from "effect";
import {
  type AuthenticatePlist,
  type CheckOutPlist,
  type CommandResultPlist,
  type DDMStatusReport,
  type TokenUpdatePlist,
  DeviceUnenrolled,
  MdmError,
} from "./schema.js";
import {
  AppleDeviceEvent,
  CheckinScope,
  ManagementBackend,
  MdmOrigin,
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
    ) => Effect.Effect<void, MdmError>;
    readonly handleTokenUpdate: (
      update: TokenUpdatePlist,
      identityCertificate?: string,
      identityFingerprintSha256?: string,
      identityCertificateSerial?: string,
    ) => Effect.Effect<void, MdmError>;
    readonly handleCheckOut: (
      checkout: CheckOutPlist,
      identityCertificate?: string,
      identityFingerprintSha256?: string,
      identityCertificateSerial?: string,
    ) => Effect.Effect<void, MdmError>;
    readonly handleCommandResult: (
      result: CommandResultPlist,
      identityCertificate?: string,
      identityFingerprintSha256?: string,
      identityCertificateSerial?: string,
    ) => Effect.Effect<void, MdmError>;
    readonly handleSetBootstrapToken: (
      token: string,
      identityCertificate?: string,
      udid?: string,
      identityCertificateSerial?: string,
    ) => Effect.Effect<void, MdmError>;
    readonly handleGetBootstrapToken: (
      identityCertificate?: string,
      udid?: string,
      identityCertificateSerial?: string,
    ) => Effect.Effect<string | null, MdmError>;
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
    ) => Effect.Effect<{ content: Uint8Array; contentType: string } | null, MdmError>;
    readonly generateEnrollmentProfile: (options?: {
      readonly challenge?: string;
      readonly organizationId?: string;
      readonly organizationName?: string;
      readonly supportEmail?: string;
      readonly displayName?: string;
      readonly identifier?: string;
    }) => Effect.Effect<string, MdmError>;
  };
}

const placeholderTopic = "com.apple.mgmt.External.placeholder";

const PlistDictionary = Schema.Record(Schema.String, PlistValue);

const [DeviceCheckinScope, UserCheckinScope] = CheckinScope.members;

const [
  AuthenticateEvent,
  TokenUpdateEvent,
  CheckOutEvent,
  BootstrapTokenEvent,
  CommandResultEvent,
  DeclarationStatusEvent,
] = AppleDeviceEvent.members;

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
  const toMdmError = (message: string) => () => new MdmError({ message });

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

  const handleAuthenticate = (
    auth: AuthenticatePlist,
    identityCertificate?: string,
    identityFingerprintSha256?: string,
    identityCertificateSerial?: string,
  ): Effect.Effect<void, MdmError> => {
    const scope: CheckinScope = DeviceCheckinScope.make({
      udid: auth.UDID,
      identityCertificate,
      identityCertificateFingerprintSha256: identityFingerprintSha256,
      identityCertificateSerial,
      mdmOrigin,
    });

    return backend
      .appleDeviceEvent(
        scope,
        AuthenticateEvent.make({
          serialNumber: auth.SerialNumber,
          model: auth.Model ?? auth.ModelName ?? auth.ProductName,
          osVersion: auth.OSVersion,
        }),
      )
      .pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.void),
        Effect.mapError(toMdmError("Failed to send Authenticate event")),
      );
  };

  const handleTokenUpdate = (
    update: TokenUpdatePlist,
    identityCertificate?: string,
    identityFingerprintSha256?: string,
    identityCertificateSerial?: string,
  ): Effect.Effect<void, MdmError> => {
    const scope: CheckinScope = update.UserID
      ? UserCheckinScope.make({
          udid: update.UDID,
          identityCertificate,
          identityCertificateFingerprintSha256: identityFingerprintSha256,
          identityCertificateSerial,
          userId: update.UserID,
          mdmOrigin,
        })
      : DeviceCheckinScope.make({
          udid: update.UDID,
          identityCertificate,
          identityCertificateFingerprintSha256: identityFingerprintSha256,
          identityCertificateSerial,
          mdmOrigin,
        });

    const pushToken = base64ToHex(update.Token);

    return backend
      .appleDeviceEvent(
        scope,
        TokenUpdateEvent.make({
          pushToken,
          pushMagic: update.PushMagic,
          topic: update.Topic,
          channel: update.UserID ? "user" : "device",
          userId: update.UserID,
          unlockToken: update.UnlockToken,
          enrollmentId: update.EnrollmentID,
          awaitingConfiguration: update.AwaitingConfiguration,
          userShortName: update.UserShortName,
          userLongName: update.UserLongName,
        }),
      )
      .pipe(
        Effect.catchTag("UnknownDevice", () => Effect.void),
        Effect.mapError(toMdmError("Failed to send TokenUpdate event")),
      );
  };

  const handleCheckOut = (
    checkout: CheckOutPlist,
    identityCertificate?: string,
    identityFingerprintSha256?: string,
    identityCertificateSerial?: string,
  ): Effect.Effect<void, MdmError> => {
    const scope: CheckinScope = checkout.UserID
      ? UserCheckinScope.make({
          udid: checkout.UDID,
          userId: checkout.UserID,
          identityCertificate,
          identityCertificateFingerprintSha256: identityFingerprintSha256,
          identityCertificateSerial,
          mdmOrigin,
        })
      : DeviceCheckinScope.make({
          udid: checkout.UDID,
          identityCertificate,
          identityCertificateFingerprintSha256: identityFingerprintSha256,
          identityCertificateSerial,
          mdmOrigin,
        });

    return backend.appleDeviceEvent(scope, CheckOutEvent.make({ userId: checkout.UserID })).pipe(
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
  ): Effect.Effect<void, MdmError> => {
    const scope: CheckinScope = DeviceCheckinScope.make({
      udid: result.UDID,
      identityCertificate,
      identityCertificateFingerprintSha256: identityFingerprintSha256,
      identityCertificateSerial,
      mdmOrigin,
    });

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
  ]);

  const handleCheckin = (
    scope: CheckinScope,
  ): Effect.Effect<
    { commandUUID: string; requestType: string; payload: PlistValue } | null,
    MdmError | DeviceUnenrolled
  > =>
    Effect.gen(function* () {
      const manifest = yield* backend.appleManagementCheckin(scope).pipe(
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
        for (const key of DATA_PAYLOAD_KEYS.get(manifest.requestType) ?? []) {
          const value = payload && Schema.is(PlistDictionary)(payload) ? payload[key] : undefined;

          if (!Schema.is(Schema.String)(value)) continue;
          const binary = atob(value);
          const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

          payload = Schema.is(PlistDictionary)(payload)
            ? Object.assign({}, payload, { [key]: bytes })
            : { [key]: bytes };
        }

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
  ): Effect.Effect<{ content: Uint8Array; contentType: string } | null, MdmError> =>
    Effect.gen(function* () {
      const secret = profileSecret();

      // DDM profile fetches are unauthenticated at the transport level, so a
      // valid signature is mandatory. Fail closed when the host has not
      // configured a secret.
      if (!secret || !token) return null;

      const valid = yield* Effect.promise(() =>
        verifyAppleProfileToken(secret, token, { policyId, kind, deviceToken }),
      );

      if (!valid) return null;

      if (!backend.getAppleProfile) return null;

      return yield* backend.getAppleProfile(policyId, kind).pipe(
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
  ): Effect.Effect<void, MdmError> =>
    Effect.gen(function* () {
      if (!udid) return yield* new MdmError({ message: "Bootstrap token has no UDID" });

      const scope: CheckinScope = DeviceCheckinScope.make({
        udid,
        identityCertificate,
        identityCertificateSerial,
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
  ): Effect.Effect<string | null, MdmError> =>
    Effect.gen(function* () {
      if (!udid) return null;

      const scope: CheckinScope = DeviceCheckinScope.make({
        udid,
        identityCertificate,
        identityCertificateSerial,
        mdmOrigin,
      });

      return yield* backend.getAppleBootstrapToken(scope).pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.succeed(null)),
        Effect.catchTag("UnknownDevice", () => Effect.succeed(null)),
        Effect.mapError(toMdmError("Failed to get bootstrap token")),
      );
    });

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
        }),
      ),
    ).pipe(
      Effect.mapError(
        (cause) => new MdmError({ message: "Failed to serialize enrollment profile", cause }),
      ),
    );

  return AppleMdmService.of({
    mdmOrigin,
    verifyDeviceSignature,
    handleAuthenticate,
    handleTokenUpdate,
    handleCheckOut,
    handleCommandResult,
    handleSetBootstrapToken,
    handleGetBootstrapToken,
    handleStatusReport,
    handleCheckin,
    handleDeclarativeTokens,
    handleDeclarationItems,
    handleDeclaration,
    handleAsset,
    handleProfile,
    generateEnrollmentProfile,
  });
};

export const AppleMdmServiceLive = AppleMdmService.layer;
