import { Data, Schema } from "effect";

export class MdmError extends Data.TaggedError("MdmError")<{ message: string; cause?: unknown }> {}
export class DeviceNotFound extends Data.TaggedError("DeviceNotFound")<{ deviceId: string }> {}
export class PlistParseError extends Data.TaggedError("PlistParseError")<{ message: string; cause?: unknown }> {}
export class PlistSerializeError extends Data.TaggedError("PlistSerializeError")<{ message: string; cause?: unknown }> {}
export class ScepError extends Data.TaggedError("ScepError")<{ message: string; cause?: unknown }> {}
export class DeclarationNotFound extends Data.TaggedError("DeclarationNotFound")<{ declarationId: string }> {}

export const DeviceStatus = Schema.Literals(["enrolling", "active", "checked_out"]);
export type DeviceStatus = typeof DeviceStatus.Type;

export const CommandStatus = Schema.Literals(["pending", "sent", "acknowledged", "error", "not_now"]);
export type CommandStatus = typeof CommandStatus.Type;

export const DeclarationType = Schema.Literals(["configuration", "activation", "asset", "management"]);
export type DeclarationType = typeof DeclarationType.Type;

export const DeviceDeclarationStatus = Schema.Literals(["pending", "active", "failed", "removed"]);
export type DeviceDeclarationStatus = typeof DeviceDeclarationStatus.Type;

export const Channel = Schema.Literals(["device", "user"]);
export type Channel = typeof Channel.Type;

export const AppleDevice = Schema.Struct({
  id: Schema.String,
  udid: Schema.String,
  serialNumber: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  osVersion: Schema.optional(Schema.String),
  supportsDdm: Schema.Boolean,
  pushToken: Schema.optional(Schema.String),
  pushMagic: Schema.optional(Schema.String),
  topic: Schema.optional(Schema.String),
  channel: Channel,
  status: DeviceStatus,
  enrolledAt: Schema.DateFromString,
  lastSeenAt: Schema.DateFromString,
  identityCertPem: Schema.optional(Schema.String),
});
export type AppleDevice = typeof AppleDevice.Type;

export const MdmCommand = Schema.Struct({
  id: Schema.String,
  deviceId: Schema.String,
  requestType: Schema.String,
  payload: Schema.Unknown,
  status: CommandStatus,
  resultDetail: Schema.optional(Schema.String),
  priority: Schema.Number,
  createdAt: Schema.DateFromString,
  sentAt: Schema.optional(Schema.DateFromString),
});
export type MdmCommand = typeof MdmCommand.Type;

export const Declaration = Schema.Struct({
  id: Schema.String,
  type: DeclarationType,
  payload: Schema.Unknown,
  serverToken: Schema.String,
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
});
export type Declaration = typeof Declaration.Type;

export const DeviceDeclarationState = Schema.Struct({
  id: Schema.Number,
  deviceId: Schema.String,
  declarationId: Schema.String,
  status: DeviceDeclarationStatus,
  detail: Schema.optional(Schema.String),
  serverToken: Schema.String,
});
export type DeviceDeclarationState = typeof DeviceDeclarationState.Type;

export const AuthenticatePlist = Schema.Struct({
  MessageType: Schema.Literal("Authenticate"),
  Topic: Schema.String,
  UDID: Schema.String,
  SerialNumber: Schema.optional(Schema.String),
  OSVersion: Schema.optional(Schema.String),
  Model: Schema.optional(Schema.String),
  ModelName: Schema.optional(Schema.String),
});
export type AuthenticatePlist = typeof AuthenticatePlist.Type;

export const TokenUpdatePlist = Schema.Struct({
  MessageType: Schema.Literal("TokenUpdate"),
  Topic: Schema.String,
  UDID: Schema.String,
  PushMagic: Schema.String,
  Token: Schema.Uint8ArrayFromBase64,
  UnlockToken: Schema.optional(Schema.Uint8ArrayFromBase64),
  UserID: Schema.optional(Schema.String),
});
export type TokenUpdatePlist = typeof TokenUpdatePlist.Type;

export const CheckOutPlist = Schema.Struct({
  MessageType: Schema.Literal("CheckOut"),
  Topic: Schema.String,
  UDID: Schema.String,
});
export type CheckOutPlist = typeof CheckOutPlist.Type;

export const CommandResultPlist = Schema.Struct({
  UDID: Schema.String,
  Status: Schema.String,
  CommandUUID: Schema.String,
  ErrorChain: Schema.optional(Schema.Array(Schema.Struct({
    ErrorCode: Schema.Number,
    ErrorDomain: Schema.optional(Schema.String),
    localizedDescription: Schema.optional(Schema.String),
  }))),
});
export type CommandResultPlist = typeof CommandResultPlist.Type;

export const DDMStatusReport = Schema.Struct({
  StatusItems: Schema.optional(Schema.Unknown),
  Errors: Schema.optional(Schema.Array(Schema.Struct({
    Identifier: Schema.String,
    ServerToken: Schema.String,
    Active: Schema.Boolean,
    Valid: Schema.String,
    Reasons: Schema.optional(Schema.Array(Schema.Struct({
      Description: Schema.String,
    }))),
  }))),
});
export type DDMStatusReport = typeof DDMStatusReport.Type;

export const DeviceInfo = Schema.Struct({
  udid: Schema.String,
  serialNumber: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  osVersion: Schema.optional(Schema.String),
});
export type DeviceInfo = typeof DeviceInfo.Type;

export const CommandResult = Schema.Struct({
  commandUuid: Schema.String,
  deviceId: Schema.String,
  status: Schema.String,
  detail: Schema.optional(Schema.String),
});
export type CommandResult = typeof CommandResult.Type;

export const DeclarationStatusReport = Schema.Struct({
  deviceId: Schema.String,
  declarationId: Schema.String,
  status: Schema.String,
  detail: Schema.optional(Schema.String),
});
export type DeclarationStatusReport = typeof DeclarationStatusReport.Type;

export const CollectedDeviceInfo = Schema.Struct({
  deviceId: Schema.String,
  queries: Schema.Record(Schema.String, Schema.Unknown),
});
export type CollectedDeviceInfo = typeof CollectedDeviceInfo.Type;

export const CreateDeclarationInput = Schema.Struct({
  id: Schema.String,
  type: DeclarationType,
  payload: Schema.Unknown,
});
export type CreateDeclarationInput = typeof CreateDeclarationInput.Type;
