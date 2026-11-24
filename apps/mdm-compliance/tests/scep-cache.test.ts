import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { ScepCaCache } from "../src/harness/scep.ts";
import type { ScepCaFixture } from "../src/fixtures/pki.ts";

const fixture = { certPem: "fixture" } as ScepCaFixture;

describe("SCEP CA fixture cache", () => {
  it("shares one successful fixture within a scope", async () => {
    let calls = 0;
    const layer = ScepCaCache.layer(async () => {
      calls++;

      return fixture;
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const cache = yield* ScepCaCache;

        expect(yield* cache.get).toBe(fixture);
        expect(yield* cache.get).toBe(fixture);
      }).pipe(Effect.provide(layer)),
    );

    expect(calls).toBe(1);
  });

  it("does not cache a transient fixture failure", async () => {
    let calls = 0;
    const layer = ScepCaCache.layer(async () => {
      calls++;

      if (calls === 1) throw new Error("temporary fixture failure");

      return fixture;
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const cache = yield* ScepCaCache;

        expect(Exit.isFailure(yield* Effect.exit(cache.get))).toBe(true);
        expect(yield* cache.get).toBe(fixture);
      }).pipe(Effect.provide(layer)),
    );

    expect(calls).toBe(2);
  });

  it("creates a fresh cache for each scope", async () => {
    let calls = 0;
    const layer = ScepCaCache.layer(async () => {
      calls++;

      return fixture;
    });
    const program = Effect.gen(function* () {
      const cache = yield* ScepCaCache;

      yield* cache.get;
    });

    await Effect.runPromise(program.pipe(Effect.provide(layer)));
    await Effect.runPromise(program.pipe(Effect.provide(layer)));

    expect(calls).toBe(2);
  });
});
