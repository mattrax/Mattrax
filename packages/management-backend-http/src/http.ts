import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import {
  CheckinScope,
  AppleDeviceEvent,
  ManagementManifest,
  DdmTokens,
  DdmDeclarationItems,
  ManagementNotSupported,
  UnknownDevice,
  ServerInitiatedUnenrollment,
  InternalServerError,
} from "@mattrax/management-backend";

export const managementWebhookGroup = HttpApiGroup.make("ManagementWebhook")
  .add(
    HttpApiEndpoint.post("appleDeviceEvent", "/apple/event", {
      payload: Schema.Struct({ scope: CheckinScope, event: AppleDeviceEvent }),
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("appleManagementCheckin", "/apple/checkin", {
      payload: Schema.Struct({ scope: CheckinScope }),
      success: ManagementManifest,
      error: Schema.Union([ManagementNotSupported, UnknownDevice, ServerInitiatedUnenrollment, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleDeclarationTokens", "/apple/declaration-tokens", {
      payload: Schema.Struct({ scope: CheckinScope }),
      success: DdmTokens,
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleDeclarationItems", "/apple/declaration-items", {
      payload: Schema.Struct({ scope: CheckinScope }),
      success: DdmDeclarationItems,
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleDeclaration", "/apple/declaration", {
      payload: Schema.Struct({ scope: CheckinScope, type: Schema.String, identifier: Schema.String }),
      success: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .prefix("/webhook")
  .annotateMerge(OpenApi.annotations({ exclude: true }));

export const managementApi = HttpApi.make("ManagementApi").add(managementWebhookGroup);
