import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

export const appleMdmApi = HttpApiGroup.make("MattraxAppleMDM")
  // MDM Protocol endpoints
  .add(
    HttpApiEndpoint.get("enroll", "/enroll", {
      success: Schema.String,
    }),
  )
  // Classic MDM command queue endpoints. DCM/DDM policy is sourced from ManagementBackend.
  .add(
    HttpApiEndpoint.post("collectDeviceInfo", "/devices/collect", {
      payload: Schema.Struct({ id: Schema.String, queries: Schema.Array(Schema.String) }),
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
