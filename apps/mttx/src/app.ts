import { Effect, Layer, Schema } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import { HttpServer } from "effect/unstable/http";
import { appleMdmApi } from "@mattrax/dm-apple";
import { appleMdmHandlers, appleMdmRoutes } from "@mattrax/dm-apple";
import { scepRoutes } from "@mattrax/scep";
import { AppleMdmService, AppleMdmTopic } from "@mattrax/dm-apple";
import { ScepServiceLive } from "@mattrax/scep";
import { Env as CoreEnv } from "@mattrax/enterprise-core";
import { ManagementBackendHttp } from "@mattrax/management-backend-http";
import { FsDb } from "./db.ts";
import { ScepRepositoryLive } from "./repositories/scepRepository.ts";

export interface ServerConfig {
  readonly origin: string;
  readonly webhookUrl: string;
  readonly dataDir: string;
  readonly appleVendorCert?: string;
}

export const createAppLayer = (config: ServerConfig) => {
  const db = new FsDb(config.dataDir);

  const healthApi = HttpApiGroup.make("HealthApi").add(
    HttpApiEndpoint.get("health", "/health", {
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  ).annotateMerge(OpenApi.annotations({ exclude: true }));

  const apiRoot = HttpApi.make("Mattrax")
    .add(appleMdmApi)
    .add(healthApi)
    .annotateMerge(
      OpenApi.annotations({
        title: "Mattrax Self-Hosted API",
        version: "0.0.0",
        description: "Self-hosted Mattrax API for running on your own infrastructure.",
        servers: [{ url: "/" }],
      }),
    );

  const handlersLayer = Layer.mergeAll(
    HttpApiBuilder.group(apiRoot, "AppleDM", appleMdmHandlers),
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
  );

  const coreEnvLayer = CoreEnv.layer({ origin: config.origin, cloudAppleVendorCert: config.appleVendorCert });

  const appleMdmServiceResolved = AppleMdmService.layer.pipe(
    Layer.provideMerge(AppleMdmTopic.layer),
    Layer.provideMerge(coreEnvLayer),
    Layer.provide(ManagementBackendHttp(config.webhookUrl)),
  );

  const scepServiceResolved = ScepServiceLive.pipe(
    Layer.provide(ScepRepositoryLive(db)),
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
