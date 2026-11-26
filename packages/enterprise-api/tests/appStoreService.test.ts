import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makeApplicationStoreService } from "../src/appStore.js";

describe("application store service", () => {
  it("uses the injected bounded client and prefers the bundle id", async () => {
    const calls: Array<string> = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);

      return new Response(
        JSON.stringify({
          resultCount: 1,
          results: [
            {
              wrapperType: "software",
              trackId: 123,
              trackName: "Example",
              bundleId: "com.example.app",
              version: "1.2.3",
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;
    const service = makeApplicationStoreService({ fetch: fetchImpl, timeoutMs: 100 });

    const outcome = await Effect.runPromise(
      service.lookup({ region: "gb", bundleId: "com.example.app", storeId: "999" }),
    );

    expect(outcome).toMatchObject({
      ok: true,
      lookup: { found: true, region: "GB", storeId: "123", bundleId: "com.example.app" },
    });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!).searchParams.get("country")).toBe("gb");
    expect(new URL(calls[0]!).searchParams.get("bundleId")).toBe("com.example.app");
    expect(new URL(calls[0]!).searchParams.has("id")).toBe(false);
  });

  it("turns a stalled injected transport into a bounded failure", async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      })) as typeof globalThis.fetch;
    const service = makeApplicationStoreService({ fetch: fetchImpl, timeoutMs: 10 });

    const outcome = await Effect.runPromise(
      service.lookup({ region: "US", bundleId: "com.example.app" }),
    );

    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.ok ? undefined : outcome.error).toContain("timed out");
  });

  it("does not dispatch a lookup without an App Store identity", async () => {
    let calls = 0;
    const service = makeApplicationStoreService({
      fetch: (async () => {
        calls++;

        return new Response("{}");
      }) as typeof globalThis.fetch,
    });

    const outcome = await Effect.runPromise(service.lookup({ region: "US" }));

    expect(outcome).toMatchObject({ ok: false });
    expect(calls).toBe(0);
  });
});
