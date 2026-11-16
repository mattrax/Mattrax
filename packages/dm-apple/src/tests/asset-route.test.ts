import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { AppleMdmConfig } from "../config.js";
import { AppleMdmServiceLive, AppleMdmTopic } from "../service.js";
import { appleMdmRoutes } from "../handlers.js";
import { mockManagementBackend } from "./helpers.js";

const TEST_CONFIG = {
  origin: "https://test.mattrax.app",
  topic: "com.apple.mgmt.External.test",
  authSecret: "asset-secret",
};

const handler = (content: Uint8Array) => {
  const backend = mockManagementBackend({
    getAppleAsset: () => Effect.succeed({ content, contentType: "application/pem" }),
  });

  const serviceLayer = AppleMdmServiceLive.pipe(
    Layer.provideMerge(backend),
    Layer.provideMerge(
      AppleMdmConfig.layer({ origin: TEST_CONFIG.origin, authSecret: TEST_CONFIG.authSecret }),
    ),
    Layer.provideMerge(
      Layer.succeed(AppleMdmTopic, AppleMdmTopic.of({ get: Effect.succeed(TEST_CONFIG.topic) })),
    ),
  );

  return HttpRouter.toWebHandler(appleMdmRoutes.pipe(Layer.provideMerge(serviceLayer))).handler;
};

describe("GET /mdm/apple/assets", () => {
  it("serves a signed asset with a bounded private cache policy", async () => {
    const bytes = new TextEncoder().encode("certificate");
    const request = handler(bytes);

    const response = await request(
      new Request("http://localhost/mdm/apple/assets/policy-1.certificate.asset?token=signed"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pem");
    // The declaration carries a SHA-256 of these bytes and the signed URL
    // expires within the hour, so a short private cache is safe.
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=600, stale-while-revalidate=600",
    );
    expect(await response.text()).toBe("certificate");
  });

  it("does not cache a missing asset", async () => {
    const backend = mockManagementBackend({ getAppleAsset: () => Effect.succeed(null) });

    const serviceLayer = AppleMdmServiceLive.pipe(
      Layer.provideMerge(backend),
      Layer.provideMerge(
        AppleMdmConfig.layer({ origin: TEST_CONFIG.origin, authSecret: TEST_CONFIG.authSecret }),
      ),
      Layer.provideMerge(
        Layer.succeed(AppleMdmTopic, AppleMdmTopic.of({ get: Effect.succeed(TEST_CONFIG.topic) })),
      ),
    );

    const request = HttpRouter.toWebHandler(
      appleMdmRoutes.pipe(Layer.provideMerge(serviceLayer)),
    ).handler;

    const response = await request(
      new Request("http://localhost/mdm/apple/assets/missing.asset?token=signed"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBeNull();
  });
});
