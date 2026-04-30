import { Context, Data, Effect } from "effect";

export class ManagementNotSupported extends Data.TaggedError("ManagementNotSupported") {}

export interface DeviceInfo {
  udid: string;
  serialNumber?: string;
  model?: string;
  osVersion?: string;
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
    readonly reportDeviceEnrolled: (deviceId: string, info: DeviceInfo) => Effect.Effect<void, ManagementNotSupported>;
    readonly reportCommandResult: (deviceId: string, result: CommandResult) => Effect.Effect<void, ManagementNotSupported>;
    readonly reportDeclarationStatus: (deviceId: string, status: DeclarationStatusReport) => Effect.Effect<void, ManagementNotSupported>;
    readonly reportDeviceInfo: (deviceId: string, info: CollectedDeviceInfo) => Effect.Effect<void, ManagementNotSupported>;
  }
>()("ManagementBackend") {}
