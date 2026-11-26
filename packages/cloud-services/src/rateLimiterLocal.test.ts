import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { RateLimiter, check } from "./rateLimit.js";
import { RateLimiterLocal } from "./rateLimiterLocal.js";
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

describe("self-hosted rate limiter", () => {
  it("allows the last request in a window and then returns Retry-After", async () => {
    let now = 1_000;
    const store: RateLimitStore = new Map([["auth:203.0.113.4", { count: 599, resetAt: 61_000 }]]);
    const layer = RateLimiterLocal({ store, now: () => now });

    expect(await runCheck(layer, signIn())).toEqual({
      limited: false,
      bucket: "auth",
      limit: 600,
      retryAfterSeconds: 0,
    });
    now += 10;

    expect(await runCheck(layer, signIn())).toEqual({
      limited: true,
      bucket: "auth",
      limit: 600,
      retryAfterSeconds: 60,
    });

    // A new window resets the counter.
    now = 61_001;
    expect(await runCheck(layer, signIn())).toEqual({
      limited: false,
      bucket: "auth",
      limit: 600,
      retryAfterSeconds: 0,
    });
  });

  it("keeps buckets and clients independent", async () => {
    const store: RateLimitStore = new Map([
      ["enrollment:203.0.113.4", { count: 600, resetAt: 61_000 }],
    ]);
    const layer = RateLimiterLocal({ store, now: () => 1_000 });

    const ipA = cloudflareRequest("/api/v1/enrollment/a", {
      headers: { "cf-connecting-ip": "203.0.113.4" },
    });
    const ipB = cloudflareRequest("/api/v1/enrollment/a", {
      headers: { "cf-connecting-ip": "198.51.100.9" },
    });

    expect((await runCheck(layer, ipA)).limited).toBe(true);
    expect((await runCheck(layer, ipB)).limited).toBe(false);
  });

  it("does not charge requests that no rule covers", async () => {
    const store: RateLimitStore = new Map();
    const layer = RateLimiterLocal({ store });

    const outcome = await runCheck(layer, request("/api/v1/me"));

    expect(outcome.limited).toBe(false);
    expect(store.size).toBe(0);
  });

  it("trusts forwarded headers only when the deployment opts in", async () => {
    const forwarded = (address: string) =>
      request("/api/v1/enrollment/a", { headers: { "x-forwarded-for": address } });
    const store: RateLimitStore = new Map([
      ["enrollment:198.51.100.9", { count: 600, resetAt: 61_000 }],
      ["enrollment:local", { count: 600, resetAt: 61_000 }],
    ]);

    const trusted = RateLimiterLocal({ store, now: () => 1_000, trustForwarded: true });

    expect((await runCheck(trusted, forwarded("198.51.100.9"))).limited).toBe(true);
    expect((await runCheck(trusted, forwarded("203.0.113.4"))).limited).toBe(false);

    // Without the opt-in both callers share the blunt `local` key: one bucket,
    // which is spoof-proof even though it is coarse.
    const untrusted = RateLimiterLocal({ store, now: () => 1_000 });

    expect((await runCheck(untrusted, forwarded("198.51.100.9"))).limited).toBe(true);
    expect((await runCheck(untrusted, forwarded("203.0.113.4"))).limited).toBe(true);
  });
});
