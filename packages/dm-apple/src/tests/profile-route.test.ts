import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { AppleMdmConfig } from "../config.js";
import { AppleMdmServiceLive, AppleMdmTopic } from "../service.js";
import { appleMdmRoutes } from "../handlers.js";
import { signAppleProfileToken } from "../tokens.js";
import { mockManagementBackend } from "./helpers.js";

const TEST_CONFIG = {
  origin: "https://test.mattrax.app",
  topic: "com.apple.mgmt.External.test",
  authSecret: "profile-secret",
};

async function makeHandler(getAppleProfile: () => Effect.Effect<any, any>) {
  const backend = mockManagementBackend({ getAppleProfile });
  const serviceLayer = AppleMdmServiceLive.pipe(
    Layer.provideMerge(backend),
    Layer.provideMerge(
      AppleMdmConfig.layer({ origin: TEST_CONFIG.origin, authSecret: TEST_CONFIG.authSecret }),
    ),
    Layer.provideMerge(
      Layer.succeed(AppleMdmTopic, AppleMdmTopic.of({ get: Effect.succeed(TEST_CONFIG.topic) })),
    ),
  );
  const { handler } = HttpRouter.toWebHandler(
    appleMdmRoutes.pipe(Layer.provideMerge(serviceLayer)),
  );
  return handler;
}

describe("GET /mdm/apple/profiles", () => {
  it("serves a legacy profile for a valid signed URL", async () => {
    const profile = new TextEncoder().encode("profile-content");
    const handler = await makeHandler(() =>
      Effect.succeed({ content: profile, contentType: "application/x-apple-aspen-config" }),
    );
    const token = await signAppleProfileToken(TEST_CONFIG.authSecret, {
      policyId: "policy-1",
      kind: "mttx.apple.device",
      deviceToken: "device-token-1",
    });

    const response = await handler(
      new Request(
        `http://localhost/mdm/apple/profiles/device-token-1/policy-1/mttx.apple.device?token=${token}`,
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-apple-aspen-config");
    expect(await response.text()).toBe("profile-content");
  });

  it("rejects an unsigned URL", async () => {
    const handler = await makeHandler(() =>
      Effect.succeed({
        content: new Uint8Array(),
        contentType: "application/x-apple-aspen-config",
      }),
    );
    const response = await handler(
      new Request("http://localhost/mdm/apple/profiles/device-token-1/policy-1/mttx.apple.device"),
    );
    expect(response.status).toBe(404);
  });

  it("rejects a token issued for another device", async () => {
    const handler = await makeHandler(() =>
      Effect.succeed({
        content: new Uint8Array(),
        contentType: "application/x-apple-aspen-config",
      }),
    );
    const token = await signAppleProfileToken(TEST_CONFIG.authSecret, {
      policyId: "policy-1",
      kind: "mttx.apple.device",
      deviceToken: "other-device",
    });
    const response = await handler(
      new Request(
        `http://localhost/mdm/apple/profiles/device-token-1/policy-1/mttx.apple.device?token=${token}`,
      ),
    );
    expect(response.status).toBe(404);
  });
});
