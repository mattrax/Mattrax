import { Layer } from "effect";
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { waitUntil } from "cloudflare:workers";
import { managementApi, managementWebhookHandlers } from "@mattrax/management-backend-http";
import { ManagementBackendMemory } from "./management.js";

const apiLayer = Layer.mergeAll(
  HttpApiBuilder.layer(managementApi, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(HttpApiBuilder.group(managementApi, "ManagementWebhook", managementWebhookHandlers)),
  ),
  HttpApiScalar.layerCdn(managementApi, { path: "/docs" }),
  HttpApiScalar.layerCdn(managementApi, { path: "/" }),
);

const appLayer = apiLayer.pipe(
  Layer.provideMerge(ManagementBackendMemory),
  Layer.provide(HttpServer.layerServices),
);

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { handler, dispose } = HttpRouter.toWebHandler(appLayer);
    const response = await handler(request);
    waitUntil(dispose().catch((cause) => console.error("Layer dispose failed", cause)));
    return response;
  },
} satisfies ExportedHandler<Env>;
