import { Schema, Context, Data, Effect } from "effect";

export class ManagementNotSupported extends Data.TaggedError("ManagementNotSupported") {}
export class UnknownDevice extends Data.TaggedError("UnknownDevice") {}
export class ServerInitiatedUnenrollment extends Data.TaggedError("ServerInitiatedUnenrollment") {}
export class InternalServerError extends Data.TaggedError("InternalServerError") {}

export const AppleDeviceSession = Schema.Struct({
  deviceId: Schema.String,
  supportsDdm: Schema.Boolean,
});
export type AppleDeviceSession = typeof AppleDeviceSession.Type;

export const AppleDeviceEvent = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Authenticate"),
    serialNumber: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    osVersion: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    _tag: Schema.Literal("TokenUpdate"),
    pushToken: Schema.String,
    pushMagic: Schema.String,
    topic: Schema.String,
    channel: Schema.Literals(["user", "device"]),
  }),
  Schema.Struct({ _tag: Schema.Literal("CheckOut") }),
  Schema.Struct({
    _tag: Schema.Literal("CommandResult"),
    commandUUID: Schema.String,
    status: Schema.String,
    errorDetail: Schema.optional(Schema.String),
    queryResponses: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  Schema.Struct({
    _tag: Schema.Literal("DeclarationStatus"),
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
  Schema.Struct({ _tag: Schema.Literal("Idle") }),
  Schema.Struct({
    _tag: Schema.Literal("Command"),
    commandUUID: Schema.String,
    requestType: Schema.String,
    payload: Schema.Unknown,
  }),
  Schema.Struct({
    _tag: Schema.Literal("DdmSync"),
    serverToken: Schema.String,
  }),
]);
export type ManagementManifest = typeof ManagementManifest.Type;

export const DdmTokens = Schema.Struct({
  declarationsToken: Schema.String,
  activationsToken: Schema.String,
  configurationsToken: Schema.String,
  assetsToken: Schema.String,
  managementToken: Schema.String,
});
export type DdmTokens = typeof DdmTokens.Type;

const DdmDeclarationItem = Schema.Struct({
  identifier: Schema.String,
  serverToken: Schema.String,
});

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
    // Called on every MDM request to verify the device is enrolled and get its session
    readonly authenticateAppleDevice: (udid: string) => Effect.Effect<AppleDeviceSession, ManagementNotSupported | UnknownDevice | InternalServerError>;

    // Device lifecycle and protocol events
    readonly appleDeviceEvent: (deviceId: string, event: AppleDeviceEvent) => Effect.Effect<void, ManagementNotSupported | InternalServerError>;

    // Regular device checkin: returns what the device should do next (imperative)
    readonly appleManagementCheckin: (deviceId: string) => Effect.Effect<ManagementManifest, ManagementNotSupported | ServerInitiatedUnenrollment | InternalServerError>;

    // DDM sub-endpoint handlers
    readonly getAppleDeclarationTokens: (deviceId: string) => Effect.Effect<DdmTokens, ManagementNotSupported | InternalServerError>;
    readonly getAppleDeclarationItems: (deviceId: string) => Effect.Effect<DdmDeclarationItems, ManagementNotSupported | InternalServerError>;
    readonly getAppleDeclaration: (deviceId: string, type: string, identifier: string) => Effect.Effect<Record<string, unknown> | null, ManagementNotSupported | InternalServerError>;

    // Push info needed to wake the device via APNS
    readonly getApplePushInfo: (deviceId: string) => Effect.Effect<{ pushToken: string; pushMagic: string; topic: string } | null, ManagementNotSupported | InternalServerError>;

    // Queue a classic MDM command to be returned on next checkin
    readonly queueAppleCommand: (deviceId: string, requestType: string, payload: unknown) => Effect.Effect<void, ManagementNotSupported | InternalServerError>;
  }
>()("ManagementBackend") {}
