import { describe, expect, it } from "vitest";
import { recorder } from "../../config/testing/recorder.ts";
import { createAppleByodRateLimiter } from "../src/appleByodRateLimit.js";
import type { AppleByodRateLimiterOptions } from "../src/appleByodRateLimit.js";

/** Delegate to the original Map method while recording calls for assertions. */
const recordMapMethod = <Args extends unknown[], R>(
  original: (this: Map<any, any>, ...args: Args) => R,
) => {
  let receiver: Map<any, any>;
  const record = recorder<Args, R>((...args) => original.apply(receiver, args));
  const spy = function (this: Map<any, any>, ...args: Args): R {
    receiver = this;

    return record(...args);
  };

  return Object.assign(spy, { calls: record.calls });
};

const makeLimiter = (options: Omit<AppleByodRateLimiterOptions, "now"> = {}) => {
  let time = 1_000_000;
  const limiter = createAppleByodRateLimiter({ ...options, now: () => time });

  return {
    limiter,
    advance: (millis: number) => {
      time += millis;
    },
  };
};

const verifiedHeaders = (address: string, spoofedAddress: string) => ({
  "x-mattrax-client-address": address,
  "cf-connecting-ip": spoofedAddress,
  "x-forwarded-for": spoofedAddress,
});

describe("Apple BYOD rate limiter", () => {
  it("keys only from the verified address and never from spoofable headers", () => {
    const { limiter } = makeLimiter();

    for (let index = 0; index < 30; index += 1) {
      expect(limiter.allow(verifiedHeaders("203.0.113.10", `198.51.100.${index + 1}`))).toBe(true);
    }

    expect(limiter.size()).toBe(1);
    expect(limiter.allow(verifiedHeaders("203.0.113.10", "198.51.100.200"))).toBe(false);
    expect(limiter.allow(verifiedHeaders("203.0.113.11", "203.0.113.10"))).toBe(true);
    expect(limiter.size()).toBe(2);
  });

  it("fails closed in one shared bucket when no verified address is available", () => {
    const { limiter } = makeLimiter();

    for (let index = 0; index < 30; index += 1) {
      expect(
        limiter.allow({
          "cf-connecting-ip": `198.51.100.${index + 1}`,
          "x-forwarded-for": `10.0.0.${index + 1}`,
          "x-mattrax-client-address": index % 2 === 0 ? "   " : undefined,
        }),
      ).toBe(true);
    }

    expect(limiter.size()).toBe(1);
    expect(
      limiter.allow({
        "cf-connecting-ip": "198.51.100.200",
        "x-forwarded-for": "10.0.0.200",
      }),
    ).toBe(false);
    expect(limiter.size()).toBe(1);
  });

  it("expires counts after the TTL without rejected requests extending it", () => {
    const { limiter, advance } = makeLimiter();
    const headers = verifiedHeaders("203.0.113.10", "198.51.100.10");

    for (let index = 0; index < 30; index += 1) expect(limiter.allow(headers)).toBe(true);

    expect(limiter.allow(headers)).toBe(false);
    advance(59_999);
    expect(limiter.allow(headers)).toBe(false);
    advance(1);
    expect(limiter.allow(headers)).toBe(true);
    expect(limiter.size()).toBe(1);
  });

  it("hard-caps new counts without evicting and resetting a live client", () => {
    const { limiter, advance } = makeLimiter({ limit: 2, maxEntries: 2 });
    const first = verifiedHeaders("203.0.113.10", "198.51.100.10");
    const second = verifiedHeaders("203.0.113.11", "198.51.100.11");
    const third = verifiedHeaders("203.0.113.12", "198.51.100.12");

    expect(limiter.allow(first)).toBe(true);
    expect(limiter.allow(second)).toBe(true);
    expect(limiter.allow(third)).toBe(false);
    expect(limiter.size()).toBe(2);
    expect(limiter.allow(first)).toBe(true);
    expect(limiter.allow(first)).toBe(false);
    expect(limiter.size()).toBe(2);

    advance(61_000);
    expect(limiter.allow(third)).toBe(true);
    expect(limiter.size()).toBe(1);
  });

  it("bounds memory and expires whole buckets without iterating client maps", () => {
    const { limiter, advance } = makeLimiter({ limit: 1 });
    const originalIterator = Map.prototype[Symbol.iterator];
    const originalKeys = Map.prototype.keys;
    const originalForEach = Map.prototype.forEach;
    const mapIterator = recordMapMethod(originalIterator);
    const mapKeys = recordMapMethod(originalKeys);
    const mapForEach = recordMapMethod(originalForEach);

    Map.prototype[Symbol.iterator] = mapIterator as typeof originalIterator;
    Map.prototype.keys = mapKeys as typeof originalKeys;
    Map.prototype.forEach = mapForEach as typeof originalForEach;
    let sizeAtCap = 0;
    let overflowAllowed = true;
    let sizeAfterExpiry = 0;
    let allowedAfterExpiry = false;
    let allAllowed = true;

    try {
      for (let index = 0; index < 10_000; index += 1) {
        const address = `198.51.${Math.floor(index / 256)}.${index % 256}`;

        allAllowed = allAllowed && limiter.allow(verifiedHeaders(address, "198.51.100.10"));
      }

      sizeAtCap = limiter.size();
      overflowAllowed = limiter.allow(verifiedHeaders("203.0.113.200", "198.51.100.200"));
      advance(61_000);
      allowedAfterExpiry = limiter.allow(verifiedHeaders("203.0.113.200", "198.51.100.200"));
      sizeAfterExpiry = limiter.size();
    } finally {
      Map.prototype[Symbol.iterator] = originalIterator;
      Map.prototype.keys = originalKeys;
      Map.prototype.forEach = originalForEach;
    }

    expect(allAllowed).toBe(true);
    expect(sizeAtCap).toBe(10_000);
    expect(overflowAllowed).toBe(false);
    expect(allowedAfterExpiry).toBe(true);
    expect(sizeAfterExpiry).toBe(1);
    expect(mapIterator.calls).toHaveLength(0);
    expect(mapKeys.calls).toHaveLength(0);
    expect(mapForEach.calls).toHaveLength(0);
  });

  it("counts concurrent requests exactly once up to the limit", async () => {
    const { limiter } = makeLimiter();
    const headers = verifiedHeaders("203.0.113.10", "198.51.100.10");
    const results = await Promise.all(
      Array.from({ length: 100 }, () => Promise.resolve().then(() => limiter.allow(headers))),
    );

    expect(results.filter(Boolean)).toHaveLength(30);
    expect(results.filter((allowed) => !allowed)).toHaveLength(70);
    expect(limiter.size()).toBe(1);
  });
});
