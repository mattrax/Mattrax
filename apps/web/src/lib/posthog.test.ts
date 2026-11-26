import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Under Vitest SSR resolution @solidjs/web resolves to its server build, where
// isServer is a constant true; the browser client needs the web build.
vi.mock("@solidjs/web", () => ({ isServer: false }));

const STORAGE_KEY = "mattrax.posthog";

const setupBrowser = () => {
  const stored = new Map<string, string>();
  const setItem = vi.fn((key: string, value: string) => stored.set(key, value));
  const localStorage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem,
  };
  const windowListeners = new Map<string, () => void>();
  const window = {
    __MATTRAX_POSTHOG__: { key: "test-key", host: "https://analytics.example" },
    addEventListener: (event: string, listener: () => void) => windowListeners.set(event, listener),
  };
  const document = {
    referrer: "",
    visibilityState: "visible",
    addEventListener: vi.fn(),
  };
  const sendBeacon = vi.fn((_url: string, _data: Blob) => true);
  const fetch = vi.fn().mockResolvedValue({ ok: true });

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

  return { stored, setItem, windowListeners, sendBeacon, fetch };
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

    expect(await posthog.initPostHog()).toBe(true);
    expect(browser.setItem).toHaveBeenCalledTimes(1);

    for (let index = 0; index < 5; index++) posthog.capturePostHog(`click-${index}`);
    expect(browser.setItem).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(browser.setItem).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(browser.setItem).toHaveBeenCalledTimes(2);

    browser.windowListeners.get("pagehide")?.();
    await Promise.resolve();
    expect(browser.setItem).toHaveBeenCalledTimes(3);
    expect(browser.sendBeacon).toHaveBeenCalledOnce();

    const persisted = JSON.parse(browser.stored.get(STORAGE_KEY) ?? "{}");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    expect(persisted.distinctId).toEqual(expect.stringMatching(uuid));
    expect(persisted.sessionId).toEqual(expect.stringMatching(uuid));
    // Five capture calls advanced the fake clock by 5s before the flush.
    expect(persisted.activeAt).toBe(Date.parse("2026-11-01T00:00:00Z") + 5_000);
  });

  it("beacons pageleave while a normal send is pending, then retries the rejected normal batch", async () => {
    const browser = setupBrowser();
    let rejectNormal: ((error: Error) => void) | undefined;
    browser.fetch.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectNormal = reject;
        }),
    );
    const posthog = await import("./posthog");

    await posthog.initPostHog();
    posthog.capturePostHog("normal-event");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(browser.fetch).toHaveBeenCalledTimes(1);

    browser.windowListeners.get("pagehide")?.();
    expect(browser.sendBeacon).toHaveBeenCalledOnce();
    const beacon = browser.sendBeacon.mock.calls[0]?.[1] as Blob;
    const payload = JSON.parse(await beacon.text());
    expect(payload.batch.map((event: { event: string }) => event.event)).toEqual(["$pageleave"]);

    rejectNormal?.(new Error("normal send rejected during unload"));
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(browser.fetch).toHaveBeenCalledTimes(2);
    const retry = browser.fetch.mock.calls[1]?.[1] as RequestInit;
    const retryPayload = JSON.parse(String(retry.body));
    expect(retryPayload.batch.map((event: { event: string }) => event.event)).toEqual([
      "normal-event",
    ]);
  });
});
