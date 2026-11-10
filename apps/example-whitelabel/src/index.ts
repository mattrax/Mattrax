import { Context, Effect, Layer } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiScalar } from "effect/http-api";
import { HttpRouter, HttpServer } from "effect/http";
import {
  AppleMdmConfig,
  AppleMdmService,
  AppleMdmTopic,
  appleMdmApi,
  appleMdmHandlers,
  appleMdmRoutes,
  buildAppleEnrollmentProfile,
  extractTopicFromCertPem,
} from "@mattrax/dm-apple";
import { WindowsMdmServiceLive, windowsMdmRoutes } from "@mattrax/dm-windows";
import { ScepService, createScepChallenge, scepRoutes } from "@mattrax/scep";
import { serializePlist } from "@mattrax/plist";
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
    windowsMdmRoutes,
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

  const windowsMdmService = WindowsMdmServiceLive({ origin: env.ORIGIN }).pipe(
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
    Layer.provideMerge(
      Layer.mergeAll(appleMdmService, windowsMdmService, scepService, managementBackend),
    ),
    Layer.provide(HttpServer.layerServices),
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, ctx);
    }

    // The tenant-scoped Cloud worker refuses this endpoint because it cannot
    // mint a bound challenge. A single-tenant whitelabel deployment can serve
    // a fully-formed profile itself.
    if (url.pathname === "/mdm/apple/enroll" && request.method === "GET") {
      const authSecret = (env as unknown as { AUTH_SECRET?: string }).AUTH_SECRET;
      const topic = env.APNS_CERT ? extractTopicFromCertPem(env.APNS_CERT) : null;
      if (!env.ORIGIN || !topic || !authSecret)
        return new Response("Apple MDM enrollment is not configured", { status: 503 });
      const challenge = await createScepChallenge(crypto.randomUUID(), authSecret);
      const profile = await Effect.runPromise(
        serializePlist(
          buildAppleEnrollmentProfile({
            origin: env.ORIGIN,
            topic,
            organizationId: "whitelabel",
            organizationName: "Mattrax",
            challenge,
          }),
        ),
      );
      return new Response(profile, {
        headers: { "content-type": "application/x-apple-aspen-config" },
      });
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
