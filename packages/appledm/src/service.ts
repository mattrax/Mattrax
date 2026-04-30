import { Context, Effect, Layer } from "effect";
import {
  type AuthenticatePlist,
  type CheckOutPlist,
  type CommandResultPlist,
  type DDMStatusReport,
  type MdmCommand,
  type TokenUpdatePlist,
  MdmError,
} from "./schema.js";
import { AppleMdmRepository } from "./repository.js";
import { ApnsService } from "./apns.js";
import { type AppleDeclarationManifest, ManagementBackend } from "@mattrax/mdm-domain";

function detectDdmSupport(osVersion: string | undefined): boolean {
  if (!osVersion) return false;
  const parts = osVersion.split(".");
  const major = parseInt(parts[0] ?? "0", 10);
  const minor = parseInt(parts[1] ?? "0", 10);
  if (major >= 14) return true;
  if (major === 13 && minor >= 0) return true;
  return false;
}

function base64ToHex(base64: string): string {
  const cleaned = base64.replace(/\s/g, "");
  const padded = cleaned.padEnd(cleaned.length + ((4 - (cleaned.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Array.from(binary)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableJson(val)}`).join(",")}}`;
  }
  return JSON.stringify(value);
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
    catch: (cause) => new MdmError({ message: "Failed to create deterministic command UUID", cause }),
  });
}

export class AppleMdmService extends Context.Service<
  AppleMdmService,
  {
    readonly handleAuthenticate: (auth: AuthenticatePlist) => Effect.Effect<void, MdmError>;
    readonly handleTokenUpdate: (update: TokenUpdatePlist) => Effect.Effect<void, MdmError>;
    readonly handleCheckOut: (checkout: CheckOutPlist) => Effect.Effect<void, MdmError>;
    readonly getDeviceSessionByUdid: (udid: string) => Effect.Effect<{ deviceId: string; supportsDdm: boolean; dcmEnabled: boolean } | null, MdmError>;
    readonly handleAppleCheckin: (deviceId: string) => Effect.Effect<void, MdmError>;
    readonly retrieveNextCommand: (deviceId: string) => Effect.Effect<MdmCommand | null, MdmError>;
    readonly markCommandSent: (commandId: string) => Effect.Effect<void, MdmError>;
    readonly retrieveDcmCommand: (deviceId: string) => Effect.Effect<MdmCommand, MdmError>;
    readonly handleCommandResult: (result: CommandResultPlist) => Effect.Effect<void, MdmError>;
    readonly handleDeclarativeTokens: (deviceId: string) => Effect.Effect<{ SyncTokens: { Tokens: Array<{ Token: string; Type: string }> } }, MdmError>;
    readonly handleDeclarationItems: (deviceId: string) => Effect.Effect<{
      Declarations: {
        Activations: Array<{ Identifier: string; ServerToken: string }>;
        Configurations: Array<{ Identifier: string; ServerToken: string }>;
        Assets: Array<{ Identifier: string; ServerToken: string }>;
        Management: Array<{ Identifier: string; ServerToken: string }>;
      };
    }, MdmError>;
    readonly handleDeclaration: (deviceId: string, type: string, identifier: string) => Effect.Effect<object, MdmError>;
    readonly handleStatusReport: (deviceId: string, report: DDMStatusReport) => Effect.Effect<void, MdmError>;
    readonly queueInstallProfile: (deviceId: string, profilePayload: unknown) => Effect.Effect<void, MdmError>;
    readonly queueInstallApplication: (deviceId: string, appPayload: unknown) => Effect.Effect<void, MdmError>;
    readonly queueCollectInformation: (deviceId: string, queries: string[]) => Effect.Effect<void, MdmError>;
    readonly generateEnrollmentProfile: () => Effect.Effect<string, MdmError>;
  }
>()("AppleMdmService") {}

