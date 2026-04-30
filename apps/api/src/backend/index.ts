import { Effect, Layer } from "effect";
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";
import { HttpServer } from "effect/unstable/http";
import { apiRoot } from "../domain";
import { appleMdmApiLayer } from "../mdm/apple/backend";

const mattraxApiLayer = HttpApiBuilder.group(apiRoot, "MattraxApi", (handlers) =>
  handlers.handle("health", () => Effect.succeed({ status: "ok" as const }))
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
