import { Effect, Layer } from "effect";
import { HttpApi, HttpApiBuilder, OpenApi } from "effect/unstable/httpapi";
import { HttpServer, HttpServerResponse, HttpRouter } from "effect/unstable/http";
import { enterpriseApi } from "@mattrax/api-domain";
import { appleMdmApi } from "@mattrax/dm-apple";
import { enterpriseHandlers } from "@mattrax/api-backend";
import { appleMdmHandlers, appleMdmRoutes } from "@mattrax/dm-apple";
import { scepRoutes } from "@mattrax/scep";
import { AppleMdmServiceLive } from "@mattrax/dm-apple";
import { ScepServiceLive } from "@mattrax/scep";
import { extractTopicFromCertPem } from "@mattrax/dm-apple";
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

  const topic = config.appleVendorCert
    ? (extractTopicFromCertPem(config.appleVendorCert) ?? "com.apple.mgmt.External.placeholder")
    : "com.apple.mgmt.External.placeholder";

  const apiRoot = HttpApi.make("Mattrax")
    .add(enterpriseApi)
    .add(appleMdmApi)
    .annotateMerge(
      OpenApi.annotations({
        title: "Mattrax Self-Hosted API",
        version: "0.0.0",
        description: "Self-hosted Mattrax API for running on your own infrastructure.",
        servers: [{ url: "/" }],
      }),
    );

  const handlersLayer = Layer.mergeAll(
    HttpApiBuilder.group(apiRoot, "EnterpriseApi", enterpriseHandlers),
    HttpApiBuilder.group(apiRoot, "AppleDM", appleMdmHandlers),
  );

  const apiLayer = Layer.mergeAll(
    HttpApiBuilder.layer(apiRoot, { openapiPath: "/api/openapi.json" }).pipe(
      Layer.provide(handlersLayer),
    ),
    appleMdmRoutes,
    scepRoutes,
    HttpRouter.add("GET", "/", () => Effect.succeed(HttpServerResponse.text("Mattrax Server"))),
  );

  const appleMdmServiceResolved = AppleMdmServiceLive({
    origin: config.origin,
    topic,
  }).pipe(
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
