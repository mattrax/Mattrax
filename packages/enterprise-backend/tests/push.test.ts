import { describe, expect, it } from "vitest";
import {
  classifyApplePushFailure,
  describeApplePushFailure,
  summarizeApplePushHealth,
} from "../src/push.js";

describe("classifyApplePushFailure", () => {
  it("treats Apple's invalid-token reasons as invalid_token", () => {
    for (const message of [
      'APNs rejected push (HTTP 400): {"reason":"BadDeviceToken"}',
      'APNs rejected push (HTTP 410): {"reason":"Unregistered"}',
      'APNs rejected push (HTTP 400): {"reason":"DeviceTokenNotForTopic"}',
      'APNs rejected push (HTTP 400): {"reason":"MissingDeviceToken"}',
    ])
      expect(classifyApplePushFailure(new Error(message))).toBe("invalid_token");
  });

  it("treats HTTP 410 as an invalid token even without a reason body", () => {
    expect(classifyApplePushFailure({ message: "APNs rejected push (HTTP 410)" })).toBe(
      "invalid_token",
    );
  });

  it("classifies transport and certificate failures as delivery_failed", () => {
    expect(classifyApplePushFailure({ message: "APNs request failed", cause: "ECONNRESET" })).toBe(
      "delivery_failed",
    );
    expect(
      classifyApplePushFailure({
        message: "APNs push requires a certificate and private key for this transport",
      }),
    ).toBe("delivery_failed");
  });
});

describe("describeApplePushFailure", () => {
  it("collapses whitespace and bounds the stored message", () => {
    const message = describeApplePushFailure(new Error(`bad\n\n${"x".repeat(400)}`));
    expect(message).not.toContain("\n");
    expect(message.length).toBe(255);
  });

  it("falls back to a stable message", () => {
    expect(describeApplePushFailure(null)).toBe("APNs push failed");
  });
});

describe("summarizeApplePushHealth", () => {
  it("counts configured, attempted, succeeded, failing and invalid devices", () => {
    const counts = summarizeApplePushHealth([
      {
        token: "t",
        pushMagic: "m",
        lastPushAt: new Date(),
        lastPushOkAt: new Date(),
        lastPushErrorCode: null,
        consecutivePushFailures: 0,
      },
      {
        token: "t",
        pushMagic: "m",
        lastPushAt: new Date(),
        lastPushOkAt: null,
        lastPushErrorCode: "delivery_failed",
        consecutivePushFailures: 2,
      },
      {
        token: "t",
        pushMagic: "m",
        lastPushAt: new Date(),
        lastPushOkAt: new Date("2026-01-01"),
        lastPushErrorCode: "invalid_token",
        consecutivePushFailures: 1,
      },
      // No credentials: not configured and never attempted.
      { token: null, pushMagic: null, consecutivePushFailures: 0 },
    ]);

    expect(counts).toEqual({
      configured: 3,
      attempted: 3,
      succeeded: 1,
      failing: 2,
      invalidToken: 1,
    });
  });

  it("does not count a failed device as succeeded", () => {
    const counts = summarizeApplePushHealth([
      { token: "t", pushMagic: "m", lastPushOkAt: new Date(), consecutivePushFailures: 1 },
    ]);
    expect(counts.succeeded).toBe(0);
    expect(counts.failing).toBe(1);
  });
});
