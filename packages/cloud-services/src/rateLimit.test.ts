import { describe, expect, it } from "vitest";
import {
  clientKey,
  createRateLimiter,
  rateLimitBindingsFromEnv,
  rateLimitResponse,
  rateLimitRuleFor,
  type RateLimitBindings,
} from "./rateLimit.js";

const request = (path: string, init: RequestInit = {}) =>
  new Request(`https://e.mattrax.app${path}`, init);

/** A request shaped like one received by a Cloudflare Worker. */
const cloudflareRequest = (path: string, init: RequestInit = {}) => {
  const req = request(path, init);

  Object.defineProperty(req, "cf", { value: {} });

  return req;
};

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

describe("per-isolate fallback limiter", () => {
  it("allows up to the limit and then returns Retry-After", async () => {
    let now = 1_000;
    const limiter = createRateLimiter({ now: () => now });

    const req = () =>
      request("/api/v1/completePasskeySignIn", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.4" },
      });

    for (let index = 0; index < 600; index++) {
      expect((await limiter.check(req())).limited).toBe(false);
      now += 10;
    }

    const blocked = await limiter.check(req());
    expect(blocked.limited).toBe(true);
    expect(blocked.bucket).toBe("auth");
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // A new window resets the counter.
    now += 60_000;
    expect((await limiter.check(req())).limited).toBe(false);
  });

  it("keeps buckets and clients independent", async () => {
    const limiter = createRateLimiter({ now: () => 1_000 });

    const ipA = cloudflareRequest("/api/v1/enrollment/a", {
      headers: { "cf-connecting-ip": "203.0.113.4" },
    });

    const ipB = cloudflareRequest("/api/v1/enrollment/a", {
      headers: { "cf-connecting-ip": "198.51.100.9" },
    });

    for (let index = 0; index < 600; index++) await limiter.check(ipA);
    expect((await limiter.check(ipA)).limited).toBe(true);
    expect((await limiter.check(ipB)).limited).toBe(false);
  });
});

describe("shared limiter bindings", () => {
  it("uses the Cloudflare binding when present", async () => {
    const keys: string[] = [];

    const bindings: RateLimitBindings = {
      auth: {
        limit: async ({ key }) => {
          keys.push(key);

          return { success: false };
        },
      },
    };

    const limiter = createRateLimiter();

    const outcome = await limiter.check(
      cloudflareRequest("/api/v1/completePasskeySignIn", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.4" },
      }),
      bindings,
    );

    expect(outcome.limited).toBe(true);
    expect(keys).toEqual(["auth:203.0.113.4"]);
  });

  it("falls back locally when the edge limiter throws", async () => {
    const warnings: string[] = [];

    const bindings: RateLimitBindings = {
      enrollment: {
        limit: async () => {
          throw new Error("binding unavailable");
        },
      },
    };

    const limiter = createRateLimiter({
      now: () => 1_000,
      warn: (message) => warnings.push(message),
    });

    const outcome = await limiter.check(request("/api/v1/enrollment/a"), bindings);
    expect(outcome.limited).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("local fallback");
  });

  it("fails closed when the auth edge limiter is configured but unavailable", async () => {
    const warnings: string[] = [];

    const bindings: RateLimitBindings = {
      auth: {
        limit: async () => {
          throw new Error("binding unavailable");
        },
      },
    };

    const limiter = createRateLimiter({
      now: () => 1_000,
      warn: (message) => warnings.push(message),
    });

    const outcome = await limiter.check(
      cloudflareRequest("/api/v1/completePasskeySignIn", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.4" },
      }),
      bindings,
    );

    expect(outcome).toMatchObject({
      limited: true,
      bucket: "auth",
      limit: 600,
      retryAfterSeconds: 60,
    });
    expect(outcome.retryAfterSeconds).toBeGreaterThan(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("failing closed");

    // The failed closed request must not have charged the local counter: a
    // recovered binding (or another credential route) is not penalised by the
    // outage itself.
    expect(limiter.store.size).toBe(0);
  });

  it("treats a malformed binding result as unavailable", async () => {
    const warnings: string[] = [];

    const limiter = createRateLimiter({
      now: () => 1_000,
      warn: (message) => warnings.push(message),
    });

    const outcome = await limiter.check(
      request("/api/v1/completePasskeySignIn", { method: "POST" }),
      // SAFETY: the test proves the limiter refuses an unexpected result shape.
      { auth: { limit: async () => ({}) } } as any,
    );

    expect(outcome.limited).toBe(true);
    expect(warnings[0]).toContain("failing closed");
  });

  it("keeps the local auth fallback when no edge binding is configured", async () => {
    let now = 1_000;
    const limiter = createRateLimiter({ now: () => now });

    const signIn = () =>
      request("/api/v1/completePasskeySignIn", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.4" },
      });

    // Local development has no namespace at all; it must keep working up to
    // the documented per-isolate ceiling.
    for (let index = 0; index < 600; index++) {
      expect((await limiter.check(signIn())).limited).toBe(false);
      now += 10;
    }

    expect((await limiter.check(signIn())).limited).toBe(true);
  });

  it("fails closed for MCP token exchange when the edge limiter is unavailable", async () => {
    const limiter = createRateLimiter({ warn: () => {} });

    const outcome = await limiter.check(request("/api/oauth/token", { method: "POST" }), {
      auth: {
        limit: async () => {
          throw new Error("binding unavailable");
        },
      },
    });

    expect(outcome.limited).toBe(true);
    expect(outcome.bucket).toBe("auth");
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

  it("selects the matching bucket binding for MDM, SCIM, billing and SCEP", async () => {
    const seen: string[] = [];

    const bindingFor = (bucket: string) => ({
      limit: async ({ key }: { key: string }) => {
        seen.push(`${bucket}:${key}`);

        return { success: true };
      },
    });

    const bindings: RateLimitBindings = {
      mdm: bindingFor("mdm"),
      scim: bindingFor("scim"),
      billing: bindingFor("billing"),
      scep: bindingFor("scep"),
    };

    const limiter = createRateLimiter();
    await limiter.check(request("/mdm/apple/mdm", { method: "PUT" }), bindings);
    await limiter.check(request("/scim/v2/org/Users"), bindings);
    await limiter.check(request("/api/v1/billing/webhook", { method: "POST" }), bindings);
    await limiter.check(request("/mdm/apple/scep"), bindings);
    expect(seen).toEqual([
      "mdm:mdm:local",
      "scim:scim:local",
      "billing:billing:local",
      "scep:scep:local",
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
