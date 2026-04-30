import { Context, Effect, Layer } from "effect";
import {
  type AppleDevice,
  type MdmCommand,
  type Declaration,
  type DeviceDeclarationState,
  type CreateDeclarationInput,
  type AuthenticatePlist,
  type TokenUpdatePlist,
  type CheckOutPlist,
  type CommandResultPlist,
  type DDMStatusReport,
  DeviceDeclarationStatus,
  MdmError,
} from "./schema";
import { AppleMdmRepository } from "./repository";
import { ManagementBackend } from "../../webhook/layer";

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

function translateDeclarationsToCommands(device: AppleDevice, declarations: Declaration[]): MdmCommand[] {
  const now = new Date();
  const commands: MdmCommand[] = [];

  for (const decl of declarations) {
    switch (decl.type) {
      case "configuration": {
        commands.push({
          id: crypto.randomUUID(),
          deviceId: device.id,
          requestType: "InstallProfile",
          payload: decl.payload,
          status: "pending",
          priority: 5,
          createdAt: now,
        });
        break;
      }
      case "management": {
        const payload = decl.payload as Record<string, unknown>;
        if (payload.requestType === "InstallApplication" || payload.requestType === "ApplicationConfiguration") {
          commands.push({
            id: crypto.randomUUID(),
            deviceId: device.id,
            requestType: "InstallApplication",
            payload: decl.payload,
            status: "pending",
            priority: 5,
            createdAt: now,
          });
        }
        break;
      }
    }
  }

  return commands;
}

