import { Effect, Layer } from "effect";
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";
import { HttpServer } from "effect/unstable/http";
import { apiRoot } from "../domain";

const mattraxApiLayer = HttpApiBuilder.group(apiRoot, "MattraxApi", (handlers) =>
  handlers.handle("health", () => Effect.succeed({ status: "ok" as const }))
);

const appleMdmApiLayer = HttpApiBuilder.group(apiRoot, "MattraxAppleMDM", (handlers) =>
  handlers.handle("checkin", () => Effect.void)
);

export const appLayerLive = Layer.mergeAll(
  HttpApiBuilder.layer(apiRoot, { openapiPath: "/api/openapi.json" }).pipe(
    Layer.provide(Layer.mergeAll(mattraxApiLayer, appleMdmApiLayer))
  ),
  HttpApiScalar.layerCdn(apiRoot, { path: "/api/docs" }),
  HttpApiScalar.layerCdn(apiRoot, { path: "/" }), // TODO: Remove this in future
).pipe(
  Layer.provide(HttpServer.layerServices)
);