export const AppleMdmServiceLive = (config: { origin: string; topic: string }) => Layer.effect(
  AppleMdmService,
  Effect.gen(function* () {
    const repo = yield* AppleMdmRepository;
    const webhook = yield* ManagementBackend;
    const apns = yield* ApnsService;

    const toMdmError = (message: string) => () => new MdmError({ message });

    const pushToDevice = (deviceId: string): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        const pushInfo = yield* repo.getDevicePushInfo(deviceId).pipe(
          Effect.orElseSucceed(() => null),
        );
        if (!pushInfo) return;
        yield* apns.push(pushInfo).pipe(
          Effect.ignore({ log: true, message: `[APNS] Push failed for device ${deviceId}` }),
        );
      });

    const getManifest = (deviceId: string): Effect.Effect<AppleDeclarationManifest, MdmError> =>
      webhook.getAppleDeclarationManifest(deviceId).pipe(
        Effect.mapError(toMdmError("Management backend does not provide Apple declarations")),
      );

    const handleAuthenticate = (auth: AuthenticatePlist): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        yield* webhook.authenticateAppleDevice({
          udid: auth.UDID,
          serialNumber: auth.SerialNumber,
          model: auth.Model ?? auth.ModelName,
          osVersion: auth.OSVersion,
        }).pipe(Effect.mapError(toMdmError("Management backend rejected Apple authentication")));
      });

    const handleTokenUpdate = (update: TokenUpdatePlist): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        const existing = yield* webhook.getAppleDeviceByUdid(update.UDID).pipe(
          Effect.mapError(toMdmError("Management backend cannot resolve Apple device")),
        );
        const supportsDdm = detectDdmSupport(undefined) || existing?.supportsDdm === true;
        const pushToken = base64ToHex(update.Token);
        const channel = update.UserID ? "user" : "device";
        const session = yield* webhook.updateAppleEnrollment({
          udid: update.UDID,
          pushMagic: update.PushMagic,
          pushToken,
          topic: update.Topic,
          channel,
          supportsDdm,
        }).pipe(Effect.mapError(toMdmError("Management backend rejected Apple enrollment")));

        yield* repo.storePushInfo(
          session.deviceId,
          update.UDID,
          pushToken,
          update.PushMagic,
          update.Topic,
          channel,
        );

        yield* webhook.reportDeviceEnrolled(session.deviceId, {
          udid: update.UDID,
        }).pipe(Effect.catchTag("ManagementNotSupported", () => Effect.void));
      });

    const handleCheckOut = (checkout: CheckOutPlist): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        const session = yield* webhook.getAppleDeviceByUdid(checkout.UDID).pipe(
          Effect.mapError(toMdmError("Management backend cannot resolve Apple checkout")),
        );
        if (session) yield* webhook.appleCheckin(session.deviceId).pipe(Effect.catchTag("ManagementNotSupported", () => Effect.void));
      });

    const getDeviceSessionByUdid = (udid: string) =>
      webhook.getAppleDeviceByUdid(udid).pipe(
        Effect.map((session) => session ? {
          deviceId: session.deviceId,
          supportsDdm: session.supportsDdm,
          dcmEnabled: session.dcmEnabled,
        } : null),
        Effect.mapError(toMdmError("Management backend cannot resolve Apple device")),
      );

    const retrieveNextCommand = (deviceId: string): Effect.Effect<MdmCommand | null, MdmError> =>
      repo.getNextPendingCommand(deviceId);

    const handleAppleCheckin = (deviceId: string): Effect.Effect<void, MdmError> =>
      webhook.appleCheckin(deviceId).pipe(Effect.catchTag("ManagementNotSupported", () => Effect.void));

    const markCommandSent = (commandId: string): Effect.Effect<void, MdmError> =>
      repo.updateCommandStatus(commandId, "sent");

    const retrieveDcmCommand = (deviceId: string): Effect.Effect<MdmCommand, MdmError> =>
      Effect.gen(function* () {
        const manifest = yield* getManifest(deviceId);
        const token = manifest.token ?? stableJson(manifest.declarations);
        const id = yield* deterministicUuid(`dcm:${deviceId}:${token}`);
        return {
          id,
          deviceId,
          requestType: "DeclarativeManagement",
          payload: {},
          status: "pending",
          priority: 10,
          createdAt: new Date(),
        };
      });

    const handleCommandResult = (result: CommandResultPlist): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        const session = yield* webhook.getAppleDeviceByUdid(result.UDID).pipe(
          Effect.mapError(toMdmError("Management backend cannot resolve Apple command result")),
        );
        if (!session) return;

        const status: MdmCommand["status"] =
          result.Status === "Acknowledged"
            ? "acknowledged"
            : result.Status === "NotNow"
              ? "not_now"
              : "error";

        const detail = result.ErrorChain
          ? result.ErrorChain.map((e) => `${e.ErrorDomain ?? ""}:${e.ErrorCode}`).join(", ")
          : undefined;

        yield* repo.updateCommandStatus(result.CommandUUID, status, detail);

        if (result.Command?.RequestType === "DeviceInformation") {
          const queries = { ...(result.QueryResponses ?? {}) };
          console.log("[AppleMDM] DeviceInformation", { deviceId: session.deviceId, queries });
          yield* webhook.reportDeviceInfo(session.deviceId, {
            deviceId: session.deviceId,
            queries,
          }).pipe(Effect.catchTag("ManagementNotSupported", () => Effect.void));
        }

        yield* webhook.reportCommandResult(session.deviceId, {
          commandUuid: result.CommandUUID,
          deviceId: session.deviceId,
          status: result.Status,
          detail,
        }).pipe(Effect.catchTag("ManagementNotSupported", () => Effect.void));
      });

    const handleDeclarativeTokens = (deviceId: string): Effect.Effect<{ SyncTokens: { Tokens: Array<{ Token: string; Type: string }> } }, MdmError> =>
      Effect.gen(function* () {
        const manifest = yield* getManifest(deviceId);
        return {
          SyncTokens: {
            Tokens: manifest.declarations.map((decl) => ({ Token: decl.serverToken, Type: decl.identifier })),
          },
        };
      });

    const handleDeclarationItems = (deviceId: string): Effect.Effect<{
      Declarations: {
        Activations: Array<{ Identifier: string; ServerToken: string }>;
        Configurations: Array<{ Identifier: string; ServerToken: string }>;
        Assets: Array<{ Identifier: string; ServerToken: string }>;
        Management: Array<{ Identifier: string; ServerToken: string }>;
      };
    }, MdmError> =>
      Effect.gen(function* () {
        const manifest = yield* getManifest(deviceId);
        const activations: Array<{ Identifier: string; ServerToken: string }> = [];
        const configurations: Array<{ Identifier: string; ServerToken: string }> = [];
        const assets: Array<{ Identifier: string; ServerToken: string }> = [];
        const management: Array<{ Identifier: string; ServerToken: string }> = [];

        for (const decl of manifest.declarations) {
          const item = { Identifier: decl.identifier, ServerToken: decl.serverToken };
          switch (decl.type) {
            case "activation":
              activations.push(item);
              break;
            case "configuration":
              configurations.push(item);
              break;
            case "asset":
              assets.push(item);
              break;
            case "management":
              management.push(item);
              break;
          }
        }

        return {
          Declarations: {
            Activations: activations,
            Configurations: configurations,
            Assets: assets,
            Management: management,
          },
        };
      });

    const handleDeclaration = (deviceId: string, type: string, identifier: string): Effect.Effect<object, MdmError> =>
      Effect.gen(function* () {
        const declaration = yield* webhook.getAppleDeclaration(deviceId, type, identifier).pipe(
          Effect.mapError(toMdmError("Management backend cannot fetch Apple declaration")),
        );
        if (!declaration) return yield* new MdmError({ message: `Declaration ${identifier} not found` });
        return declaration;
      });

    const handleStatusReport = (deviceId: string, report: DDMStatusReport): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        const errors = report.Errors ?? [];
        for (const error of errors) {
          const status = error.Valid === "invalid" ? "failed" : error.Active ? "active" : "pending";
          const detail = error.Reasons?.map((r) => r.Description).join(", ");
          yield* webhook.reportDeclarationStatus(deviceId, {
            deviceId,
            declarationId: error.Identifier,
            status,
            detail,
          }).pipe(Effect.catchTag("ManagementNotSupported", () => Effect.void));
        }
      });

    const queueInstallProfile = (deviceId: string, profilePayload: unknown): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        yield* repo.insertCommand({
          id: crypto.randomUUID(),
          deviceId,
          requestType: "InstallProfile",
          payload: profilePayload,
          status: "pending",
          priority: 5,
          createdAt: new Date(),
        });
        yield* pushToDevice(deviceId);
      });

    const queueInstallApplication = (deviceId: string, appPayload: unknown): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        yield* repo.insertCommand({
          id: crypto.randomUUID(),
          deviceId,
          requestType: "InstallApplication",
          payload: appPayload,
          status: "pending",
          priority: 5,
          createdAt: new Date(),
        });
        yield* pushToDevice(deviceId);
      });

    const queueCollectInformation = (deviceId: string, queries: string[]): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        yield* repo.insertCommand({
          id: crypto.randomUUID(),
          deviceId,
          requestType: "DeviceInformation",
          payload: { Queries: queries },
          status: "pending",
          priority: 5,
          createdAt: new Date(),
        });
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
      getDeviceSessionByUdid,
      handleAppleCheckin,
      retrieveNextCommand,
      markCommandSent,
      retrieveDcmCommand,
      handleCommandResult,
      handleDeclarativeTokens,
      handleDeclarationItems,
      handleDeclaration,
      handleStatusReport,
      queueInstallProfile,
      queueInstallApplication,
      queueCollectInformation,
      generateEnrollmentProfile,
    });
  }),
);
