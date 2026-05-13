import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

export const windowsMdmApi = HttpApiGroup.make("WindowsDM")
  .add(HttpApiEndpoint.post("discovery", "/discovery", { success: Schema.String }))
  .add(HttpApiEndpoint.post("policy", "/policy", { success: Schema.String }))
  .add(HttpApiEndpoint.post("enroll", "/enroll", { success: Schema.String }))
  .add(HttpApiEndpoint.post("management", "/management", { success: Schema.String }))
  .prefix("/mdm/windows")
  .annotateMerge(OpenApi.annotations({ exclude: true }));
