import { Effect, Layer, Schema } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import { HttpServer } from "effect/http";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { appleMdmApi } from "@mattrax/dm-apple";
import { appleMdmHandlers, appleMdmRoutes } from "@mattrax/dm-apple";
import { windowsMdmRoutes, WindowsMdmServiceLive } from "@mattrax/dm-windows";
import { scepRoutes } from "@mattrax/scep";
import { AppleMdmConfig, AppleMdmService, AppleMdmTopic } from "@mattrax/dm-apple";
import { ScepService } from "@mattrax/scep";
import { ManagementBackendHttp } from "@mattrax/management-backend-http";
import { FsDb } from "./db.ts";
import { ScepRepositoryLive } from "./repositories/scepRepository.ts";

export interface ServerConfig {
  readonly origin: string;
  readonly webhookUrl: string;
  /** Optional HMAC secret used to sign management webhook requests. */
  readonly webhookSecret?: string;
  readonly dataDir: string;
  readonly appleVendorCert?: string;
  /** Shared with the management backend so SCEP challenges can be verified. */
  readonly authSecret?: string;
  /** White-label identity used in generated enrollment profiles. */
  readonly brandName?: string;
  readonly brandLogoUrl?: string;
  readonly supportEmail?: string;
  readonly brandColor?: string;
}

const DEFAULT_BRAND_COLOR = "#1c1917";

/**
 * A white-label frontend can render the same identity used in enrollment
 * profiles instead of hard-coding a product name.
 */
const brandingRoutes = (config: ServerConfig) =>
  HttpRouter.add("GET", "/branding.json", () =>
    Effect.succeed(
      HttpServerResponse.jsonUnsafe({
        displayName: config.brandName || "Mattrax",
        logo: config.brandLogoUrl || null,
        supportEmail: config.supportEmail || "hello@mattrax.app",
        brandColor: config.brandColor || DEFAULT_BRAND_COLOR,
      }),
    ),
  );

export const createAppLayer = (config: ServerConfig) => {
  const db = new FsDb(config.dataDir, { authSecret: config.authSecret });

  const healthApi = HttpApiGroup.make("HealthApi")
    .add(
      HttpApiEndpoint.get("health", "/health", {
        success: Schema.Struct({ status: Schema.Literal("ok") }),
      }),
    )
    .annotateMerge(OpenApi.annotations({ exclude: true }));

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
    windowsMdmRoutes,
    scepRoutes,
    brandingRoutes(config),
  );

  const appleMdmConfigLayer = AppleMdmConfig.layer({
    origin: config.origin,
    cloudAppleVendorCert: config.appleVendorCert,
    authSecret: config.authSecret,
    organizationId: "self-hosted",
    organizationName: config.brandName,
    supportEmail: config.supportEmail,
  });

  const appleMdmServiceResolved = AppleMdmService.layer.pipe(
    Layer.provideMerge(AppleMdmTopic.layer),
    Layer.provideMerge(appleMdmConfigLayer),
    Layer.provide(
      ManagementBackendHttp({ baseUrl: config.webhookUrl, secret: config.webhookSecret }),
    ),
  );

  const windowsMdmServiceResolved = WindowsMdmServiceLive({ origin: config.origin }).pipe(
    Layer.provide(
      ManagementBackendHttp({ baseUrl: config.webhookUrl, secret: config.webhookSecret }),
    ),
  );

  const scepServiceResolved = ScepService.pipe(
    Layer.provide(ScepRepositoryLive(db, { authSecret: config.authSecret })),
  );

  const allServicesLayer = Layer.mergeAll(
    appleMdmServiceResolved,
    windowsMdmServiceResolved,
    scepServiceResolved,
  );

  return apiLayer.pipe(
    Layer.provideMerge(allServicesLayer),
    Layer.provide(HttpServer.layerServices),
  );
};
