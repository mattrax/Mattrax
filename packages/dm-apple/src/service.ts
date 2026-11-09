import { Context, Effect, Layer } from "effect";
import {
  type AuthenticatePlist,
  type CheckOutPlist,
  type CommandResultPlist,
  type DDMStatusReport,
  type TokenUpdatePlist,
  MdmError,
} from "./schema.js";
import { ManagementBackend, MdmOrigin, type CheckinScope } from "@mattrax/management-backend";
import { extractTopicFromCertPem } from "./cert.js";
import { AppleMdmConfig } from "./config.js";
import { buildAppleEnrollmentProfile } from "./enrollment.js";
import { verifyAppleProfileToken } from "./tokens.js";

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
  }): AppleMdmService.Service =>
    makeAppleMdmService(options.backend, options.config, options.topic);

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
      return AppleMdmService.make({ backend, config, topic: yield* topic.get });
    }),
  );
}

export declare namespace AppleMdmService {
  export type Service = {
    readonly mdmOrigin: MdmOrigin;
    readonly handleAuthenticate: (
      auth: AuthenticatePlist,
      identityCertificate?: string,
    ) => Effect.Effect<void, MdmError>;
    readonly handleTokenUpdate: (
      update: TokenUpdatePlist,
      identityCertificate?: string,
    ) => Effect.Effect<void, MdmError>;
    readonly handleCheckOut: (
      checkout: CheckOutPlist,
      identityCertificate?: string,
    ) => Effect.Effect<void, MdmError>;
    readonly handleCommandResult: (
      result: CommandResultPlist,
      identityCertificate?: string,
    ) => Effect.Effect<void, MdmError>;
    readonly handleSetBootstrapToken: (
      token: string,
      identityCertificate?: string,
      udid?: string,
    ) => Effect.Effect<void, MdmError>;
    readonly handleGetBootstrapToken: (
      identityCertificate?: string,
      udid?: string,
    ) => Effect.Effect<string | null, MdmError>;
    readonly handleStatusReport: (
      scope: CheckinScope,
      report: DDMStatusReport,
    ) => Effect.Effect<void, MdmError>;
    readonly handleCheckin: (
      scope: CheckinScope,
    ) => Effect.Effect<
      { commandUUID: string; requestType: string; payload: unknown } | null,
      MdmError
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
    ) => Effect.Effect<object, MdmError>;
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
      readonly displayName?: string;
      readonly identifier?: string;
    }) => Effect.Effect<string, MdmError>;
  };
}

