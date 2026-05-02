import { Data, Schema } from "effect";
import { ScepError } from "@mattrax/scep";

export { ScepError };

export class MdmError extends Data.TaggedError("MdmError")<{ message: string; cause?: unknown }> {}
export class DeviceNotFound extends Data.TaggedError("DeviceNotFound")<{ deviceId: string }> {}
export class PlistParseError extends Data.TaggedError("PlistParseError")<{ message: string; cause?: unknown }> {}
export class PlistSerializeError extends Data.TaggedError("PlistSerializeError")<{ message: string; cause?: unknown }> {}
export class DeclarationNotFound extends Data.TaggedError("DeclarationNotFound")<{ declarationId: string }> {}

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
  Token: Schema.String,
  UnlockToken: Schema.optional(Schema.String),
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
  Command: Schema.optional(Schema.Struct({
    RequestType: Schema.String,
  })),
  QueryResponses: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
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
