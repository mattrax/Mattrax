import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const sendBeacon = vi.fn(() => true);

  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("location", {
    href: "https://mattrax.example/t/tenant-1",
    pathname: "/t/tenant-1",
    origin: "https://mattrax.example",
  });
  vi.stubGlobal("navigator", { sendBeacon });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

  return { stored, setItem, windowListeners, sendBeacon };
};

describe("PostHog identity persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
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
    expect(persisted.distinctId).toEqual(expect.any(String));
    expect(persisted.sessionId).toEqual(expect.any(String));
    expect(persisted.activeAt).toEqual(expect.any(Number));
  });
});
