import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import { Schema } from "effect";
import { version } from "../../package.json" with { type: "json" };
import { appleMdmApi } from "../mdm/apple";

export const mattraxApi = HttpApiGroup.make("MattraxApi")
  .add(
    HttpApiEndpoint.get("health", "/health", {
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    })
  );

export const apiRoot = HttpApi.make("Mattrax")
  .add(mattraxApi.prefix("/api"))
  .add(appleMdmApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "Mattrax API",
      version,
      description: "Mattrax Web API",
      servers: [{ url: "/" }],
    }),
  );
