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

  it("reports missing credentials", () => {
    expect(verifyRelaySignature({ body, now })).toBe("missing");
    expect(verifyRelaySignature({ token: servicesToken, body, now })).toBe("missing");
  });
});
