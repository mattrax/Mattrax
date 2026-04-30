import { Layer } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiScalar, OpenApi } from "effect/unstable/httpapi";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http";
import { waitUntil } from "cloudflare:workers";
import { version } from "../package.json" with { type: "json" };
import { mattraxApi, mattraxHandlers } from "./backend";
import { appleMdmApi } from "./mdm/apple/domain";
import { appleMdmHandlers } from "./mdm/apple/backend";
import { ManagementBackendHttp } from "./webhook/http";
import { ManagementBackendMemory } from "./webhook/memory";

const apiRoot = HttpApi.make("Mattrax")
  .add(mattraxApi)
  .add(appleMdmApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "Mattrax API",
      version,
      description: "Mattrax Web API",
      servers: [{ url: "/" }],
    }),
  );

const appLayerLive = Layer.mergeAll(
  HttpApiBuilder.layer(apiRoot, { openapiPath: "/api/openapi.json" }).pipe(
    Layer.provide(
      Layer.mergeAll(
        HttpApiBuilder.group(apiRoot, "MattraxApi", mattraxHandlers),
        HttpApiBuilder.group(apiRoot, "MattraxAppleMDM", appleMdmHandlers),
      ),
    ),
  ),
  HttpApiScalar.layerCdn(apiRoot, { path: "/api/docs" }),
  HttpApiScalar.layerCdn(apiRoot, { path: "/" }), // TODO: Remove this in future
  ManagementBackendMemory,
  // ManagementBackendHttp("https://webhook.site/31a1005d-ea6f-432d-b1fe-edeeb507b833").pipe(
  //   Layer.provide(FetchHttpClient.layer),
  // ),
).pipe(Layer.provide(HttpServer.layerServices));

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { handler, dispose } = HttpRouter.toWebHandler(appLayerLive);
    const response = await handler(request);
    waitUntil(dispose().catch((cause) => console.error("OTEL shutdown failed", cause)));
    return response;
  },
} satisfies ExportedHandler<Env>;
