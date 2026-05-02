import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import {
  AppleDeviceSession,
  AppleDeviceEvent,
  ManagementManifest,
  DdmTokens,
  DdmDeclarationItems,
} from "./layer.js";

export class ManagementNotSupportedError extends Schema.TaggedErrorClass<ManagementNotSupportedError>()(
  "ManagementNotSupported",
  {},
) {}

export const managementWebhookGroup = HttpApiGroup.make("ManagementWebhook")
  .add(
    HttpApiEndpoint.post("authenticateAppleDevice", "/apple/authenticate", {
      payload: Schema.Struct({ udid: Schema.String }),
      success: AppleDeviceSession,
      error: ManagementNotSupportedError,
    }),
  )
  .add(
    HttpApiEndpoint.post("appleDeviceEvent", "/apple/event", {
      payload: Schema.Struct({ deviceId: Schema.String, event: AppleDeviceEvent }),
      error: ManagementNotSupportedError,
    }),
  )
  .add(
    HttpApiEndpoint.post("appleManagementCheckin", "/apple/checkin", {
      payload: Schema.Struct({ deviceId: Schema.String }),
      success: ManagementManifest,
      error: ManagementNotSupportedError,
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleDeclarationTokens", "/apple/declaration-tokens", {
      payload: Schema.Struct({ deviceId: Schema.String }),
      success: DdmTokens,
      error: ManagementNotSupportedError,
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleDeclarationItems", "/apple/declaration-items", {
      payload: Schema.Struct({ deviceId: Schema.String }),
      success: DdmDeclarationItems,
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
    HttpApiEndpoint.post("getApplePushInfo", "/apple/push-info", {
      payload: Schema.Struct({ deviceId: Schema.String }),
      success: Schema.NullOr(Schema.Struct({
        pushToken: Schema.String,
        pushMagic: Schema.String,
        topic: Schema.String,
      })),
      error: ManagementNotSupportedError,
    }),
  )
  .add(
    HttpApiEndpoint.post("queueAppleCommand", "/apple/queue-command", {
      payload: Schema.Struct({
        deviceId: Schema.String,
        requestType: Schema.String,
        payload: Schema.Unknown,
      }),
      error: ManagementNotSupportedError,
    }),
  )
  .prefix("/webhook")
  .annotateMerge(OpenApi.annotations({ exclude: true }));

export const managementApi = HttpApi.make("ManagementApi").add(managementWebhookGroup);
