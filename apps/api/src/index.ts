import { Layer } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiScalar, OpenApi } from "effect/unstable/httpapi";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { waitUntil } from "cloudflare:workers";
import { version } from "../package.json" with { type: "json" };
import { mattraxApi } from "@mattrax/api-domain";
import { appleMdmApi } from "@mattrax/appledm";
import { mattraxHandlers, appleMdmHandlers, scepRoutes } from "@mattrax/api-backend";
import { AppleMdmServiceLive } from "@mattrax/appledm";
import { ApnsServiceLive } from "@mattrax/appledm";
import { ScepServiceLive } from "@mattrax/appledm";
import { extractTopicFromCertPem } from "@mattrax/appledm";
import { ManagementBackendMemory } from "./management/memory.js";
import { createDb } from "./db/index.js";
import { AppleMdmRepositoryLive } from "./repositories/appleMdmRepository.js";
import { ScepRepositoryLive } from "./repositories/scepRepository.js";

const apiRoot = HttpApi.make("Mattrax")
  .add(mattraxApi)
  .add(appleMdmApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "Mattrax Cloud API",
      version,
      description: "The API for the Mattrax Cloud. Used by the dashboard, CLI and custom integrations.",
      servers: [{ url: "/" }],
    }),
  );

export const createAppLayer = (db: D1Database, env: Env) => {
  const database = createDb(db);

  const topic = env.CLOUD_APPLE_VENDOR_CERT
    ? (extractTopicFromCertPem(env.CLOUD_APPLE_VENDOR_CERT) ?? "com.apple.mgmt.External.placeholder")
    : "com.apple.mgmt.External.placeholder";

  const handlersLayer = Layer.mergeAll(
    HttpApiBuilder.group(apiRoot, "MattraxApi", mattraxHandlers),
    HttpApiBuilder.group(apiRoot, "MattraxAppleMDM", appleMdmHandlers),
  );

  const apiLayer = Layer.mergeAll(
    HttpApiBuilder.layer(apiRoot, { openapiPath: "/api/openapi.json" }).pipe(
      Layer.provide(handlersLayer),
    ),
    scepRoutes,
    HttpApiScalar.layerCdn(apiRoot, { path: "/api/docs" }),
    HttpApiScalar.layerCdn(apiRoot, { path: "/" }),
  );

  const apnsServiceResolved = ApnsServiceLive(
    env.CLOUD_APPLE_VENDOR_CERT,
    env.CLOUD_APPLE_VENDOR_KEY,
  );

  const appleMdmServiceResolved = AppleMdmServiceLive({
    origin: env.ORIGIN,
    topic,
  }).pipe(
    Layer.provideMerge(ManagementBackendMemory),
    Layer.provideMerge(AppleMdmRepositoryLive(database)),
    Layer.provideMerge(apnsServiceResolved),
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
