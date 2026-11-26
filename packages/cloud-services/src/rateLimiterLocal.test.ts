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
  it("allows up to the limit and then returns Retry-After", async () => {
    let now = 1_000;
    const layer = RateLimiterLocal({ now: () => now });

    for (let index = 0; index < 600; index++) {
      expect((await runCheck(layer, signIn())).limited).toBe(false);
      now += 10;
    }

    const blocked = await runCheck(layer, signIn());
    expect(blocked.limited).toBe(true);
    expect(blocked.bucket).toBe("auth");
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // A new window resets the counter.
    now += 60_000;
    expect((await runCheck(layer, signIn())).limited).toBe(false);
  });

  it("keeps buckets and clients independent", async () => {
    const layer = RateLimiterLocal({ now: () => 1_000 });

    const ipA = cloudflareRequest("/api/v1/enrollment/a", {
      headers: { "cf-connecting-ip": "203.0.113.4" },
    });

    const ipB = cloudflareRequest("/api/v1/enrollment/a", {
      headers: { "cf-connecting-ip": "198.51.100.9" },
    });

    for (let index = 0; index < 600; index++) await runCheck(layer, ipA);
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

    // A proxy that appends the address it saw must be declared, not guessed.
    const trusted = RateLimiterLocal({ now: () => 1_000, trustForwarded: true });

    for (let index = 0; index < 600; index++) await runCheck(trusted, forwarded("198.51.100.9"));
    expect((await runCheck(trusted, forwarded("198.51.100.9"))).limited).toBe(true);
    expect((await runCheck(trusted, forwarded("203.0.113.4"))).limited).toBe(false);

    // Without the opt-in both callers share the blunt `local` key: one bucket,
    // which is spoof-proof even though it is coarse.
    const untrusted = RateLimiterLocal({ now: () => 1_000 });

    for (let index = 0; index < 600; index++) await runCheck(untrusted, forwarded("198.51.100.9"));
    expect((await runCheck(untrusted, forwarded("203.0.113.4"))).limited).toBe(true);
  });
});
