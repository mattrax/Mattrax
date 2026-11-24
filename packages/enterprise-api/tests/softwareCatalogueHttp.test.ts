import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApi, HttpApiBuilder } from "effect/http-api";
import { describe, expect, it } from "vitest";
import { EnterpriseService, enterpriseSoftwareCatalogueApi } from "@mattrax/enterprise-domain";
import { enterpriseSoftwareCatalogueHandlers } from "@mattrax/enterprise-api";
import { makeHttpHandler } from "./helpers.js";

/** The catalogue group is separate from EnterpriseApi; prove its prefix too. */
const makeHandler = () => {
  const service = {
    searchSoftwareCatalogue: () =>
      Effect.succeed({
        items: [],
        total: 0,
        limit: 24,
        offset: 0,
        facets: { categories: [], platforms: [] },
        additions: [],
        verifiedAt: "2026-11-24",
      }),
  };

  const api = HttpApi.make("SoftwareCatalogueHttpTest").add(enterpriseSoftwareCatalogueApi);

  const layer = HttpApiBuilder.layer(api).pipe(
    Layer.provide(
      HttpApiBuilder.group(api, "EnterpriseSoftwareCatalogue", (handlers) =>
        enterpriseSoftwareCatalogueHandlers(handlers),
      ),
    ),
    Layer.provide(Layer.succeed(EnterpriseService, service as any)),
    Layer.provide(HttpRouter.layer),
    Layer.provide(HttpServer.layerServices),
  );

  return makeHttpHandler(layer);
};

describe("software catalogue HTTP contract", () => {
  it("serves search under /api", async () => {
    const handler = makeHandler();

    const response = await handler(
      new Request("http://localhost/api/v1/tenants/org-1/software/catalogue?q=chrome"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ total: 0, items: [] });
  });

  it("does not serve it without the /api prefix", async () => {
    const handler = makeHandler();

    const response = await handler(
      new Request("http://localhost/v1/tenants/org-1/software/catalogue"),
    );

    expect(response.status).toBe(404);
  });
});