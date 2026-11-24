import { describe, expect, it } from "vitest";
import { isTrustedPeerAddress, parseTrustedPeerAddresses } from "./trustedPeer.js";

describe("trusted device identity peers", () => {
  it("trims, deduplicates and canonicalizes numeric peer addresses", () => {
    expect([...parseTrustedPeerAddresses(" 127.0.0.1 , ::1, 0:0:0:0:0:0:0:1 ")]).toEqual([
      "127.0.0.1",
      "::1",
    ]);
    expect([...parseTrustedPeerAddresses("::ffff:127.0.0.1")]).toEqual(["127.0.0.1"]);
  });

  it("treats an absent or blank allowlist as empty", () => {
    expect(parseTrustedPeerAddresses(undefined).size).toBe(0);
    expect(parseTrustedPeerAddresses(" , ").size).toBe(0);
  });

  it.each(["localhost", "127.0.0.1/8", "0.0.0.0", "::", "::ffff:0.0.0.0", "999.1.1.1"])(
    "rejects a non-specific or invalid peer: %s",
    (value) => {
      expect(() => parseTrustedPeerAddresses(value)).toThrow(/TRUSTED_DEVICE_IDENTITY_PEERS/);
    },
  );

  it("matches only canonical addresses in the allowlist", () => {
    const peers = parseTrustedPeerAddresses("127.0.0.1");

    expect(isTrustedPeerAddress("::ffff:127.0.0.1", peers)).toBe(true);
    expect(isTrustedPeerAddress("127.0.0.2", peers)).toBe(false);
    expect(isTrustedPeerAddress("not-an-ip", peers)).toBe(false);
    expect(isTrustedPeerAddress(undefined, peers)).toBe(false);
  });
});
