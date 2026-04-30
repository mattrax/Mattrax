import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

export const appleMdmApi = HttpApiGroup.make("MattraxAppleMDM")
  .add(HttpApiEndpoint.post("checkin", "/"))
  .prefix("/mdm/apple")
  .annotateMerge(OpenApi.annotations({ exclude: true }));
