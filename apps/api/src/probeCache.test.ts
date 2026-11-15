import { describe, expect, it } from "vitest";
import { createProbeCache } from "./probeCache.js";

describe("readiness probe cache", () => {
  it("probes once and serves the cached result inside the window", async () => {
    let now = 1_000;
    let calls = 0;
    const cache = createProbeCache<string>(30_000, () => now);

    const probe = async () => {
      calls++;

      return "ok";
    };

    await expect(cache.get(probe)).resolves.toBe("ok");
    now += 1_000;
    await expect(cache.get(probe)).resolves.toBe("ok");
    now += 28_999;
    await expect(cache.get(probe)).resolves.toBe("ok");

    expect(calls).toBe(1);
  });

  it("probes again once the window expires", async () => {
    let now = 1_000;
    let calls = 0;
    const cache = createProbeCache<string>(30_000, () => now);

    const probe = async () => {
      calls++;

      return `ok-${calls}`;
    };

    await cache.get(probe);
    now += 30_000;

    await expect(cache.get(probe)).resolves.toBe("ok-2");
    expect(calls).toBe(2);
  });

  it("shares one probe between concurrent polls", async () => {
    let calls = 0;
    const cache = createProbeCache<string>(30_000, () => 1_000);

    const probe = async () => {
      calls++;
      await Promise.resolve();

      return "ok";
    };

    const results = await Promise.all([cache.get(probe), cache.get(probe), cache.get(probe)]);

    expect(results).toEqual(["ok", "ok", "ok"]);
    expect(calls).toBe(1);
  });

  it("caches a rejection for the window so a broken dependency is not hammered", async () => {
    let now = 1_000;
    let calls = 0;
    const cache = createProbeCache<string>(30_000, () => now);

    const probe = async () => {
      calls++;

      throw new Error("storage unavailable");
    };

    await expect(cache.get(probe)).rejects.toThrow("storage unavailable");
    await expect(cache.get(probe)).rejects.toThrow("storage unavailable");
    expect(calls).toBe(1);

    now += 30_000;
    await expect(cache.get(probe)).rejects.toThrow("storage unavailable");
    expect(calls).toBe(2);
  });

  it("forgets the memo when cleared", async () => {
    let calls = 0;
    const cache = createProbeCache<string>(30_000, () => 1_000);

    const probe = async () => {
      calls++;

      return "ok";
    };

    await cache.get(probe);
    cache.clear();
    await cache.get(probe);

    expect(calls).toBe(2);
  });
});
