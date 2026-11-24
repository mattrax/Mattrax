import { describe, expect, it } from "vitest";
import {
  clientKey,
  rateLimitBindingsFromEnv,
  rateLimitResponse,
  rateLimitRuleFor,
} from "./rateLimit.js";

const request = (path: string, init: RequestInit = {}) =>
  new Request(`https://e.mattrax.app${path}`, init);

describe("rate limit rule selection", () => {
  it("covers auth, enrollment, billing, SCIM and MDM/SCEP", () => {
    expect(
      rateLimitRuleFor(request("/api/v1/completePasskeySignIn", { method: "POST" }))?.bucket,
    ).toBe("auth");
    expect(
      rateLimitRuleFor(request("/api/v1/completePasskeySignIn", { method: "GET" })),
    ).toBeUndefined();
    expect(
      rateLimitRuleFor(request("/api/v1/completePasskeyPending", { method: "POST" }))?.bucket,
    ).toBe("auth");
    expect(rateLimitRuleFor(request("/api/v1/recoverySignIn", { method: "POST" }))?.bucket).toBe(
      "auth",
    );
    expect(rateLimitRuleFor(request("/api/v1/sso/azure/callback", { method: "GET" }))?.bucket).toBe(
      "auth",
    );
    expect(rateLimitRuleFor(request("/api/v1/enrollment/abc"))?.bucket).toBe("enrollment");
    expect(rateLimitRuleFor(request("/api/v1/billing/webhook", { method: "POST" }))?.bucket).toBe(
      "billing",
    );
    expect(rateLimitRuleFor(request("/scim/v2/org/Users"))?.bucket).toBe("scim");
    expect(rateLimitRuleFor(request("/mdm/apple/mdm", { method: "PUT" }))?.bucket).toBe("mdm");
    expect(rateLimitRuleFor(request("/mdm/apple/scep"))?.bucket).toBe("scep");
    expect(rateLimitRuleFor(request("/api/v1/me", { method: "POST" }))).toBeUndefined();
    // Account-scoped feeds stay out of the credential-stuffing buckets.
    expect(rateLimitRuleFor(request("/api/v1/bootstrap"))).toBeUndefined();
    expect(rateLimitRuleFor(request("/api/v1/bootstrap", { method: "POST" }))).toBeUndefined();
    expect(
      rateLimitRuleFor(request("/api/v1/invitations/accept", { method: "POST" }))?.bucket,
    ).toBe("auth");
    expect(
      rateLimitRuleFor(request("/api/v1/invitations/preview?token=x", { method: "GET" }))?.bucket,
    ).toBe("auth");
    expect(
      rateLimitRuleFor(request("/api/v1/tenants/acme/invitations", { method: "POST" }))?.bucket,
    ).toBe("auth");
    expect(
      rateLimitRuleFor(request("/api/v1/tenants/acme/invitations/inv-1/resend", { method: "POST" }))
        ?.bucket,
    ).toBe("auth");
    // Public-client token endpoints are credential exchanges, not plain reads.
    expect(rateLimitRuleFor(request("/api/oauth/token", { method: "POST" }))?.bucket).toBe("auth");
    expect(rateLimitRuleFor(request("/api/oauth/revoke", { method: "POST" }))?.bucket).toBe("auth");
    expect(rateLimitRuleFor(request("/api/oauth/register", { method: "POST" }))?.bucket).toBe(
      "auth",
    );
    expect(rateLimitRuleFor(request("/api/oauth/token", { method: "GET" }))).toBeUndefined();
  });

  it("normalises paths before matching so an equivalent spelling cannot bypass a rule", () => {
    expect(
      rateLimitRuleFor(request("/API/V1//completePasskeySignIn/", { method: "POST" }))?.bucket,
    ).toBe("auth");
    expect(
      rateLimitRuleFor(request("/api/v1/complete%50asskeySignIn", { method: "POST" }))?.bucket,
    ).toBe("auth");
    expect(
      rateLimitRuleFor(request("/api/v1/completePasskeySignIn;session=x", { method: "POST" }))
        ?.bucket,
    ).toBe("auth");
  });
});

describe("client key", () => {
  it("uses the edge connecting IP on Cloudflare", () => {
    const cloudflare = (init: RequestInit) => {
      const req = request("/api/v1/completePasskeySignIn", init);

      Object.defineProperty(req, "cf", { value: {} });

      return req;
    };

    expect(
      clientKey(
        cloudflare({
          headers: { "cf-connecting-ip": "203.0.113.4", "x-forwarded-for": "198.51.100.9" },
        }),
      ),
    ).toBe("203.0.113.4");
  });

  it("ignores forwarded headers unless the proxy is trusted", () => {
    const forwarded = request("/api/v1/completePasskeySignIn", {
      headers: { "x-forwarded-for": "198.51.100.9, 10.0.0.1" },
    });

    expect(clientKey(forwarded)).toBe("local");
    expect(clientKey(forwarded, { trustForwarded: true })).toBe("10.0.0.1");
    expect(clientKey(request("/api/v1/completePasskeySignIn"))).toBe("local");
  });
});

describe("rate limit bindings from env", () => {
  it("maps every bucket binding and leaves unconfigured buckets undefined", () => {
    const limiter = { limit: async () => ({ success: true }) };

    const bindings = rateLimitBindingsFromEnv({
      RATE_LIMITER_AUTH: limiter,
      RATE_LIMITER_ENROLLMENT: limiter,
      RATE_LIMITER_MDM: limiter,
      RATE_LIMITER_SCIM: limiter,
      RATE_LIMITER_BILLING: limiter,
      RATE_LIMITER_SCEP: limiter,
    });

    expect(Object.keys(bindings).sort()).toEqual([
      "auth",
      "billing",
      "enrollment",
      "mdm",
      "scep",
      "scim",
    ]);
    expect(rateLimitBindingsFromEnv({ RATE_LIMITER_AUTH: limiter })).toEqual({ auth: limiter });
    // Unknown keys are ignored rather than leaking into the bucket map.
    const otherEnv = { RATE_LIMITER_AUTH: limiter, RATE_LIMITER_OTHER: limiter };
    expect(rateLimitBindingsFromEnv(otherEnv)).toEqual({ auth: limiter });
  });

  it("leaves buckets without a namespace undefined so they fall back", () => {
    const binding = { limit: async () => ({ success: true }) };
    const bindings = rateLimitBindingsFromEnv({ RATE_LIMITER_MDM: binding });

    // Every bucket key is present; only the configured ones hold a binding, so
    // a partial deployment degrades per bucket instead of losing the rest.
    expect(Object.entries(bindings).filter(([, value]) => value !== undefined)).toEqual([
      ["mdm", binding],
    ]);
  });
});

describe("rate limit responses", () => {
  it("returns a stable JSON body with Retry-After", async () => {
    const response = rateLimitResponse(
      { limited: true, bucket: "auth", limit: 120, retryAfterSeconds: 42 },
      "req-12345678",
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("x-request-id")).toBe("req-12345678");
    await expect(response.json()).resolves.toMatchObject({
      error: "rate_limited",
      message: "Too Many Requests",
      retryAfter: 42,
      requestId: "req-12345678",
    });
  });
});