const placeholderTopic = "com.apple.mgmt.External.placeholder";

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
): AppleMdmService.Service => {
  const toMdmError = (message: string) => () => new MdmError({ message });

  const mdmOrigin = new MdmOrigin({ url: config.origin });

  const handleAuthenticate = (
    auth: AuthenticatePlist,
    identityCertificate?: string,
  ): Effect.Effect<void, MdmError> => {
    const scope: CheckinScope = { _tag: "device", udid: auth.UDID, identityCertificate, mdmOrigin };
    return backend
      .appleDeviceEvent(scope, {
        _tag: "Authenticate",
        serialNumber: auth.SerialNumber,
        model: auth.Model ?? auth.ModelName ?? auth.ProductName,
        osVersion: auth.OSVersion,
      })
      .pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.void),
        Effect.mapError(toMdmError("Failed to send Authenticate event")),
      );
  };

  const handleTokenUpdate = (
    update: TokenUpdatePlist,
    identityCertificate?: string,
  ): Effect.Effect<void, MdmError> => {
    const scope: CheckinScope = update.UserID
      ? { _tag: "user", udid: update.UDID, identityCertificate, userId: update.UserID, mdmOrigin }
      : { _tag: "device", udid: update.UDID, identityCertificate, mdmOrigin };
    const pushToken = base64ToHex(update.Token);
    return backend
      .appleDeviceEvent(scope, {
        _tag: "TokenUpdate",
        pushToken,
        pushMagic: update.PushMagic,
        topic: update.Topic,
        channel: update.UserID ? "user" : "device",
        ...(update.UserID ? { userId: update.UserID } : {}),
        ...(update.UnlockToken ? { unlockToken: update.UnlockToken } : {}),
        ...(update.EnrollmentID ? { enrollmentId: update.EnrollmentID } : {}),
        ...(update.AwaitingConfiguration !== undefined
          ? { awaitingConfiguration: update.AwaitingConfiguration }
          : {}),
        ...(update.UserShortName ? { userShortName: update.UserShortName } : {}),
        ...(update.UserLongName ? { userLongName: update.UserLongName } : {}),
      })
      .pipe(
        Effect.catchTag("UnknownDevice", () => Effect.void),
        Effect.mapError(toMdmError("Failed to send TokenUpdate event")),
      );
  };

  const handleCheckOut = (
    checkout: CheckOutPlist,
    identityCertificate?: string,
  ): Effect.Effect<void, MdmError> => {
    const scope: CheckinScope = checkout.UserID
      ? {
          _tag: "user",
          udid: checkout.UDID,
          userId: checkout.UserID,
          identityCertificate,
          mdmOrigin,
        }
      : { _tag: "device", udid: checkout.UDID, identityCertificate, mdmOrigin };
    return backend
      .appleDeviceEvent(scope, {
        _tag: "CheckOut",
        ...(checkout.UserID ? { userId: checkout.UserID } : {}),
      })
      .pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.void),
        Effect.catchTag("UnknownDevice", () => Effect.void),
        Effect.mapError(toMdmError("Failed to send CheckOut event")),
      );
  };

  const handleCommandResult = (
    result: CommandResultPlist,
    identityCertificate?: string,
  ): Effect.Effect<void, MdmError> => {
    const scope: CheckinScope = {
      _tag: "device",
      udid: result.UDID,
      identityCertificate,
      mdmOrigin,
    };
    const detail = result.ErrorChain
      ? result.ErrorChain.map((e) => `${e.ErrorDomain ?? ""}:${e.ErrorCode}`).join(", ")
      : undefined;
    if (!result.CommandUUID) return Effect.void;
    return backend
      .appleDeviceEvent(scope, {
        _tag: "CommandResult",
        commandUUID: result.CommandUUID,
        status: result.Status,
        errorDetail: detail,
        queryResponses: result.QueryResponses,
      })
      .pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.void),
        Effect.catchTag("UnknownDevice", () => Effect.void),
        Effect.mapError(toMdmError("Failed to send CommandResult event")),
      );
  };

  const handleCheckin = (
    scope: CheckinScope,
  ): Effect.Effect<
    { commandUUID: string; requestType: string; payload: unknown } | null,
    MdmError
  > =>
    Effect.gen(function* () {
      const manifest = yield* backend.appleManagementCheckin(scope).pipe(
        Effect.catchTag("UnknownDevice", () => Effect.succeed({ _tag: "Idle" } as const)),
        Effect.mapError(toMdmError("Management backend checkin failed")),
      );
      switch (manifest._tag) {
        case "Idle":
          return null;
        case "Command": {
          const payload = manifest.payload as Record<string, unknown> | null;
          if (
            manifest.requestType === "ClearPasscode" &&
            payload &&
            typeof payload.UnlockToken === "string"
          ) {
            const binary = atob(payload.UnlockToken);
            payload.UnlockToken = Uint8Array.from(binary, (char) => char.charCodeAt(0));
          }
          return {
            commandUUID: manifest.commandUUID,
            requestType: manifest.requestType,
            payload,
          };
        }
        case "DdmSync": {
          const uuid = yield* deterministicUuid(`dcm:${scope.udid}:${manifest.serverToken}`);
          return { commandUUID: uuid, requestType: "DeclarativeManagement", payload: {} };
        }
      }
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
  ): Effect.Effect<object, MdmError> =>
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
  ): Effect.Effect<void, MdmError> =>
    Effect.gen(function* () {
      if (!udid) return yield* new MdmError({ message: "Bootstrap token has no UDID" });
      const scope: CheckinScope = { _tag: "device", udid, identityCertificate, mdmOrigin };
      yield* backend.appleDeviceEvent(scope, { _tag: "BootstrapToken", token }).pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.void),
        Effect.catchTag("UnknownDevice", () => Effect.void),
        Effect.mapError(toMdmError("Failed to set bootstrap token")),
      );
    });

  const handleGetBootstrapToken = (
    identityCertificate?: string,
    udid?: string,
  ): Effect.Effect<string | null, MdmError> =>
    Effect.gen(function* () {
      if (!udid) return null;
      const scope: CheckinScope = { _tag: "device", udid, identityCertificate, mdmOrigin };
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
      .appleDeviceEvent(scope, {
        _tag: "DeclarationStatus",
        statusItems: report.StatusItems,
        errors: report.Errors?.map((e) => ({
          statusItem: e.StatusItem,
          reasons: e.Reasons?.map((r) => ({
            code: r.Code,
            description: r.Description,
            details: r.Details,
          })),
        })),
      })
      .pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.void),
        Effect.catchTag("UnknownDevice", () => Effect.void),
        Effect.mapError(toMdmError("Failed to send DeclarationStatus event")),
      );

  const generateEnrollmentProfile = (options?: {
    readonly challenge?: string;
    readonly organizationId?: string;
    readonly organizationName?: string;
    readonly displayName?: string;
    readonly identifier?: string;
  }): Effect.Effect<string, MdmError> =>
    Effect.sync(() =>
      JSON.stringify(
        buildAppleEnrollmentProfile({
          origin: config.origin,
          topic,
          organizationId: options?.organizationId ?? config.organizationId ?? "",
          organizationName: options?.organizationName ?? config.organizationName ?? "Mattrax",
          challenge: options?.challenge ?? crypto.randomUUID(),
          displayName: options?.displayName,
          identifier: options?.identifier,
        }),
      ),
    );

  return AppleMdmService.of({
    mdmOrigin,
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
