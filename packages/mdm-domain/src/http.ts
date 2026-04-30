import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

export class ManagementNotSupportedError extends Schema.TaggedErrorClass<ManagementNotSupportedError>()(
  "ManagementNotSupported",
  {},
) {}

export const DeviceInfoPayload = Schema.Struct({
  udid: Schema.String,
  serialNumber: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  osVersion: Schema.optional(Schema.String),
});

export const AppleEnrollmentUpdatePayload = Schema.Struct({
  udid: Schema.String,
  serialNumber: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  osVersion: Schema.optional(Schema.String),
  pushMagic: Schema.String,
  pushToken: Schema.String,
  topic: Schema.String,
  channel: Schema.Literals(["device", "user"]),
  supportsDdm: Schema.Boolean,
});

export const AppleDeviceSessionPayload = Schema.Struct({
  deviceId: Schema.String,
  udid: Schema.String,
  supportsDdm: Schema.Boolean,
  dcmEnabled: Schema.Boolean,
});

export const AppleDeclarationItemPayload = Schema.Struct({
  identifier: Schema.String,
  type: Schema.Literals(["activation", "configuration", "asset", "management"]),
  serverToken: Schema.String,
});

export const AppleDeclarationManifestPayload = Schema.Struct({
  token: Schema.optional(Schema.String),
  declarations: Schema.Array(AppleDeclarationItemPayload),
});

export const CommandResultPayload = Schema.Struct({
  commandUuid: Schema.String,
  deviceId: Schema.String,
  status: Schema.String,
  detail: Schema.optional(Schema.String),
});

export const DeclarationStatusPayload = Schema.Struct({
  deviceId: Schema.String,
  declarationId: Schema.String,
  status: Schema.String,
  detail: Schema.optional(Schema.String),
});

export const CollectedDeviceInfoPayload = Schema.Struct({
  deviceId: Schema.String,
  queries: Schema.Record(Schema.String, Schema.Unknown),
});

export const managementWebhookGroup = HttpApiGroup.make("ManagementWebhook")
  .add(
    HttpApiEndpoint.post("appleCheckin", "/apple/checkin", {
      payload: Schema.Struct({ deviceId: Schema.String }),
      error: ManagementNotSupportedError,
    }),
  )
  .add(
    HttpApiEndpoint.post("authenticateAppleDevice", "/apple/authenticate", {
      payload: DeviceInfoPayload,
      success: AppleDeviceSessionPayload,
      error: ManagementNotSupportedError,
    }),
  )
  .add(
    HttpApiEndpoint.post("updateAppleEnrollment", "/apple/enrollment", {
      payload: AppleEnrollmentUpdatePayload,
      success: AppleDeviceSessionPayload,
      error: ManagementNotSupportedError,
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleDeviceByUdid", "/apple/device-by-udid", {
      payload: Schema.Struct({ udid: Schema.String }),
      success: Schema.NullOr(AppleDeviceSessionPayload),
      error: ManagementNotSupportedError,
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleDeclarationManifest", "/apple/declaration-manifest", {
      payload: Schema.Struct({ deviceId: Schema.String }),
      success: AppleDeclarationManifestPayload,
      error: ManagementNotSupportedError,
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleDeclaration", "/apple/declaration", {
      payload: Schema.Struct({ deviceId: Schema.String, type: Schema.String, identifier: Schema.String }),
      success: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
      error: ManagementNotSupportedError,
    }),
  )
  .add(
    HttpApiEndpoint.post("reportDeviceEnrolled", "/apple/enrolled", {
      payload: Schema.Struct({ deviceId: Schema.String, info: DeviceInfoPayload }),
      error: ManagementNotSupportedError,
    }),
  )
  .add(
    HttpApiEndpoint.post("reportCommandResult", "/apple/command-result", {
      payload: Schema.Struct({ deviceId: Schema.String, result: CommandResultPayload }),
      error: ManagementNotSupportedError,
    }),
  )
  .add(
    HttpApiEndpoint.post("reportDeclarationStatus", "/apple/declaration-status", {
      payload: Schema.Struct({ deviceId: Schema.String, status: DeclarationStatusPayload }),
      error: ManagementNotSupportedError,
    }),
  )
  .add(
    HttpApiEndpoint.post("reportDeviceInfo", "/apple/device-info", {
      payload: Schema.Struct({ deviceId: Schema.String, info: CollectedDeviceInfoPayload }),
      error: ManagementNotSupportedError,
    }),
  )
  .prefix("/webhook")
  .annotateMerge(OpenApi.annotations({ exclude: true }));

export const managementApi = HttpApi.make("ManagementApi").add(managementWebhookGroup);
