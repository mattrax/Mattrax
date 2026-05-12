import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

export const enterpriseApi = HttpApiGroup.make("EnterpriseApi")
  .add(
    HttpApiEndpoint.get("status", "/status", {
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .prefix("/api")
  .annotateMerge(OpenApi.annotations({ title: "Mattrax Enterprise API", description: "Mattrax management API which allows you to manage your devices." }));
