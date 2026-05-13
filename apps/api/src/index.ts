import { Effect, Layer, Schema } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiScalar, OpenApi } from "effect/unstable/httpapi";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { env, waitUntil } from "cloudflare:workers";
import Stripe from "stripe";
import { version } from "../package.json" with { type: "json" };
import { enterpriseApi } from "@mattrax/enterprise-domain";
import { appleMdmApi } from "@mattrax/dm-apple";
import { enterpriseHandlers } from "@mattrax/enterprise-backend";
import { platformApi } from "@mattrax/platform-api";
import { platformHandlers } from "@mattrax/platform-backend";
import { appleMdmHandlers, appleMdmRoutes } from "@mattrax/dm-apple";
import { scepRoutes } from "@mattrax/scep";
import { AppleMdmServiceLive } from "@mattrax/dm-apple";
import { ScepServiceLive } from "@mattrax/scep";
import { extractTopicFromCertPem } from "@mattrax/dm-apple";
import { ManagementBackendEnterpriseLive } from "@mattrax/management-backend-enterprise";
import { createEffectDbLayer, Database } from "./db/index.js";
import * as schema from "./db/schema.js";
import { ScepRepositoryLive } from "./repositories/scepRepository.js";
import "./env.js";

const healthApi = HttpApiGroup.make("HealthApi").add(
  HttpApiEndpoint.get("health", "/health", {
    success: Schema.Struct({ status: Schema.Literal("ok") }),
  }),
).annotateMerge(OpenApi.annotations({ exclude: true }));

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

export const createAppLayer = (hyperdrive: Hyperdrive) => {
  const topic = env.CLOUD_APPLE_VENDOR_CERT
    ? (extractTopicFromCertPem(env.CLOUD_APPLE_VENDOR_CERT) ?? "com.apple.mgmt.External.placeholder")
    : "com.apple.mgmt.External.placeholder";

  const appLayer = Layer.unwrap(Effect.gen(function* () {
    const database = yield* Database;

    const handlersLayer = Layer.mergeAll(
      HttpApiBuilder.group(apiRoot, "EnterpriseApi", enterpriseHandlers({
        db: database,
        schema,
        origin: env.ORIGIN,
        stripeClient: new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2026-04-22.dahlia" }),
        storage: env.STORAGE,
      })),
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
    );

    const appleMdmServiceResolved = AppleMdmServiceLive({
      origin: env.ORIGIN,
      topic,
    }).pipe(
      Layer.provideMerge(ManagementBackendEnterpriseLive(database, { origin: env.ORIGIN, schema })),
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
    );
  }));

  return appLayer.pipe(
    Layer.provide(createEffectDbLayer(hyperdrive)),
    Layer.provide(HttpServer.layerServices),
  );
};

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const appLayer = createAppLayer(env.HYPERDRIVE);
    const { handler, dispose } = HttpRouter.toWebHandler(appLayer);
    const response = await (handler as (request: Request) => Promise<Response>)(request);
    waitUntil(dispose().catch((cause) => console.error("Layer dispose failed", cause)));
    return response;
  },
} satisfies ExportedHandler<Env>;
