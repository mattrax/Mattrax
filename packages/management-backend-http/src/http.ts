import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
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
  WindowsDeviceEvent,
  WindowsDiscoveryRequest,
  WindowsDiscoveryResponse,
  WindowsEnrollmentPolicy,
  WindowsEnrollmentRequest,
  WindowsEnrollmentResult,
  WindowsManagementRequest,
  WindowsManagementResponse,
  WindowsManagementScope,
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
      error: Schema.Union([
        ManagementNotSupported,
        UnknownDevice,
        ServerInitiatedUnenrollment,
        InternalServerError,
      ]),
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleBootstrapToken", "/apple/bootstrap-token", {
      payload: Schema.Struct({ scope: CheckinScope }),
      success: Schema.NullOr(Schema.String),
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
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
      payload: Schema.Struct({
        scope: CheckinScope,
        type: Schema.String,
        identifier: Schema.String,
      }),
      success: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleAsset", "/apple/asset", {
      payload: Schema.Struct({
        identityCertificate: Schema.optional(Schema.String),
        identifier: Schema.String,
        token: Schema.optional(Schema.String),
      }),
      success: Schema.NullOr(
        Schema.Struct({
          content: Schema.Uint8ArrayFromBase64,
          contentType: Schema.String,
        }),
      ),
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleProfile", "/apple/profile", {
      payload: Schema.Struct({
        policyId: Schema.String,
        kind: Schema.String,
      }),
      success: Schema.NullOr(
        Schema.Struct({
          content: Schema.Uint8ArrayFromBase64,
          contentType: Schema.String,
        }),
      ),
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("windowsDiscovery", "/windows/discovery", {
      payload: WindowsDiscoveryRequest,
      success: WindowsDiscoveryResponse,
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("getWindowsEnrollmentPolicy", "/windows/policy", {
      payload: Schema.Struct({
        authToken: Schema.String,
        tenantToken: Schema.optional(Schema.String),
      }),
      success: WindowsEnrollmentPolicy,
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("windowsEnroll", "/windows/enroll", {
      payload: WindowsEnrollmentRequest,
      success: WindowsEnrollmentResult,
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("windowsManagementCheckin", "/windows/checkin", {
      payload: Schema.Struct({ scope: WindowsManagementScope, request: WindowsManagementRequest }),
      success: WindowsManagementResponse,
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("windowsDeviceEvent", "/windows/event", {
      payload: Schema.Struct({ scope: WindowsManagementScope, event: WindowsDeviceEvent }),
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .prefix("/webhook")
  .annotateMerge(OpenApi.annotations({ exclude: true }));

export const managementApi = HttpApi.make("ManagementApi").add(managementWebhookGroup);
