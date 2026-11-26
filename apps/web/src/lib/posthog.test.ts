import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "mattrax.posthog";

/**
 * Browser globals are the thing under test here (pagehide, visibilitychange,
 * localStorage coalescing), so they are stubbed. The recorders are plain
 * functions rather than Vitest mocks: this module has no injectable ports, and
 * adding one would be a rewrite of its whole lifecycle.
 */
const setupBrowser = () => {
  const stored = new Map<string, string>();
  const writes: Array<{ key: string; value: string }> = [];
  const localStorage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push({ key, value });
      stored.set(key, value);
    },
  };
  const windowListeners = new Map<string, () => void>();
  const window = {
    __MATTRAX_POSTHOG__: { key: "test-key", host: "https://analytics.example" },
    addEventListener: (event: string, listener: () => void) => windowListeners.set(event, listener),
  };
  const document = {
    referrer: "",
    visibilityState: "visible",
    addEventListener: (_event: string, _listener: () => void) => undefined,
  };
  const beacons: Blob[] = [];
  const sendBeacon = (_url: string, data: Blob) => {
    beacons.push(data);

    return true;
  };
  const requests: RequestInit[] = [];
  let nextFetch: (() => Promise<Response>) | undefined;
  const fetch = (_input: RequestInfo | URL, init: RequestInit = {}) => {
    requests.push(init);

    return nextFetch?.() ?? Promise.resolve({ ok: true } as Response);
  };

  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("location", {
    href: "https://mattrax.example/t/tenant-1",
    pathname: "/t/tenant-1",
    origin: "https://mattrax.example",
  });
  vi.stubGlobal("navigator", { sendBeacon });
  vi.stubGlobal("fetch", fetch);

  return {
    stored,
    writes,
    windowListeners,
    beacons,
    requests,
    deferNextFetch: () => {
      let reject!: (error: Error) => void;
      nextFetch = () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise;
        });

      return (error: Error) => reject(error);
    },
  };
};

describe("PostHog persistence and lifecycle delivery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("coalesces event-time writes and flushes the latest session on pagehide", async () => {
    const browser = setupBrowser();
    const posthog = await import("./posthog");

    expect(await posthog.initPostHog(false)).toBe(true);
    expect(browser.writes).toHaveLength(1);

    for (let index = 0; index < 5; index++) posthog.capturePostHog(`click-${index}`);
    expect(browser.writes).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(browser.writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(browser.writes).toHaveLength(2);

    browser.windowListeners.get("pagehide")?.();
    await Promise.resolve();
    expect(browser.writes).toHaveLength(3);
    expect(browser.beacons).toHaveLength(1);

    const persisted = JSON.parse(browser.stored.get(STORAGE_KEY) ?? "{}");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    expect(persisted.distinctId).toEqual(expect.stringMatching(uuid));
    expect(persisted.sessionId).toEqual(expect.stringMatching(uuid));
    // Five capture calls advanced the fake clock by 5s before the flush.
    expect(persisted.activeAt).toBe(Date.parse("2026-11-01T00:00:00Z") + 5_000);
  });

  it("beacons pageleave while a normal send is pending, then retries the rejected normal batch", async () => {
    const browser = setupBrowser();
    const rejectNormal = browser.deferNextFetch();
    const posthog = await import("./posthog");

    await posthog.initPostHog(false);
    posthog.capturePostHog("normal-event");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(browser.requests).toHaveLength(1);

    browser.windowListeners.get("pagehide")?.();
    expect(browser.beacons).toHaveLength(1);
    const payload = JSON.parse(await browser.beacons[0]!.text());
    expect(payload.batch.map((event: { event: string }) => event.event)).toEqual(["$pageleave"]);

    rejectNormal(new Error("normal send rejected during unload"));
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(browser.requests).toHaveLength(2);
    const retryPayload = JSON.parse(String(browser.requests[1]!.body));
    expect(retryPayload.batch.map((event: { event: string }) => event.event)).toEqual([
      "normal-event",
    ]);
  });
});
