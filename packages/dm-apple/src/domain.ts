import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";

export const appleMdmApi = HttpApiGroup.make("AppleDM")
  // MDM Protocol endpoints
  .add(
    HttpApiEndpoint.get("enroll", "/enroll", {
      success: Schema.String,
    }),
  )
  .prefix("/mdm/apple")
  .annotateMerge(OpenApi.annotations({ exclude: true }));
