import { Context, Data, Effect } from "effect";

export class ManagementNotSupported extends Data.TaggedError("ManagementNotSupported") {}

export interface DeviceInfo {
  udid: string;
  serialNumber?: string;
  model?: string;
  osVersion?: string;
}

export interface AppleEnrollmentUpdate extends DeviceInfo {
  pushMagic: string;
  pushToken: string;
  topic: string;
  channel: "device" | "user";
  supportsDdm: boolean;
}

export interface AppleDeviceSession {
  deviceId: string;
  udid: string;
  supportsDdm: boolean;
  dcmEnabled: boolean;
}

export interface AppleDeclarationItem {
  identifier: string;
  type: "activation" | "configuration" | "asset" | "management";
  serverToken: string;
}

export interface AppleDeclarationManifest {
  token?: string;
  declarations: readonly AppleDeclarationItem[];
}

export interface CommandResult {
  commandUuid: string;
  deviceId: string;
  status: string;
  detail?: string;
}

export interface DeclarationStatusReport {
  deviceId: string;
  declarationId: string;
  status: string;
  detail?: string;
}

export interface CollectedDeviceInfo {
  deviceId: string;
  queries: Record<string, unknown>;
}

export class ManagementBackend extends Context.Service<
  ManagementBackend,
  {
    readonly appleCheckin: (deviceId: string) => Effect.Effect<void, ManagementNotSupported>;
    readonly authenticateAppleDevice: (info: DeviceInfo) => Effect.Effect<AppleDeviceSession, ManagementNotSupported>;
    readonly updateAppleEnrollment: (update: AppleEnrollmentUpdate) => Effect.Effect<AppleDeviceSession, ManagementNotSupported>;
    readonly getAppleDeviceByUdid: (udid: string) => Effect.Effect<AppleDeviceSession | null, ManagementNotSupported>;
    readonly getAppleDeclarationManifest: (deviceId: string) => Effect.Effect<AppleDeclarationManifest, ManagementNotSupported>;
    readonly getAppleDeclaration: (deviceId: string, type: string, identifier: string) => Effect.Effect<object | null, ManagementNotSupported>;
    readonly reportDeviceEnrolled: (deviceId: string, info: DeviceInfo) => Effect.Effect<void, ManagementNotSupported>;
    readonly reportCommandResult: (deviceId: string, result: CommandResult) => Effect.Effect<void, ManagementNotSupported>;
    readonly reportDeclarationStatus: (deviceId: string, status: DeclarationStatusReport) => Effect.Effect<void, ManagementNotSupported>;
    readonly reportDeviceInfo: (deviceId: string, info: CollectedDeviceInfo) => Effect.Effect<void, ManagementNotSupported>;
  }
>()("ManagementBackend") {}
