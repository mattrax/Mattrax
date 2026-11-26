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

  it.each(["NaN", "Infinity", "-Infinity", "1700000000.5", "9007199254740992"])(
    "rejects a correctly signed non-integer or non-finite timestamp %s",
    (invalidTimestamp) => {
      const signature = relaySignature(servicesToken, invalidTimestamp, body);

      expect(
        verifyRelaySignature({
          token: servicesToken,
          timestamp: invalidTimestamp,
          signature,
          body,
          now,
        }),
      ).toBe("invalid");
    },
  );

  it("accepts both replay-window boundaries and rejects one second beyond them", () => {
    for (const delta of [-300, 300]) {
      const boundaryTimestamp = String(Math.floor(now / 1000) + delta);
      const signature = relaySignature(servicesToken, boundaryTimestamp, body);

      expect(
        verifyRelaySignature({
          token: servicesToken,
          timestamp: boundaryTimestamp,
          signature,
          body,
          now: now + 999,
        }),
      ).toBe("ok");
    }

    for (const delta of [-301, 301]) {
      const staleTimestamp = String(Math.floor(now / 1000) + delta);
      const signature = relaySignature(servicesToken, staleTimestamp, body);

      expect(
        verifyRelaySignature({
          token: servicesToken,
          timestamp: staleTimestamp,
          signature,
          body,
          now: now + 999,
        }),
      ).toBe("stale");
    }
  });

  it("reports missing credentials", () => {
    expect(verifyRelaySignature({ body, now })).toBe("missing");
    expect(verifyRelaySignature({ token: servicesToken, body, now })).toBe("missing");
  });
});
