import { Schema, Context, Effect } from "effect";

export class ManagementNotSupported extends Schema.TaggedErrorClass<ManagementNotSupported>()("ManagementNotSupported", {}) {}
export class UnknownDevice extends Schema.TaggedErrorClass<UnknownDevice>()("UnknownDevice", {}) {}
export class ServerInitiatedUnenrollment extends Schema.TaggedErrorClass<ServerInitiatedUnenrollment>()("ServerInitiatedUnenrollment", {}) {}
export class InternalServerError extends Schema.TaggedErrorClass<InternalServerError>()("InternalServerError", {}) {}

export const CheckinScope = Schema.Union([
  Schema.TaggedStruct("device", {
    udid: Schema.String,
    identityCertificate: Schema.optional(Schema.String),
  }),
  Schema.TaggedStruct("user", {
    udid: Schema.String,
    identityCertificate: Schema.optional(Schema.String),
    userId: Schema.String,
    userShortName: Schema.optional(Schema.String),
  }),
]);
export type CheckinScope = typeof CheckinScope.Type;

export const AppleDeviceEvent = Schema.Union([
  Schema.TaggedStruct("Authenticate", {
    serialNumber: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    osVersion: Schema.optional(Schema.String),
  }),
  Schema.TaggedStruct("TokenUpdate", {
    pushToken: Schema.String,
    pushMagic: Schema.String,
    topic: Schema.String,
    channel: Schema.Literals(["user", "device"]),
  }),
  Schema.TaggedStruct("CheckOut", {}),
  Schema.TaggedStruct("CommandResult", {
    commandUUID: Schema.String,
    status: Schema.String,
    errorDetail: Schema.optional(Schema.String),
    queryResponses: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  Schema.TaggedStruct("DeclarationStatus", {
    statusItems: Schema.optional(Schema.Unknown),
    errors: Schema.optional(Schema.Array(Schema.Struct({
      identifier: Schema.String,
      serverToken: Schema.String,
      active: Schema.Boolean,
      valid: Schema.String,
      reasons: Schema.optional(Schema.Array(Schema.Struct({
        description: Schema.String,
      }))),
    }))),
  }),
]);
export type AppleDeviceEvent = typeof AppleDeviceEvent.Type;

// Mutually exclusive: what the device should do after a checkin.
// DdmSync and Command cannot both apply at once due to the underlying protocol.
export const ManagementManifest = Schema.Union([
  Schema.TaggedStruct("Idle", {}),
  Schema.TaggedStruct("Command", {
    commandUUID: Schema.String,
    requestType: Schema.String,
    payload: Schema.Unknown,
  }),
  Schema.TaggedStruct("DdmSync", {
    serverToken: Schema.String,
  }),
]);
export type ManagementManifest = typeof ManagementManifest.Type;

export const DdmTokens = Schema.Struct({
  activationsToken: Schema.String,
  configurationsToken: Schema.String,
  assetsToken: Schema.String,
  managementToken: Schema.String,
});
export type DdmTokens = typeof DdmTokens.Type;

export const DdmDeclarationItem = Schema.Struct({
  identifier: Schema.String,
  serverToken: Schema.String,
});
export type DdmDeclarationItem = typeof DdmDeclarationItem.Type;

export const DdmDeclarationItems = Schema.Struct({
  activations: Schema.Array(DdmDeclarationItem),
  configurations: Schema.Array(DdmDeclarationItem),
  assets: Schema.Array(DdmDeclarationItem),
  management: Schema.Array(DdmDeclarationItem),
});
export type DdmDeclarationItems = typeof DdmDeclarationItems.Type;

export class ManagementBackend extends Context.Service<
  ManagementBackend,
  {
    // Device lifecycle and protocol events (device-initiated)
    readonly appleDeviceEvent: (scope: CheckinScope, event: AppleDeviceEvent) => Effect.Effect<void, ManagementNotSupported | UnknownDevice | InternalServerError>;

    // Regular device checkin: returns what the device should do next (imperative)
    readonly appleManagementCheckin: (scope: CheckinScope) => Effect.Effect<ManagementManifest, ManagementNotSupported | UnknownDevice | ServerInitiatedUnenrollment | InternalServerError>;

    // DDM sub-endpoint handlers (device-initiated)
    readonly getAppleDeclarationTokens: (scope: CheckinScope) => Effect.Effect<DdmTokens, ManagementNotSupported | UnknownDevice | InternalServerError>;
    readonly getAppleDeclarationItems: (scope: CheckinScope) => Effect.Effect<DdmDeclarationItems, ManagementNotSupported | UnknownDevice | InternalServerError>;
    readonly getAppleDeclaration: (scope: CheckinScope, type: string, identifier: string) => Effect.Effect<Record<string, unknown> | null, ManagementNotSupported | UnknownDevice | InternalServerError>;
  }
>()("ManagementBackend") {}
