import { Data, Schema } from "effect";

export { PlistParseError, PlistSerializeError } from "@mattrax/plist";

export class MdmError extends Data.TaggedError("MdmError")<{ message: string; cause?: unknown }> {}

export class DeviceNotFound extends Data.TaggedError("DeviceNotFound")<{ deviceId: string }> {}

export class DeviceUnenrolled extends Data.TaggedError("DeviceUnenrolled")<{}> {}

export class DeclarationNotFound extends Data.TaggedError("DeclarationNotFound")<{
  declarationId: string;
}> {}

export const AuthenticatePlist = Schema.Struct({
  MessageType: Schema.Literal("Authenticate"),
  Topic: Schema.String,
  UDID: Schema.String,
  SerialNumber: Schema.optional(Schema.String),
  OSVersion: Schema.optional(Schema.String),
  Model: Schema.optional(Schema.String),
  ModelName: Schema.optional(Schema.String),
  ProductName: Schema.optional(Schema.String),
  EnrollmentID: Schema.optional(Schema.String),
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
  EnrollmentID: Schema.optional(Schema.String),
  AwaitingConfiguration: Schema.optional(Schema.Boolean),
  UserShortName: Schema.optional(Schema.String),
  UserLongName: Schema.optional(Schema.String),
});

export type TokenUpdatePlist = typeof TokenUpdatePlist.Type;

export const CheckOutPlist = Schema.Struct({
  MessageType: Schema.Literal("CheckOut"),
  Topic: Schema.String,
  UDID: Schema.String,
  UserID: Schema.optional(Schema.String),
  EnrollmentID: Schema.optional(Schema.String),
});

export type CheckOutPlist = typeof CheckOutPlist.Type;

export const CommandResultPlist = Schema.Struct({
  UDID: Schema.String,
  Status: Schema.String,
  CommandUUID: Schema.optional(Schema.String),
  Command: Schema.optional(
    Schema.Struct({
      RequestType: Schema.String,
    }),
  ),
  QueryResponses: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  ErrorChain: Schema.optional(
    Schema.Array(
      Schema.Struct({
        ErrorCode: Schema.Number,
        ErrorDomain: Schema.optional(Schema.String),
        localizedDescription: Schema.optional(Schema.String),
      }),
    ),
  ),
});

export type CommandResultPlist = typeof CommandResultPlist.Type;

export const SetBootstrapTokenPlist = Schema.Struct({
  MessageType: Schema.Literal("SetBootstrapToken"),
  UDID: Schema.String,
  BootstrapToken: Schema.optional(Schema.String),
  EnrollmentID: Schema.optional(Schema.String),
});

export const GetBootstrapTokenPlist = Schema.Struct({
  MessageType: Schema.Literal("GetBootstrapToken"),
  UDID: Schema.String,
  EnrollmentID: Schema.optional(Schema.String),
});

export const DDMStatusReport = Schema.Struct({
  /** Flat map of Apple status item paths to their values. */
  StatusItems: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  Errors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        StatusItem: Schema.optional(Schema.String),
        Reasons: Schema.optional(
          Schema.Array(
            Schema.Struct({
              Code: Schema.optional(Schema.String),
              Description: Schema.optional(Schema.String),
              Details: Schema.optional(Schema.Unknown),
            }),
          ),
        ),
      }),
    ),
  ),
});

export type DDMStatusReport = typeof DDMStatusReport.Type;
