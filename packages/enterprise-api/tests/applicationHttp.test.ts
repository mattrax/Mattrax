import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApi, HttpApiBuilder } from "effect/http-api";
import { describe, expect, it } from "vitest";
import { EnterpriseService, enterpriseApplicationApi } from "@mattrax/enterprise-domain";
import { enterpriseApplicationHandlers } from "@mattrax/enterprise-api";
import { makeHttpHandler } from "./helpers.js";

/**
 * The catalogue delivery endpoints live in their own group so the main API's
 * declaration stays under the compiler's size limit. This proves the group kept
 * the public `/api` prefix when it moved, which the dashboard's same-contract
 * client cannot catch on its own.
 */
const makeHandler = () => {
  const service = {
    installApplication: () => Effect.succeed({ status: "ok" as const, queued: 0, skipped: 0 }),
    uninstallApplication: () => Effect.succeed({ status: "ok" as const, queued: 0, skipped: 0 }),
  };

  const api = HttpApi.make("ApplicationHttpTest").add(enterpriseApplicationApi);

  const layer = HttpApiBuilder.layer(api).pipe(
    Layer.provide(
      HttpApiBuilder.group(api, "EnterpriseApplication", (handlers) =>
        enterpriseApplicationHandlers(handlers),
      ),
    ),
    Layer.provide(Layer.succeed(EnterpriseService, service as any)),
    Layer.provide(HttpRouter.layer),
    Layer.provide(HttpServer.layerServices),
  );

  return makeHttpHandler(layer);
};

describe("application HTTP contract", () => {
  it("serves the moved endpoints under /api", async () => {
    const handler = makeHandler();

    const response = await handler(
      new Request("http://localhost/api/v1/tenants/org-1/applications/app-1/install", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok", queued: 0 });
  });

  it("does not serve them without the /api prefix", async () => {
    const handler = makeHandler();

    const response = await handler(
      new Request("http://localhost/v1/tenants/org-1/applications/app-1/install", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
  });
});
