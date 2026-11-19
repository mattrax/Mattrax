import { describe, expect, it } from "vitest";
import { boundedClientAddress, clientAddress } from "./clientAddress.js";

const headers = (record: Record<string, string>) => record;

describe("trusted client address", () => {
  it("uses Cloudflare's edge header when the request came through Cloudflare", () => {
    expect(
      clientAddress(
        headers({
          "cf-connecting-ip": "203.0.113.4",
          "x-forwarded-for": "198.51.100.9",
        }),
        { cloudflare: true, trustForwarded: false },
      ),
    ).toBe("203.0.113.4");
  });

  it("never trusts a caller-supplied forwarded chain by default", () => {
    expect(
      clientAddress(headers({ "x-forwarded-for": "203.0.113.4" }), { trustForwarded: false }),
    ).toBeNull();
    expect(clientAddress(headers({ "x-real-ip": "203.0.113.4" }))).toBeNull();
  });

  it("uses the last forwarded hop, not the caller-chosen first hop", () => {
    expect(
      clientAddress(
        headers({ "x-forwarded-for": "198.51.100.9, 10.0.0.1, 203.0.113.4" }),
        { trustForwarded: true },
      ),
    ).toBe("203.0.113.4");
  });

  it("falls back to x-real-ip behind a trusted proxy", () => {
    expect(clientAddress(headers({ "x-real-ip": "203.0.113.7" }), { trustForwarded: true })).toBe(
      "203.0.113.7",
    );
  });

  it("bounds the stored value to the column width", () => {
    const ipv6 = `2001:db8:${"a".repeat(80)}`;

    expect(
      boundedClientAddress(headers({ "cf-connecting-ip": ipv6 }), { cloudflare: true }),
    ).toHaveLength(64);
  });

  it("reads Headers as well as a plain record", () => {
    const requestHeaders = new Headers({ "cf-connecting-ip": "203.0.113.5" });

    expect(clientAddress(requestHeaders, { cloudflare: true })).toBe("203.0.113.5");
  });
});
