import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";

export const platformApi = HttpApiGroup.make("PlatformApi")
  .add(
    HttpApiEndpoint.get("status", "/status", {
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .prefix("/api/platform")
  .annotateMerge(
    OpenApi.annotations({
      title: "Mattrax Platform API",
      description: "The services offered by Mattrax for licencing, MDM root certificates and more.",
    }),
  );
