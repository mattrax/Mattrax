import { describe, expect, it } from "vitest";
import { analyticsHeaders, registerPostHogReader } from "./posthog-context";

describe("PostHog correlation headers", () => {
  it("is empty until the browser SDK has initialised", () => {
    registerPostHogReader(() => ({}));
    expect(analyticsHeaders()).toEqual({});
  });

  it("forwards the live distinct and session ids", () => {
    registerPostHogReader(() => ({
      distinctId: "user-1",
      sessionId: "0193f0b2-6f2a-7c3e-8b1d-2c4a5e6f7a8b",
    }));
    expect(analyticsHeaders()).toEqual({
      "x-posthog-distinct-id": "user-1",
      "x-posthog-session-id": "0193f0b2-6f2a-7c3e-8b1d-2c4a5e6f7a8b",
    });
  });
});
