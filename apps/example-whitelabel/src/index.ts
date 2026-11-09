import { Context, Layer } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiScalar } from "effect/http-api";
import { HttpRouter, HttpServer } from "effect/http";
import {
  AppleMdmConfig,
  AppleMdmService,
  AppleMdmTopic,
  appleMdmApi,
  appleMdmHandlers,
  appleMdmRoutes,
} from "@mattrax/dm-apple";
import { ScepService, scepRoutes } from "@mattrax/scep";
import {
  managementWebhookGroup,
  managementWebhookHandlers,
} from "@mattrax/management-backend-http";
import { ManagementBackendD1 } from "./management.js";
import { ScepRepositoryD1 } from "./scep-repo.js";
import { handleApi } from "./api.js";

const whitelabelApi = HttpApi.make("WhitelabelMDM").add(managementWebhookGroup).add(appleMdmApi);

function createMdmLayer(env: Env) {
  const managementBackend = ManagementBackendD1(env.DB, env.APPS);

  const apiLayer = Layer.mergeAll(
    HttpApiBuilder.layer(whitelabelApi, { openapiPath: "/openapi.json" }).pipe(
      Layer.provide(
        Layer.mergeAll(
          HttpApiBuilder.group(whitelabelApi, "ManagementWebhook", (handlers) =>
            managementWebhookHandlers(handlers, {
              secret: (env as unknown as { WEBHOOK_SECRET?: string }).WEBHOOK_SECRET,
            }),
          ),
          HttpApiBuilder.group(whitelabelApi, "AppleDM", appleMdmHandlers),
        ),
      ),
    ),
    HttpApiScalar.layerCdn(whitelabelApi, { path: "/docs" }),
    appleMdmRoutes,
    scepRoutes,
  );

  const appleMdmConfigLayer = AppleMdmConfig.layer({
    origin: env.ORIGIN,
    cloudAppleVendorCert: env.APNS_CERT,
    authSecret: (env as unknown as { AUTH_SECRET?: string }).AUTH_SECRET,
  });

  const appleMdmService = AppleMdmService.layer.pipe(
    Layer.provideMerge(AppleMdmTopic.layer),
    Layer.provideMerge(appleMdmConfigLayer),
    Layer.provideMerge(managementBackend),
  );

  const scepService = ScepService.pipe(
    Layer.provideMerge(
      ScepRepositoryD1(env.DB, {
        authSecret: (env as unknown as { AUTH_SECRET?: string }).AUTH_SECRET,
      }),
    ),
  );

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
      const response = await handler(request, Context.empty() as any);
      ctx.waitUntil(dispose().catch((cause) => console.error("Layer dispose failed", cause)));
      return response;
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
