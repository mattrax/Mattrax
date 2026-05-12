import { Effect, Layer, Schema } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiScalar, OpenApi } from "effect/unstable/httpapi";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { waitUntil } from "cloudflare:workers";
import { version } from "../package.json" with { type: "json" };
import { enterpriseApi } from "@mattrax/api-domain";
import { appleMdmApi } from "@mattrax/dm-apple";
import { enterpriseHandlers } from "@mattrax/api-backend";
import { platformApi } from "@mattrax/platform-api";
import { platformHandlers } from "@mattrax/platform-backend";
import { appleMdmHandlers, appleMdmRoutes } from "@mattrax/dm-apple";
import { scepRoutes } from "@mattrax/scep";
import { AppleMdmServiceLive } from "@mattrax/dm-apple";
import { ScepServiceLive } from "@mattrax/scep";
import { extractTopicFromCertPem } from "@mattrax/dm-apple";
import { ManagementBackendMemory } from "./management/memory.js";
import { createDb } from "./db/index.js";
import { ScepRepositoryLive } from "./repositories/scepRepository.js";

const healthApi = HttpApiGroup.make("HealthApi").add(
  HttpApiEndpoint.get("health", "/health", {
    success: Schema.Struct({ status: Schema.Literal("ok") }),
  }),
);

const apiRoot = HttpApi.make("Mattrax")
  .add(enterpriseApi)
  .add(appleMdmApi)
  .add(platformApi)
  .add(healthApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "Mattrax Cloud API",
      version,
      description: "The Mattrax Cloud API",
      servers: [{ url: "/" }],
    }),
  );

export const createAppLayer = (db: D1Database, env: Env) => {
  const database = createDb(db);

  const topic = env.CLOUD_APPLE_VENDOR_CERT
    ? (extractTopicFromCertPem(env.CLOUD_APPLE_VENDOR_CERT) ?? "com.apple.mgmt.External.placeholder")
    : "com.apple.mgmt.External.placeholder";

  const handlersLayer = Layer.mergeAll(
    HttpApiBuilder.group(apiRoot, "EnterpriseApi", enterpriseHandlers),
    HttpApiBuilder.group(apiRoot, "AppleDM", appleMdmHandlers),
    HttpApiBuilder.group(apiRoot, "PlatformApi", platformHandlers),
    HttpApiBuilder.group(apiRoot, "HealthApi", (handlers) =>
      handlers.handle("health", () => Effect.succeed({ status: "ok" as const })),
    ),
  );

  const apiLayer = Layer.mergeAll(
    HttpApiBuilder.layer(apiRoot, { openapiPath: "/api/openapi.json" }).pipe(
      Layer.provide(handlersLayer),
    ),
    appleMdmRoutes,
    scepRoutes,
    HttpApiScalar.layerCdn(apiRoot, { path: "/api/docs" }),
    HttpApiScalar.layerCdn(apiRoot, { path: "/" }),
  );

  const appleMdmServiceResolved = AppleMdmServiceLive({
    origin: env.ORIGIN,
    topic,
  }).pipe(
    Layer.provideMerge(ManagementBackendMemory),
  );

  const scepServiceResolved = ScepServiceLive.pipe(
    Layer.provideMerge(ScepRepositoryLive(database)),
  );

  const allServicesLayer = Layer.mergeAll(
    appleMdmServiceResolved,
    scepServiceResolved,
  );

  return apiLayer.pipe(
    Layer.provideMerge(allServicesLayer),
    Layer.provide(HttpServer.layerServices),
  );
};

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const db = env.DB;
    const appLayer = createAppLayer(db, env);
    const { handler, dispose } = HttpRouter.toWebHandler(appLayer);
    const response = await handler(request);
    waitUntil(dispose().catch((cause) => console.error("Layer dispose failed", cause)));
    return response;
  },
} satisfies ExportedHandler<Env>;
