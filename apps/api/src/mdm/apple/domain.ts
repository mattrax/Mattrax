import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import {
  AppleDevice,
  Declaration,
  CreateDeclarationInput,
} from "./schema";

export const appleMdmApi = HttpApiGroup.make("MattraxAppleMDM")
  // MDM Protocol endpoints
  .add(
    HttpApiEndpoint.get("enroll", "/enroll", {
      success: Schema.String,
    }),
  )
  .add(
    HttpApiEndpoint.get("scepGet", "/scep", {
      success: Schema.Uint8Array,
    }),
  )
  .add(
    HttpApiEndpoint.post("scepPost", "/scep", {
      payload: Schema.Uint8Array,
      success: Schema.Uint8Array,
    }),
  )
  .add(
    HttpApiEndpoint.put("mdm", "/mdm", {
      payload: Schema.Uint8Array,
      success: Schema.Uint8Array,
    }),
  )
  // Management API endpoints
  .add(
    HttpApiEndpoint.get("listDevices", "/devices", {
      success: Schema.Array(AppleDevice),
    }),
  )
  .add(
    HttpApiEndpoint.post("getDevice", "/devices/get", {
      payload: Schema.Struct({ id: Schema.String }),
      success: AppleDevice,
    }),
  )
  .add(
    HttpApiEndpoint.post("syncDevice", "/devices/sync", {
      payload: Schema.Struct({ id: Schema.String }),
      success: Schema.String,
    }),
  )
  .add(
    HttpApiEndpoint.post("collectDeviceInfo", "/devices/collect", {
      payload: Schema.Struct({ id: Schema.String, queries: Schema.Array(Schema.String) }),
      success: Schema.String,
    }),
  )
  .add(
    HttpApiEndpoint.post("createDeclaration", "/declarations", {
      payload: CreateDeclarationInput,
      success: Schema.String,
    }),
  )
  .add(
    HttpApiEndpoint.get("listDeclarations", "/declarations", {
      success: Schema.Array(Declaration),
    }),
  )
  .add(
    HttpApiEndpoint.post("deleteDeclaration", "/declarations/delete", {
      payload: Schema.Struct({ id: Schema.String }),
      success: Schema.String,
    }),
  )
  .add(
    HttpApiEndpoint.post("queueInstallProfile", "/commands/install-profile", {
      payload: Schema.Struct({ deviceId: Schema.String, profile: Schema.Unknown }),
      success: Schema.String,
    }),
  )
  .add(
    HttpApiEndpoint.post("queueInstallApplication", "/commands/install-application", {
      payload: Schema.Struct({ deviceId: Schema.String, app: Schema.Unknown }),
      success: Schema.String,
    }),
  )
  .prefix("/mdm/apple")
  .annotateMerge(OpenApi.annotations({ exclude: true }));
