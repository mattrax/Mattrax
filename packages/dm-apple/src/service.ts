import { Context, Effect, Layer } from "effect";
import {
  type AuthenticatePlist,
  type CheckOutPlist,
  type CommandResultPlist,
  type DDMStatusReport,
  type TokenUpdatePlist,
  MdmError,
} from "./schema.js";
import { ApnsService } from "./apns.js";
import { ManagementBackend, type CheckinScope } from "@mattrax/management-backend";

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
      const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
    catch: (cause) => new MdmError({ message: "Failed to create deterministic UUID", cause }),
  });
}

export class AppleMdmService extends Context.Service<
  AppleMdmService,
  {
    readonly handleAuthenticate: (auth: AuthenticatePlist, identityCertificate?: string) => Effect.Effect<void, MdmError>;
    readonly handleTokenUpdate: (update: TokenUpdatePlist, identityCertificate?: string) => Effect.Effect<void, MdmError>;
    readonly handleCheckOut: (checkout: CheckOutPlist, identityCertificate?: string) => Effect.Effect<void, MdmError>;
    readonly handleCommandResult: (result: CommandResultPlist, identityCertificate?: string) => Effect.Effect<void, MdmError>;
    readonly handleStatusReport: (scope: CheckinScope, report: DDMStatusReport) => Effect.Effect<void, MdmError>;
    readonly handleCheckin: (scope: CheckinScope) => Effect.Effect<{ commandUUID: string; requestType: string; payload: unknown } | null, MdmError>;
    readonly handleDeclarativeTokens: (scope: CheckinScope) => Effect.Effect<{ SyncTokens: { Tokens: Array<{ Token: string; Type: string }> } }, MdmError>;
    readonly handleDeclarationItems: (scope: CheckinScope) => Effect.Effect<{
      Declarations: {
        Activations: Array<{ Identifier: string; ServerToken: string }>;
        Configurations: Array<{ Identifier: string; ServerToken: string }>;
        Assets: Array<{ Identifier: string; ServerToken: string }>;
        Management: Array<{ Identifier: string; ServerToken: string }>;
      };
    }, MdmError>;
    readonly handleDeclaration: (scope: CheckinScope, type: string, identifier: string) => Effect.Effect<object, MdmError>;
    readonly queueInstallProfile: (deviceId: string, profilePayload: unknown) => Effect.Effect<void, MdmError>;
    readonly queueInstallApplication: (deviceId: string, appPayload: unknown) => Effect.Effect<void, MdmError>;
    readonly queueCollectInformation: (deviceId: string, queries: string[]) => Effect.Effect<void, MdmError>;
    readonly generateEnrollmentProfile: () => Effect.Effect<string, MdmError>;
  }
>()("AppleMdmService") {}

