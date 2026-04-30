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
