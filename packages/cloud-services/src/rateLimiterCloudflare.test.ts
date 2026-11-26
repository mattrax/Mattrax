import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { RateLimiter, check } from "./rateLimit.js";
import type { RateLimitBindings } from "./rateLimit.js";
import { RateLimiterCloudflare } from "./rateLimiterCloudflare.js";
import type { RateLimitStore } from "./rateLimiterLocal.js";

const request = (path: string, init: RequestInit = {}) =>
  new Request(`https://e.mattrax.app${path}`, init);

/** A request shaped like one received by a Cloudflare Worker. */
const cloudflareRequest = (path: string, init: RequestInit = {}) => {
  const req = request(path, init);

  Object.defineProperty(req, "cf", { value: {} });

  return req;
};

const runCheck = (layer: Layer.Layer<RateLimiter>, req: Request) =>
  Effect.runPromise(check(req).pipe(Effect.provide(layer)));

const signIn = () =>
  cloudflareRequest("/api/v1/completePasskeySignIn", {
    method: "POST",
    headers: { "cf-connecting-ip": "203.0.113.4" },
  });

const unavailable = {
  limit: async () => {
    throw new Error("binding unavailable");
  },
};

describe("Cloudflare rate limiter", () => {
  it("uses the shared binding when one is configured", async () => {
    const keys: string[] = [];

    const bindings: RateLimitBindings = {
      auth: {
        limit: async ({ key }) => {
          keys.push(key);

          return { success: false };
        },
      },
    };

    const outcome = await runCheck(RateLimiterCloudflare({ bindings }), signIn());

    expect(outcome.limited).toBe(true);
    expect(outcome.retryAfterSeconds).toBe(60);
    expect(keys).toEqual(["auth:203.0.113.4"]);
  });

  it("allows a request the binding accepts", async () => {
    const bindings: RateLimitBindings = { auth: { limit: async () => ({ success: true }) } };

    expect((await runCheck(RateLimiterCloudflare({ bindings }), signIn())).limited).toBe(false);
  });

  it("selects the MDM bucket binding", async () => {
    const seen: string[] = [];

    const bindings: RateLimitBindings = {
      mdm: {
        limit: async ({ key }) => {
          seen.push(key);

          return { success: true };
        },
      },
    };

    await runCheck(
      RateLimiterCloudflare({ bindings }),
      request("/mdm/apple/mdm", { method: "PUT" }),
    );

    expect(seen).toEqual(["mdm:local"]);
  });

  it("selects the SCIM bucket binding", async () => {
    const seen: string[] = [];

    const bindings: RateLimitBindings = {
      scim: {
        limit: async ({ key }) => {
          seen.push(key);

          return { success: true };
        },
      },
    };

    await runCheck(RateLimiterCloudflare({ bindings }), request("/scim/v2/org/Users"));

    expect(seen).toEqual(["scim:local"]);
  });

  it("selects the billing bucket binding", async () => {
    const seen: string[] = [];

    const bindings: RateLimitBindings = {
      billing: {
        limit: async ({ key }) => {
          seen.push(key);

          return { success: true };
        },
      },
    };

    await runCheck(
      RateLimiterCloudflare({ bindings }),
      request("/api/v1/billing/webhook", { method: "POST" }),
    );

    expect(seen).toEqual(["billing:local"]);
  });

  it("selects the SCEP bucket binding", async () => {
    const seen: string[] = [];

    const bindings: RateLimitBindings = {
      scep: {
        limit: async ({ key }) => {
          seen.push(key);

          return { success: true };
        },
      },
    };

    await runCheck(RateLimiterCloudflare({ bindings }), request("/mdm/apple/scep"));

    expect(seen).toEqual(["scep:local"]);
  });

  it("falls back locally when the edge limiter throws", async () => {
    const warnings: string[] = [];

    const layer = RateLimiterCloudflare({
      bindings: { enrollment: unavailable },
      now: () => 1_000,
      warn: (message) => warnings.push(message),
    });

    expect((await runCheck(layer, request("/api/v1/enrollment/a"))).limited).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("local fallback");
  });

  it("fails closed when the auth edge limiter is configured but unavailable", async () => {
    const warnings: string[] = [];
    const store: RateLimitStore = new Map();

    const layer = RateLimiterCloudflare({
      bindings: { auth: unavailable },
      store,
      now: () => 1_000,
      warn: (message) => warnings.push(message),
    });

    const outcome = await runCheck(layer, signIn());

    expect(outcome).toMatchObject({
      limited: true,
      bucket: "auth",
      limit: 600,
      retryAfterSeconds: 60,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("failing closed");

    // The failed closed request must not have charged the local counter: a
    // recovered binding (or another credential route) is not penalised by the
    // outage itself.
    expect(store.size).toBe(0);
  });

  it("treats a malformed binding result as unavailable", async () => {
    const warnings: string[] = [];

    const layer = RateLimiterCloudflare({
      // SAFETY: the test proves the limiter refuses an unexpected result shape.
      bindings: { auth: { limit: async () => ({}) } } as any,
      now: () => 1_000,
      warn: (message) => warnings.push(message),
    });

    expect((await runCheck(layer, signIn())).limited).toBe(true);
    expect(warnings[0]).toContain("failing closed");
  });

  it("fails closed for MCP token exchange when the edge limiter is unavailable", async () => {
    const layer = RateLimiterCloudflare({
      bindings: { auth: unavailable },
      warn: () => {},
    });

    const outcome = await runCheck(layer, request("/api/oauth/token", { method: "POST" }));

    expect(outcome.limited).toBe(true);
    expect(outcome.bucket).toBe("auth");
  });

  it("keeps the local ceiling for buckets with no namespace", async () => {
    const store: RateLimitStore = new Map([["auth:203.0.113.4", { count: 599, resetAt: 61_000 }]]);

    // Local development has no namespace at all; it must keep working up to
    // the documented per-isolate ceiling instead of failing open or closed.
    const layer = RateLimiterCloudflare({ bindings: {}, store, now: () => 1_000 });

    expect((await runCheck(layer, signIn())).limited).toBe(false);
    expect((await runCheck(layer, signIn())).limited).toBe(true);
  });
});