export class AppleMdmService extends Context.Service<
  AppleMdmService,
  {
    readonly handleAuthenticate: (auth: AuthenticatePlist) => Effect.Effect<void, MdmError>;
    readonly handleTokenUpdate: (update: TokenUpdatePlist) => Effect.Effect<void, MdmError>;
    readonly handleCheckOut: (checkout: CheckOutPlist) => Effect.Effect<void, MdmError>;
    readonly retrieveNextCommand: (deviceId: string) => Effect.Effect<MdmCommand | null, MdmError>;
    readonly handleCommandResult: (result: CommandResultPlist) => Effect.Effect<void, MdmError>;
    readonly createDeclaration: (input: CreateDeclarationInput) => Effect.Effect<void, MdmError>;
    readonly deleteDeclaration: (id: string) => Effect.Effect<void, MdmError>;
    readonly reconcileDevice: (deviceId: string) => Effect.Effect<void, MdmError>;
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

    const getOrCreateDevice = (udid: string): Effect.Effect<AppleDevice, MdmError> =>
      Effect.gen(function* () {
        const existing = yield* repo.getDeviceByUdid(udid);
        if (existing) return existing;
        const id = crypto.randomUUID();
        const now = new Date();
        const device: AppleDevice = {
          id,
          udid,
          serialNumber: undefined,
          model: undefined,
          osVersion: undefined,
          supportsDdm: false,
          pushToken: undefined,
          pushMagic: undefined,
          topic: undefined,
          channel: "device",
          status: "enrolling",
          enrolledAt: now,
          lastSeenAt: now,
          identityCertPem: undefined,
        };
        yield* repo.upsertDevice(device);
        return device;
      });

    const handleAuthenticate = (auth: AuthenticatePlist): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        const device = yield* getOrCreateDevice(auth.UDID);
        const updated: AppleDevice = {
          ...device,
          serialNumber: auth.SerialNumber ?? device.serialNumber,
          model: auth.Model ?? device.model,
          osVersion: auth.OSVersion ?? device.osVersion,
          status: "enrolling",
          lastSeenAt: new Date(),
        };
        yield* repo.upsertDevice(updated);
      });

    const handleTokenUpdate = (update: TokenUpdatePlist): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        const device = yield* getOrCreateDevice(update.UDID);
        const supportsDdm = detectDdmSupport(device.osVersion);
        const updated: AppleDevice = {
          ...device,
          pushMagic: update.PushMagic,
          pushToken: base64ToHex(update.Token),
          topic: update.Topic,
          channel: update.UserID ? "user" : "device",
          status: "active",
          supportsDdm,
          lastSeenAt: new Date(),
        };
        yield* repo.upsertDevice(updated);
        yield* repo.updateDeviceDdmSupport(device.id, supportsDdm);

        yield* webhook.reportDeviceEnrolled(device.id, {
          udid: device.udid,
          serialNumber: device.serialNumber,
          model: device.model,
          osVersion: device.osVersion,
        }).pipe(Effect.catchTag("ManagementNotSupported", () => Effect.void));
      });

    const handleCheckOut = (checkout: CheckOutPlist): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        const device = yield* repo.getDeviceByUdid(checkout.UDID);
        if (!device) return;
        yield* repo.updateDeviceStatus(device.id, "checked_out");
      });

    const retrieveNextCommand = (deviceId: string): Effect.Effect<MdmCommand | null, MdmError> =>
      repo.getNextPendingCommand(deviceId);

    const handleCommandResult = (result: CommandResultPlist): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        const device = yield* repo.getDeviceByUdid(result.UDID);
        if (!device) return;

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
        yield* repo.updateDeviceLastSeen(device.id);

        yield* webhook.reportCommandResult(device.id, {
          commandUuid: result.CommandUUID,
          deviceId: device.id,
          status: result.Status,
          detail,
        }).pipe(Effect.catchTag("ManagementNotSupported", () => Effect.void));
      });

    const createDeclaration = (input: CreateDeclarationInput): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        const now = new Date();
        const token = crypto.randomUUID();
        const declaration: Declaration = {
          id: input.id,
          type: input.type,
          payload: input.payload,
          serverToken: token,
          createdAt: now,
          updatedAt: now,
        };
        yield* repo.insertDeclaration(declaration);
      });

    const deleteDeclaration = (id: string): Effect.Effect<void, MdmError> =>
      repo.deleteDeclaration(id).pipe(
        Effect.catchTag("DeclarationNotFound", (e) => Effect.fail(new MdmError({ message: `Declaration not found: ${e.declarationId}` }))),
      );

    const reconcileDevice = (deviceId: string): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        const device = yield* repo.getDeviceById(deviceId);
        if (!device) return;

        if (device.supportsDdm) {
          const cmd: MdmCommand = {
            id: crypto.randomUUID(),
            deviceId,
            requestType: "DeclarativeManagement",
            payload: {},
            status: "pending",
            priority: 10,
            createdAt: new Date(),
          };
          yield* repo.insertCommand(cmd);
        } else {
          const declarations = yield* repo.getDeclarations();
          const commands = translateDeclarationsToCommands(device, declarations);
          for (const cmd of commands) {
            yield* repo.insertCommand(cmd);
          }
        }
      });

    const handleDeclarativeTokens = (deviceId: string): Effect.Effect<{ SyncTokens: { Tokens: Array<{ Token: string; Type: string }> } }, MdmError> =>
      Effect.gen(function* () {
        const states = yield* repo.getDeviceDeclarations(deviceId);
        const tokens = states.map((s) => ({ Token: s.serverToken, Type: s.declarationId }));
        return { SyncTokens: { Tokens: tokens } };
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
        const declarations = yield* repo.getDeclarations();
        const states = yield* repo.getDeviceDeclarations(deviceId);
        const stateMap = new Map(states.map((s) => [s.declarationId, s]));

        const activations: Array<{ Identifier: string; ServerToken: string }> = [];
        const configurations: Array<{ Identifier: string; ServerToken: string }> = [];
        const assets: Array<{ Identifier: string; ServerToken: string }> = [];
        const management: Array<{ Identifier: string; ServerToken: string }> = [];

        for (const decl of declarations) {
          const state = stateMap.get(decl.id);
          const token = state?.serverToken ?? decl.serverToken;
          const item = { Identifier: decl.id, ServerToken: token };
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

    const handleDeclaration = (deviceId: string, _type: string, identifier: string): Effect.Effect<object, MdmError> =>
      Effect.gen(function* () {
        const decl = yield* repo.getDeclarationById(identifier);
        if (!decl) return yield* new MdmError({ message: `Declaration ${identifier} not found` });

        const states = yield* repo.getDeviceDeclarations(deviceId);
        if (!states.find((s) => s.declarationId === identifier)) {
          const state: DeviceDeclarationState = {
            id: 0,
            deviceId,
            declarationId: identifier,
            status: "pending",
            serverToken: decl.serverToken,
          };
          yield* repo.upsertDeviceDeclaration(state);
        }

        const payload = { ...(decl.payload as object), ServerToken: decl.serverToken };
        return payload;
      });

    const handleStatusReport = (deviceId: string, report: DDMStatusReport): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        const errors = report.Errors ?? [];
        for (const error of errors) {
          const status: typeof DeviceDeclarationStatus.Type = error.Valid === "invalid" ? "failed" : error.Active ? "active" : "pending";
          const detail = error.Reasons?.map((r) => r.Description).join(", ");
          yield* repo.updateDeviceDeclarationStatus(deviceId, error.Identifier, status, detail);

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
        const device = yield* repo.getDeviceById(deviceId);
        if (!device) return;
        const cmd: MdmCommand = {
          id: crypto.randomUUID(),
          deviceId,
          requestType: "InstallProfile",
          payload: profilePayload,
          status: "pending",
          priority: 5,
          createdAt: new Date(),
        };
        yield* repo.insertCommand(cmd);
      });

    const queueInstallApplication = (deviceId: string, appPayload: unknown): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        const device = yield* repo.getDeviceById(deviceId);
        if (!device) return;
        const cmd: MdmCommand = {
          id: crypto.randomUUID(),
          deviceId,
          requestType: "InstallApplication",
          payload: appPayload,
          status: "pending",
          priority: 5,
          createdAt: new Date(),
        };
        yield* repo.insertCommand(cmd);
      });

    const queueCollectInformation = (deviceId: string, queries: string[]): Effect.Effect<void, MdmError> =>
      Effect.gen(function* () {
        const device = yield* repo.getDeviceById(deviceId);
        if (!device) return;
        const cmd: MdmCommand = {
          id: crypto.randomUUID(),
          deviceId,
          requestType: "DeviceInformation",
          payload: { Queries: queries },
          status: "pending",
          priority: 5,
          createdAt: new Date(),
        };
        yield* repo.insertCommand(cmd);
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
      retrieveNextCommand,
      handleCommandResult,
      createDeclaration,
      deleteDeclaration,
      reconcileDevice,
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
