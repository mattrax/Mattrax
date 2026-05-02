import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

export const appleMdmApi = HttpApiGroup.make("MattraxAppleMDM")
  // MDM Protocol endpoints
  .add(
    HttpApiEndpoint.get("enroll", "/enroll", {
      success: Schema.String,
    }),
  )
  .prefix("/mdm/apple")
  .annotateMerge(OpenApi.annotations({ exclude: true }));
