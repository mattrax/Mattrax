import { describe, expect, it } from "vitest";
import {
  clientKey,
  makeRateLimiter,
  rateLimitResponse,
  rateLimitRuleFor,
  type RateLimitBindings,
} from "./rateLimit.js";

const request = (path: string, init: RequestInit = {}) =>
  new Request(`https://e.mattrax.app${path}`, init);

describe("rate limit rule selection", () => {
  it("covers auth, enrollment, billing, SCIM and MDM/SCEP", () => {
    expect(rateLimitRuleFor(request("/api/v1/signIn", { method: "POST" }))?.bucket).toBe("auth");
    expect(rateLimitRuleFor(request("/api/v1/signIn", { method: "GET" }))).toBeUndefined();
    expect(rateLimitRuleFor(request("/api/v1/enrollment/abc"))?.bucket).toBe("enrollment");
    expect(rateLimitRuleFor(request("/api/v1/billing/webhook", { method: "POST" }))?.bucket).toBe(
      "billing",
    );
    expect(rateLimitRuleFor(request("/scim/v2/org/Users"))?.bucket).toBe("scim");
    expect(rateLimitRuleFor(request("/mdm/apple/mdm", { method: "PUT" }))?.bucket).toBe("mdm");
    expect(rateLimitRuleFor(request("/mdm/apple/scep"))?.bucket).toBe("scep");
    expect(rateLimitRuleFor(request("/api/v1/me", { method: "POST" }))).toBeUndefined();
  });

  it("prefers the connecting IP for the limiter key", () => {
    expect(
      clientKey(
        request("/api/v1/signIn", {
          headers: { "cf-connecting-ip": "203.0.113.4", "x-forwarded-for": "198.51.100.9" },
        }),
      ),
    ).toBe("203.0.113.4");
    expect(
      clientKey(
        request("/api/v1/signIn", { headers: { "x-forwarded-for": "198.51.100.9, 10.0.0.1" } }),
      ),
    ).toBe("198.51.100.9");
    expect(clientKey(request("/api/v1/signIn"))).toBe("local");
  });
});

describe("per-isolate fallback limiter", () => {
  it("allows up to the limit and then returns Retry-After", async () => {
    let now = 1_000;
    const limiter = makeRateLimiter({ now: () => now });
    const req = () =>
      request("/api/v1/signIn", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.4" },
      });

    for (let index = 0; index < 120; index++) {
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
    const limiter = makeRateLimiter({ now: () => 1_000 });
    const ipA = request("/api/v1/enrollment/a", {
      headers: { "cf-connecting-ip": "203.0.113.4" },
    });
    const ipB = request("/api/v1/enrollment/a", {
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
    const limiter = makeRateLimiter();
    const outcome = await limiter.check(
      request("/api/v1/signIn", {
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
    const limiter = makeRateLimiter({
      now: () => 1_000,
      warn: (message) => warnings.push(message),
    });
    const outcome = await limiter.check(request("/api/v1/enrollment/a"), bindings);
    expect(outcome.limited).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("local fallback");
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
