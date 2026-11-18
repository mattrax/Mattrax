import { describe, expect, test } from "vitest";
import { parse } from "../tldts.stub.ts";

/**
 * `@yielded/auth` only uses these fields to reject an RP ID that is an IP
 * literal or a bare public suffix. Keep the assertions on that contract rather
 * than on the full public-suffix list.
 */
describe("tldts stub", () => {
  test("accepts a deployment hostname as an RP ID", () => {
    expect(parse("e.mattrax.app")).toMatchObject({
      isIp: false,
      domain: "e.mattrax.app",
      publicSuffix: "app",
    });
  });

  test("reports the suffix of a multi-label public suffix", () => {
    expect(parse("dev.example.co.uk")).toMatchObject({
      isIp: false,
      publicSuffix: "co.uk",
    });
  });

  test("flags IP literals", () => {
    expect(parse("127.0.0.1").isIp).toBe(true);
    expect(parse("::1").isIp).toBe(true);
  });

  test("keeps a bare public suffix distinguishable from a host", () => {
    expect(parse("app").publicSuffix).toBe("app");
    expect(parse("co.uk").publicSuffix).toBe("co.uk");
  });
});
