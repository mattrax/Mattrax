import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

export const mattraxApi = HttpApiGroup.make("MattraxApi")
  .add(
    HttpApiEndpoint.get("health", "/health", {
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    })
  )
  .prefix("/api")
  .annotateMerge(OpenApi.annotations({ title: "Mattrax API", description: "Core Mattrax platform endpoints" }));
