import { Context, Layer } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { AppleMdmServiceLive, appleMdmApi, appleMdmHandlers, appleMdmRoutes, extractTopicFromCertPem } from "@mattrax/dm-apple";
import { ScepServiceLive, scepRoutes } from "@mattrax/scep";
import { managementWebhookGroup, managementWebhookHandlers } from "@mattrax/management-backend-http";
import { ManagementBackendD1 } from "./management.js";
import { ScepRepositoryD1 } from "./scep-repo.js";
import { handleApi } from "./api.js";

const whitelabelApi = HttpApi.make("WhitelabelMDM")
  .add(managementWebhookGroup)
  .add(appleMdmApi);

function createMdmLayer(env: Env) {
  const topic = env.APNS_CERT
    ? (extractTopicFromCertPem(env.APNS_CERT) ?? "com.apple.mgmt.External.placeholder")
    : "com.apple.mgmt.External.placeholder";

  const managementBackend = ManagementBackendD1(env.DB, env.APPS);

  const apiLayer = Layer.mergeAll(
    HttpApiBuilder.layer(whitelabelApi, { openapiPath: "/openapi.json" }).pipe(
      Layer.provide(
        Layer.mergeAll(
          HttpApiBuilder.group(whitelabelApi, "ManagementWebhook", managementWebhookHandlers),
          HttpApiBuilder.group(whitelabelApi, "AppleDM", appleMdmHandlers),
        ),
      ),
    ),
    HttpApiScalar.layerCdn(whitelabelApi, { path: "/docs" }),
    appleMdmRoutes,
    scepRoutes,
  );

  const appleMdmService = AppleMdmServiceLive({ origin: env.ORIGIN, topic }).pipe(
    Layer.provideMerge(managementBackend),
  );

  const scepService = ScepServiceLive.pipe(Layer.provideMerge(ScepRepositoryD1(env.DB)));

  return apiLayer.pipe(
    Layer.provideMerge(Layer.mergeAll(appleMdmService, scepService, managementBackend)),
    Layer.provide(HttpServer.layerServices),
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, ctx);
    }

    if (
      url.pathname.startsWith("/mdm/") ||
      url.pathname.startsWith("/webhook/") ||
      url.pathname.startsWith("/docs") ||
      url.pathname === "/openapi.json"
    ) {
      const mdmLayer = createMdmLayer(env);
      const { handler, dispose } = HttpRouter.toWebHandler(mdmLayer);
      const response = await handler(request, Context.empty());
      ctx.waitUntil(dispose().catch((cause) => console.error("Layer dispose failed", cause)));
      return response;
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
