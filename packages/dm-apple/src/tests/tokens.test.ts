import { describe, expect, it } from "vitest";
import {
  APPLE_ASSET_TOKEN_REFRESH_SECONDS,
  APPLE_ASSET_TOKEN_TTL_SECONDS,
  appleAssetTokenEpoch,
  appleAssetTokenExpiresAt,
  signAppleAssetToken,
  signAppleProfileToken,
  verifyAppleAssetToken,
  verifyAppleProfileToken,
} from "../tokens.js";

const SECRET = "asset-token-test-secret";
const NOW = 1_700_000_000_000;

const contextAt = (now: number) => ({
  policyId: "policy-1",
  kind: "mttx.apple.certificate.root",
  deviceId: "device-1",
  expiresAt: appleAssetTokenExpiresAt(now),
});

const expected = { policyId: "policy-1", kind: "mttx.apple.certificate.root" };

describe("Apple asset URL tokens", () => {
  it("verifies a token and returns the bound device and expiry", async () => {
    const context = contextAt(NOW);
    const token = await signAppleAssetToken(SECRET, context);

    await expect(verifyAppleAssetToken(SECRET, token, expected, NOW)).resolves.toEqual({
      policyId: "policy-1",
      kind: "mttx.apple.certificate.root",
      deviceId: "device-1",
      expiresAt: context.expiresAt,
    });
  });

  it("rejects a token after it expires", async () => {
    const token = await signAppleAssetToken(SECRET, contextAt(NOW));

    await expect(
      verifyAppleAssetToken(SECRET, token, expected, contextAt(NOW).expiresAt * 1000),
    ).resolves.toBeNull();
  });

  it("rejects a token bound to a different device", async () => {
    const token = await signAppleAssetToken(SECRET, contextAt(NOW));

    // The payload's device id is covered by the HMAC: rewriting it invalidates
    // the token instead of re-binding it to another device.
    const [payload, signature] = token.split(".");
    const decoded = atob(payload!.replaceAll("-", "+").replaceAll("_", "/"));

    const tamperedPayload = btoa(decoded.replace("device-1", "device-2"))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");

    const tampered = `${tamperedPayload}.${signature}`;

    await expect(verifyAppleAssetToken(SECRET, tampered, expected, NOW)).resolves.toBeNull();
  });

  it("rejects a tampered token and a token signed with another secret", async () => {
    const token = await signAppleAssetToken(SECRET, contextAt(NOW));
    const [payload, signature] = token.split(".");
    const flipped = `${signature!.slice(0, -2)}aa`;

    await expect(
      verifyAppleAssetToken(SECRET, `${payload}.${flipped}`, expected, NOW),
    ).resolves.toBeNull();
    await expect(verifyAppleAssetToken("another-secret", token, expected, NOW)).resolves.toBeNull();
    await expect(verifyAppleAssetToken(SECRET, "not-a-token", expected, NOW)).resolves.toBeNull();
  });

  it("rejects a token issued for another policy or kind", async () => {
    const token = await signAppleAssetToken(SECRET, contextAt(NOW));

    await expect(
      verifyAppleAssetToken(SECRET, token, { policyId: "policy-2", kind: expected.kind }, NOW),
    ).resolves.toBeNull();
    await expect(
      verifyAppleAssetToken(
        SECRET,
        token,
        { policyId: expected.policyId, kind: "mttx.apple.certificate.other" },
        NOW,
      ),
    ).resolves.toBeNull();
  });

  it("rotates the declaration token on a fixed refresh window", () => {
    const epoch = appleAssetTokenEpoch(NOW);
    const expiresAt = appleAssetTokenExpiresAt(NOW);

    expect(expiresAt).toBe((epoch + 2) * APPLE_ASSET_TOKEN_REFRESH_SECONDS);
    expect(expiresAt * 1000 - NOW).toBeGreaterThanOrEqual(APPLE_ASSET_TOKEN_REFRESH_SECONDS * 1000);
    expect(expiresAt * 1000 - NOW).toBeLessThanOrEqual(APPLE_ASSET_TOKEN_TTL_SECONDS * 1000);

    // Stable within a window, different in the next one.
    expect(appleAssetTokenEpoch(NOW + 1_000)).toBe(epoch);
    expect(appleAssetTokenEpoch(NOW + APPLE_ASSET_TOKEN_REFRESH_SECONDS * 1000)).toBe(epoch + 1);
  });

  it("keeps profile tokens device-bound and expiring", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 60;

    const context = {
      policyId: "policy-1",
      kind: "mttx.apple.device",
      deviceToken: "device-token-1",
      deviceId: "device-1",
      expiresAt,
    };

    const token = await signAppleProfileToken(SECRET, context);

    await expect(verifyAppleProfileToken(SECRET, token, context)).resolves.toBe(true);
    await expect(
      verifyAppleProfileToken(SECRET, token, { ...context, deviceToken: "device-token-2" }),
    ).resolves.toBe(false);
    await expect(
      verifyAppleProfileToken(SECRET, token, { ...context, deviceId: "device-2" }),
    ).resolves.toBe(false);
    await expect(
      verifyAppleProfileToken(SECRET, token, { ...context, expiresAt: expiresAt + 60 }),
    ).resolves.toBe(false);

    // A profile token must never be accepted as an asset token.
    await expect(
      verifyAppleAssetToken(
        SECRET,
        token,
        { policyId: "policy-1", kind: "mttx.apple.device" },
        NOW,
      ),
    ).resolves.toBeNull();
  });
});
