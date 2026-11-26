import { describe, expect, it } from "vitest";
import { relaySignature as signRelayRequest } from "@mattrax/apns";
import { relaySignature, verifyRelaySignature } from "./relayAuth.ts";

const servicesToken = "services-token-0123456789abcdef";
const timestamp = "1700000000";
const body = JSON.stringify({ pushToken: "abcd1234", topic: "com.apple.mgmt.External.tenant" });
const now = 1_700_000_000_000;

describe("services relay auth", () => {
  it("accepts an HMAC signed with SERVICES_TOKEN", async () => {
    const signature = await signRelayRequest(servicesToken, timestamp, body);

    expect(verifyRelaySignature({ token: servicesToken, timestamp, signature, body, now })).toBe(
      "ok",
    );
  });

  it("matches the signature Cloud computes", async () => {
    expect(relaySignature(servicesToken, timestamp, body)).toBe(
      await signRelayRequest(servicesToken, timestamp, body),
    );
  });

  it("rejects a signature made with a different token", async () => {
    const signature = await signRelayRequest("a-different-services-token", timestamp, body);

    expect(verifyRelaySignature({ token: servicesToken, timestamp, signature, body, now })).toBe(
      "invalid",
    );
  });

  it("rejects a stale signature", async () => {
    const signature = await signRelayRequest(servicesToken, timestamp, body);

    expect(
      verifyRelaySignature({
        token: servicesToken,
        timestamp,
        signature,
        body,
        now: now + 301_000,
      }),
    ).toBe("stale");
  });

  it("rejects a correctly signed NaN timestamp", () => {
    const timestamp = "NaN";
    const signature = relaySignature(servicesToken, timestamp, body);

    expect(
      verifyRelaySignature({
        token: servicesToken,
        timestamp,
        signature,
        body,
        now,
      }),
    ).toBe("invalid");
  });

  it("rejects a correctly signed Infinity timestamp", () => {
    const timestamp = "Infinity";
    const signature = relaySignature(servicesToken, timestamp, body);

    expect(
      verifyRelaySignature({
        token: servicesToken,
        timestamp,
        signature,
        body,
        now,
      }),
    ).toBe("invalid");
  });

  it("rejects a correctly signed negative Infinity timestamp", () => {
    const timestamp = "-Infinity";
    const signature = relaySignature(servicesToken, timestamp, body);

    expect(
      verifyRelaySignature({
        token: servicesToken,
        timestamp,
        signature,
        body,
        now,
      }),
    ).toBe("invalid");
  });

  it("rejects a correctly signed a fractional timestamp timestamp", () => {
    const timestamp = "1700000000.5";
    const signature = relaySignature(servicesToken, timestamp, body);

    expect(
      verifyRelaySignature({
        token: servicesToken,
        timestamp,
        signature,
        body,
        now,
      }),
    ).toBe("invalid");
  });

  it("rejects a correctly signed a timestamp beyond the safe integer range timestamp", () => {
    const timestamp = "9007199254740992";
    const signature = relaySignature(servicesToken, timestamp, body);

    expect(
      verifyRelaySignature({
        token: servicesToken,
        timestamp,
        signature,
        body,
        now,
      }),
    ).toBe("invalid");
  });

  it("accepts a signature 300 seconds before now", () => {
    const timestamp = String(Math.floor(now / 1000) + -300);
    const signature = relaySignature(servicesToken, timestamp, body);

    expect(
      verifyRelaySignature({ token: servicesToken, timestamp, signature, body, now: now + 999 }),
    ).toBe("ok");
  });

  it("accepts a signature 300 seconds after now", () => {
    const timestamp = String(Math.floor(now / 1000) + 300);
    const signature = relaySignature(servicesToken, timestamp, body);

    expect(
      verifyRelaySignature({ token: servicesToken, timestamp, signature, body, now: now + 999 }),
    ).toBe("ok");
  });

  it("rejects a stale signature 301 seconds before now", () => {
    const timestamp = String(Math.floor(now / 1000) + -301);
    const signature = relaySignature(servicesToken, timestamp, body);

    expect(
      verifyRelaySignature({ token: servicesToken, timestamp, signature, body, now: now + 999 }),
    ).toBe("stale");
  });

  it("rejects a stale signature 301 seconds after now", () => {
    const timestamp = String(Math.floor(now / 1000) + 301);
    const signature = relaySignature(servicesToken, timestamp, body);

    expect(
      verifyRelaySignature({ token: servicesToken, timestamp, signature, body, now: now + 999 }),
    ).toBe("stale");
  });

  it("reports missing credentials when the token is absent", () => {
    expect(verifyRelaySignature({ body, now })).toBe("missing");
  });

  it("reports missing credentials when the signature is absent", () => {
    expect(verifyRelaySignature({ token: servicesToken, body, now })).toBe("missing");
  });
});
