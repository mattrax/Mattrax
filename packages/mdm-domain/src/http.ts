import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import {
  AppleDeviceSession,
  AppleDeviceEvent,
  ManagementManifest,
  DdmTokens,
  DdmDeclarationItems,
  ManagementNotSupported,
} from "./layer.js";

export const managementWebhookGroup = HttpApiGroup.make("ManagementWebhook")
  .add(
    HttpApiEndpoint.post("authenticateAppleDevice", "/apple/authenticate", {
      payload: Schema.Struct({ udid: Schema.String }),
      success: AppleDeviceSession,
      error: ManagementNotSupported,
    }),
  )
  .add(
    HttpApiEndpoint.post("appleDeviceEvent", "/apple/event", {
      payload: Schema.Struct({ deviceId: Schema.String, event: AppleDeviceEvent }),
      error: ManagementNotSupported,
    }),
  )
  .add(
    HttpApiEndpoint.post("appleManagementCheckin", "/apple/checkin", {
      payload: Schema.Struct({ deviceId: Schema.String }),
      success: ManagementManifest,
      error: ManagementNotSupported,
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleDeclarationTokens", "/apple/declaration-tokens", {
      payload: Schema.Struct({ deviceId: Schema.String }),
      success: DdmTokens,
      error: ManagementNotSupported,
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleDeclarationItems", "/apple/declaration-items", {
      payload: Schema.Struct({ deviceId: Schema.String }),
      success: DdmDeclarationItems,
      error: ManagementNotSupported,
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleDeclaration", "/apple/declaration", {
      payload: Schema.Struct({ deviceId: Schema.String, type: Schema.String, identifier: Schema.String }),
      success: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
      error: ManagementNotSupported,
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
      error: ManagementNotSupported,
    }),
  )
  .add(
    HttpApiEndpoint.post("queueAppleCommand", "/apple/queue-command", {
      payload: Schema.Struct({
        deviceId: Schema.String,
        requestType: Schema.String,
        payload: Schema.Unknown,
      }),
      error: ManagementNotSupported,
    }),
  )
  .prefix("/webhook")
  .annotateMerge(OpenApi.annotations({ exclude: true }));

export const managementApi = HttpApi.make("ManagementApi").add(managementWebhookGroup);