export const AppleMdmServiceLive = (config: { origin: string; topic: string }) => Layer.effect(
  AppleMdmService,
  Effect.gen(function* () {
    const backend = yield* ManagementBackend;
    const apns = yield* ApnsService;

    const toMdmError = (message: string) => () => new MdmError({ message });

    const pushToDevice = (deviceId: string): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        const pushInfo = yield* backend.getApplePushInfo(deviceId).pipe(
          Effect.orElseSucceed(() => null),
        );
        if (!pushInfo) return;
        yield* apns.push(pushInfo).pipe(
          Effect.ignore({ log: true, message: `[APNS] Push failed for device ${deviceId}` }),
        );
      });

    const handleAuthenticate = (auth: AuthenticatePlist, identityCertificate?: string): Effect.Effect<void, MdmError> => {
      const scope: CheckinScope = { _tag: "device", udid: auth.UDID, identityCertificate };
      return backend.appleDeviceEvent(scope, {
        _tag: "Authenticate",
        serialNumber: auth.SerialNumber,
        model: auth.Model ?? auth.ModelName,
        osVersion: auth.OSVersion,
      }).pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.void),
        Effect.catchTag("UnknownDevice", () => Effect.void),
        Effect.mapError(toMdmError("Failed to send Authenticate event")),
      );
    };

    const handleTokenUpdate = (update: TokenUpdatePlist, identityCertificate?: string): Effect.Effect<void, MdmError> => {
      const scope: CheckinScope = update.UserID
        ? { _tag: "user", udid: update.UDID, identityCertificate, userId: update.UserID }
        : { _tag: "device", udid: update.UDID, identityCertificate };
      const pushToken = base64ToHex(update.Token);
      return backend.appleDeviceEvent(scope, {
        _tag: "TokenUpdate",
        pushToken,
        pushMagic: update.PushMagic,
        topic: update.Topic,
        channel: update.UserID ? "user" : "device",
      }).pipe(
        Effect.catchTag("UnknownDevice", () => Effect.void),
        Effect.mapError(toMdmError("Failed to send TokenUpdate event")),
      );
    };

    const handleCheckOut = (checkout: CheckOutPlist, identityCertificate?: string): Effect.Effect<void, MdmError> => {
      const scope: CheckinScope = { _tag: "device", udid: checkout.UDID, identityCertificate };
      return backend.appleDeviceEvent(scope, { _tag: "CheckOut" }).pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.void),
        Effect.catchTag("UnknownDevice", () => Effect.void),
        Effect.mapError(toMdmError("Failed to send CheckOut event")),
      );
    };

    const handleCommandResult = (result: CommandResultPlist, identityCertificate?: string): Effect.Effect<void, MdmError> => {
      const scope: CheckinScope = { _tag: "device", udid: result.UDID, identityCertificate };
      const detail = result.ErrorChain
        ? result.ErrorChain.map((e) => `${e.ErrorDomain ?? ""}:${e.ErrorCode}`).join(", ")
        : undefined;
      return backend.appleDeviceEvent(scope, {
        _tag: "CommandResult",
        commandUUID: result.CommandUUID,
        status: result.Status,
        errorDetail: detail,
        queryResponses: result.QueryResponses,
      }).pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.void),
        Effect.catchTag("UnknownDevice", () => Effect.void),
        Effect.mapError(toMdmError("Failed to send CommandResult event")),
      );
    };

    const handleCheckin = (scope: CheckinScope): Effect.Effect<{ commandUUID: string; requestType: string; payload: unknown } | null, MdmError> =>
      Effect.gen(function* () {
        const manifest = yield* backend.appleManagementCheckin(scope).pipe(
          Effect.catchTag("UnknownDevice", () => Effect.succeed({ _tag: "Idle" } as const)),
          Effect.mapError(toMdmError("Management backend checkin failed")),
        );
        switch (manifest._tag) {
          case "Idle":
            return null;
          case "Command":
            return { commandUUID: manifest.commandUUID, requestType: manifest.requestType, payload: manifest.payload };
          case "DdmSync": {
            const uuid = yield* deterministicUuid(`dcm:${scope.udid}:${manifest.serverToken}`);
            return { commandUUID: uuid, requestType: "DeclarativeManagement", payload: {} };
          }
        }
      });

    const handleDeclarativeTokens = (scope: CheckinScope): Effect.Effect<{ SyncTokens: { Tokens: Array<{ Token: string; Type: string }> } }, MdmError> =>
      Effect.gen(function* () {
        const tokens = yield* backend.getAppleDeclarationTokens(scope).pipe(
          Effect.catchTag("UnknownDevice", () => Effect.fail(new MdmError({ message: "Unknown device" }))),
          Effect.mapError(toMdmError("Management backend cannot provide declaration tokens")),
        );
        return {
          SyncTokens: {
            Tokens: [
              { Type: "configurations", Token: tokens.configurationsToken },
              { Type: "activations", Token: tokens.activationsToken },
              { Type: "assets", Token: tokens.assetsToken },
              { Type: "management", Token: tokens.managementToken },
            ],
          },
        };
      });

    const handleDeclarationItems = (scope: CheckinScope) =>
      Effect.gen(function* () {
        const items = yield* backend.getAppleDeclarationItems(scope).pipe(
          Effect.catchTag("UnknownDevice", () => Effect.fail(new MdmError({ message: "Unknown device" }))),
          Effect.mapError(toMdmError("Management backend cannot provide declaration items")),
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
        };
      });

    const handleDeclaration = (scope: CheckinScope, type: string, identifier: string): Effect.Effect<object, MdmError> =>
      Effect.gen(function* () {
        const decl = yield* backend.getAppleDeclaration(scope, type, identifier).pipe(
          Effect.catchTag("UnknownDevice", () => Effect.fail(new MdmError({ message: "Unknown device" }))),
          Effect.mapError(toMdmError("Management backend cannot fetch declaration")),
        );
        if (!decl) return yield* Effect.fail(new MdmError({ message: `Declaration ${identifier} not found` }));
        return decl;
      });

    const handleStatusReport = (scope: CheckinScope, report: DDMStatusReport): Effect.Effect<void, MdmError> =>
      backend.appleDeviceEvent(scope, {
        _tag: "DeclarationStatus",
        statusItems: report.StatusItems,
        errors: report.Errors?.map((e) => ({
          identifier: e.Identifier,
          serverToken: e.ServerToken,
          active: e.Active,
          valid: e.Valid,
          reasons: e.Reasons?.map((r) => ({ description: r.Description })),
        })),
      }).pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.void),
        Effect.catchTag("UnknownDevice", () => Effect.void),
        Effect.mapError(toMdmError("Failed to send DeclarationStatus event")),
      );

    const queueInstallProfile = (deviceId: string, profilePayload: unknown): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        yield* backend.queueAppleCommand(deviceId, "InstallProfile", profilePayload).pipe(
          Effect.mapError(toMdmError("Failed to queue InstallProfile command")),
        );
        yield* pushToDevice(deviceId);
      });

    const queueInstallApplication = (deviceId: string, appPayload: unknown): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        yield* backend.queueAppleCommand(deviceId, "InstallApplication", appPayload).pipe(
          Effect.mapError(toMdmError("Failed to queue InstallApplication command")),
        );
        yield* pushToDevice(deviceId);
      });

    const queueCollectInformation = (deviceId: string, queries: string[]): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        yield* backend.queueAppleCommand(deviceId, "DeviceInformation", { Queries: queries }).pipe(
          Effect.mapError(toMdmError("Failed to queue DeviceInformation command")),
        );
        yield* pushToDevice(deviceId);
      });

    const generateEnrollmentProfile = (): Effect.Effect<string, MdmError> =>
      Effect.gen(function* () {
        const scepUuid = crypto.randomUUID();
        const mdmUuid = crypto.randomUUID();
        const topUuid = crypto.randomUUID();
        const profile = {
          PayloadContent: [
            {
              PayloadContent: {
                Challenge: "mattrax-scep-challenge",
                "Key Type": "RSA",
                "Key Usage": 5,
                Keysize: 2048,
                Subject: [
                  [["O", "Mattrax"]],
                  [["CN", "Mattrax Identity"]],
                ],
                URL: `${config.origin}/mdm/apple/scep`,
              },
              PayloadIdentifier: "com.mattrax.scep",
              PayloadType: "com.apple.security.scep",
              PayloadUUID: scepUuid,
              PayloadVersion: 1,
            },
            {
              AccessRights: 8191,
              CheckInURL: `${config.origin}/mdm/apple/mdm`,
              CheckOutWhenRemoved: true,
              IdentityCertificateUUID: scepUuid,
              PayloadIdentifier: "com.mattrax.mdm",
              PayloadType: "com.apple.mdm",
              PayloadUUID: mdmUuid,
              PayloadVersion: 1,
              ServerCapabilities: [
                "com.apple.mdm.per-user-connections",
                "com.apple.mdm.bootstraptoken",
              ],
              ServerURL: `${config.origin}/mdm/apple/mdm`,
              SignMessage: true,
              Topic: config.topic,
            },
          ],
          PayloadDisplayName: "Mattrax Enrollment",
          PayloadIdentifier: "com.mattrax.enrollment",
          PayloadOrganization: "Mattrax",
          PayloadType: "Configuration",
          PayloadUUID: topUuid,
          PayloadVersion: 1,
        };
        return JSON.stringify(profile);
      });

    return AppleMdmService.of({
      handleAuthenticate,
      handleTokenUpdate,
      handleCheckOut,
      handleCommandResult,
      handleStatusReport,
      handleCheckin,
      handleDeclarativeTokens,
      handleDeclarationItems,
      handleDeclaration,
      queueInstallProfile,
      queueInstallApplication,
      queueCollectInformation,
      generateEnrollmentProfile,
    });
  }),
);
