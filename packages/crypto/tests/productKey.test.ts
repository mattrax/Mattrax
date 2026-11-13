import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  hmacSha256Hex,
  productKeyVerifyMessage,
  signProductKeyRequest,
  verifyProductKeyRequest,
} from "../src/index.ts";

describe("product key request signing", () => {
  const secret = "MTLX-AAAA-BBBB-CCCC-DDDD";

  it("emits lowercase hex, not base64url", async () => {
    const signature = await signProductKeyRequest(secret, "1700000000.1:2");
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    // A base64url signature contains at least one of these characters; the
    // gateway previously emitted that format and the platform rejected it.
    expect(signature).not.toMatch(/[-_]/);
  });

  it("matches the platform verification message", async () => {
    const timestamp = 1_700_000_000;
    const payload = { userCount: 3, deviceCount: 7 };
    const message = productKeyVerifyMessage(timestamp, payload);
    expect(message).toBe("1700000000.3:7");

    const signature = await signProductKeyRequest(secret, message);
    await expect(verifyProductKeyRequest(secret, message, signature)).resolves.toBe(true);
    await expect(verifyProductKeyRequest(secret, `${message}x`, signature)).resolves.toBe(false);
  });

  it("rejects a base64url signature for the same digest", async () => {
    const message = "1700000000.0:0";
    const hex = await hmacSha256Hex(secret, message);

    const base64url = Buffer.from(hex, "hex")
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");

    await expect(verifyProductKeyRequest(secret, message, base64url)).resolves.toBe(false);
  });

  it("compares in constant time without matching prefixes", () => {
    expect(constantTimeEqual("abcd", "abcd")).toBe(true);
    expect(constantTimeEqual("abcd", "abce")).toBe(false);
    expect(constantTimeEqual("abcd", "abcde")).toBe(false);
  });
});
