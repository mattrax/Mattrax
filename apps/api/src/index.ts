import { Layer } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiScalar, OpenApi } from "effect/unstable/httpapi";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { waitUntil } from "cloudflare:workers";
import { version } from "../package.json" with { type: "json" };
import { mattraxApi, mattraxHandlers } from "./backend";
import { appleMdmApi } from "./mdm/apple/domain";
import { appleMdmHandlers } from "./mdm/apple/backend";
import { ManagementBackendMemory } from "./webhook/memory";
import { createDb } from "./db";
import { AppleMdmRepositoryLive } from "./mdm/apple/repository";
import { AppleMdmServiceLive } from "./mdm/apple/service";
import { ScepServiceLive } from "./mdm/apple/scep/service";
import { ScepRepositoryLive } from "./mdm/apple/scep/repository";
import { extractTopicFromCertPem } from "./mdm/apple/cert";

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
    HttpApiScalar.layerCdn(apiRoot, { path: "/api/docs" }),
    HttpApiScalar.layerCdn(apiRoot, { path: "/" }),
  );

  const appleMdmServiceResolved = AppleMdmServiceLive({
    origin: env.ORIGIN,
    topic,
  }).pipe(
    Layer.provideMerge(ManagementBackendMemory),
    Layer.provideMerge(AppleMdmRepositoryLive(database)),
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
