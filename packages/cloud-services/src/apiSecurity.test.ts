import { describe, expect, it } from "vitest";
import { withApiSecurityHeaders } from "./apiSecurity.js";

const response = () =>
  new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

describe("API security headers", () => {
  it("hardens a response served straight from the API route", () => {
    const hardened = withApiSecurityHeaders(new Request("https://e.mattrax.app/api/ready"), response());

    expect(hardened.headers.get("x-content-type-options")).toBe("nosniff");
    expect(hardened.headers.get("x-frame-options")).toBe("DENY");
    expect(hardened.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(hardened.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    // The response's own policy survives.
    expect(hardened.headers.get("cache-control")).toBe("no-store");
  });

  it("does not advertise HSTS over plain HTTP", () => {
    const hardened = withApiSecurityHeaders(new Request("http://localhost:9050/api/ready"), response());

    expect(hardened.headers.get("strict-transport-security")).toBeNull();
  });
});
