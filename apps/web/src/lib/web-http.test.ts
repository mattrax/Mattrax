import { HttpClientRequest } from "effect/http";
import { describe, expect, it } from "vitest";
import { registerPostHogReader } from "./posthog-context";
import { withApplicationAnalytics } from "./web-http";

describe("application analytics headers", () => {
  it("adds correlation headers only to same-origin API requests", () => {
    registerPostHogReader(() => ({ distinctId: "account-1", sessionId: "session-1" }));
    const request = withApplicationAnalytics(
      HttpClientRequest.get("/api/v1/me", { headers: { "x-existing": "yes" } }),
    );

    expect(request.headers["x-posthog-distinct-id"]).toBe("account-1");
    expect(request.headers["x-posthog-session-id"]).toBe("session-1");
    expect(request.headers["x-existing"]).toBe("yes");

    const asset = withApplicationAnalytics(HttpClientRequest.get("/catalog/apple.json"));
    expect(asset.headers["x-posthog-distinct-id"]).toBeUndefined();
  });
});
