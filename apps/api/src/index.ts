import { Context, Layer, Redacted } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiScalar, OpenApi } from "effect/unstable/httpapi";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/unstable/http";
import { waitUntil } from "cloudflare:workers";
import { version } from "../package.json" with { type: "json" };
import { enterpriseApi } from "@mattrax/enterprise-domain";
import { appleMdmApi } from "@mattrax/dm-apple";
import { EnterpriseAuthLive, EnterpriseServiceLive, enterpriseHandlers } from "@mattrax/enterprise-backend";
import { platformApi } from "@mattrax/platform-api";
import { platformHandlers } from "@mattrax/platform-backend";
import { appleMdmHandlers, appleMdmRoutes } from "@mattrax/dm-apple";
import { scepRoutes } from "@mattrax/scep";
import { AppleMdmService, AppleMdmTopic } from "@mattrax/dm-apple";
import { ScepServiceLive } from "@mattrax/scep";
import { ManagementBackendEnterpriseLive, ScepRepositoryLive } from "@mattrax/management-backend-enterprise";
import { Db, Env as CoreEnv, R2 } from "@mattrax/enterprise-core";
import { PgClient } from "@effect/sql-pg";
import { StripeService } from "@mattrax/effect-stripe";
import "./env.js";

const apiRoot = HttpApi.make("Mattrax")
  .add(enterpriseApi)
  .add(appleMdmApi)
  .add(platformApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "Mattrax Cloud API",
      version,
      description: "The Mattrax Cloud API",
      servers: [{ url: "/" }],
    }),
  );

const handlersLayer = Layer.mergeAll(
  HttpApiBuilder.group(apiRoot, "EnterpriseApi", enterpriseHandlers),
  HttpApiBuilder.group(apiRoot, "AppleDM", appleMdmHandlers),
  HttpApiBuilder.group(apiRoot, "PlatformApi", platformHandlers),
  HttpRouter.add(
   "GET",
   "/health",
   HttpServerResponse.text("ok")
 ),
);

const apiLayer = Layer.mergeAll(
  HttpApiBuilder.layer(apiRoot, { openapiPath: "/api/openapi.json" }).pipe(
    Layer.provide(handlersLayer),
  ),
  HttpApiScalar.layerCdn(apiRoot, { path: "/api/docs" }),
  appleMdmRoutes,
  scepRoutes,
);

const appLayer = apiLayer.pipe(
  Layer.provide(HttpServer.layerServices),
  Layer.provide(Db.layer),
);

const staticEnvLayer = CoreEnv.layer({
  origin: env.ORIGIN,
  cloudAppleVendorCert: env.CLOUD_APPLE_VENDOR_CERT,
});

const servicesLayer = Layer.mergeAll(
  EnterpriseServiceLive.pipe(
    Layer.provideMerge(EnterpriseAuthLive),
    Layer.provideMerge(staticEnvLayer),
    Layer.provideMerge(StripeService.layer(env.STRIPE_SECRET_KEY)),
  ),
  AppleMdmService.layer.pipe(
    Layer.provideMerge(AppleMdmTopic.layer),
    Layer.provideMerge(ManagementBackendEnterpriseLive.layer(env.ORIGIN)),
    Layer.provideMerge(staticEnvLayer),
  ),
  ScepServiceLive.pipe(
    Layer.provideMerge(ScepRepositoryLive.layer),
  ),
  R2.layer(env.STORAGE),
);

const appLayer2 = appLayer.pipe(
  Layer.provideMerge(servicesLayer),
  Layer.provide(PgClient.layer({
    url: Redacted.make(env.HYPERDRIVE.connectionString),
  })),
);

export default {
  async fetch(request: Request, _: Env, _ctx: ExecutionContext): Promise<Response> {
    const { handler, dispose } = HttpRouter.toWebHandler(appLayer2);
    const response = await handler(request, Context.empty());
    waitUntil(dispose().catch((cause) => console.error("Layer dispose failed", cause)));
    return response;
  },
} satisfies ExportedHandler<Env>;
