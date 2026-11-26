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
  authSecret: "manifest-secret",
};

const handler = (backend: ReturnType<typeof mockManagementBackend>) => {
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

describe("GET /mdm/apple/manifests", () => {
  it("serves the OTA manifest fetched through the HTTP route", async () => {
    const content = new TextEncoder().encode("<plist><dict/></plist>");
    const backend = mockManagementBackend({
      getAppleManifest: () => Effect.succeed({ content, contentType: "application/xml" }),
    });
    const request = handler(backend);

    const response = await request(
      new Request("http://localhost/mdm/apple/manifests/app.installer-1?token=signed"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(await response.text()).toBe("<plist><dict/></plist>");
  });

  it("returns 404 for malformed percent-encoding instead of a 500", async () => {
    const backend = mockManagementBackend();
    const request = handler(backend);

    const response = await request(
      new Request("http://localhost/mdm/apple/manifests/%?token=signed"),
    );

    expect(response.status).toBe(404);
  });
});
