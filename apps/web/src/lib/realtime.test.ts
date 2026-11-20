import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "@mattrax/enterprise-domain/client";
import { enterpriseKeys } from "~/lib/enterprise";
import {
  REALTIME_FALLBACK_POLL_MS,
  REALTIME_MAX_DEVICES_PER_FLUSH,
  REALTIME_RETRY_MAX_MS,
  collectRealtimeTargets,
  createRealtimeInvalidator,
  decodeRealtimeEvent,
  realtimeKeysForEvents,
  realtimeRetryDelay,
  startTenantRealtime,
} from "./realtime";

const tenantId = "tenant-1";

const at = "2026-06-01T12:00:00.000Z";

const event = (overrides: Partial<RealtimeEvent> = {}): RealtimeEvent => ({
  seq: 1,
  kind: "device.checkin",
  deviceId: "device-a",
  protocol: "apple",
  at,
  ...overrides,
});

const fakeClient = () => ({
  invalidateQueries: vi.fn(
    async (_input: { queryKey?: readonly unknown[]; refetchType?: string }) => undefined,
  ),
});

describe("realtimeRetryDelay", () => {
  it("starts at 0.5–1s and grows", () => {
    const first = realtimeRetryDelay(0, () => 0);
    const second = realtimeRetryDelay(1, () => 0);
    const third = realtimeRetryDelay(2, () => 0);

    expect(first).toBe(500);
    expect(second).toBe(1_000);
    expect(third).toBe(2_000);
  });

  it("never exceeds the cap", () => {
    for (const attempt of [8, 16, 64, 1_000]) {
      const delay = realtimeRetryDelay(attempt, () => 1);

      expect(delay).toBeLessThanOrEqual(REALTIME_RETRY_MAX_MS);
      expect(delay).toBeGreaterThan(0);
    }
  });

  it("applies jitter inside the 50–100% band", () => {
    expect(realtimeRetryDelay(3, () => 0)).toBe(4_000);
    expect(realtimeRetryDelay(3, () => 1)).toBe(8_000);
  });

  it("treats a negative or nonsense attempt as the first retry", () => {
    expect(realtimeRetryDelay(-4, () => 0)).toBe(500);
    expect(realtimeRetryDelay(Number.NaN, () => 0)).toBe(500);
  });
});

describe("collectRealtimeTargets", () => {
  it("collapses a check-in storm for one device", () => {
    const targets = collectRealtimeTargets(
      Array.from({ length: 100 }, (_, index) => event({ seq: index + 1 })),
    );

    expect(targets).toEqual({
      tenantWide: false,
      deviceIds: ["device-a"],
      scopes: ["device", "fleet", "activity"],
    });
  });

  it("falls back to one tenant-wide pass above the device cap", () => {
    const events = Array.from({ length: REALTIME_MAX_DEVICES_PER_FLUSH + 1 }, (_, index) =>
      event({ seq: index + 1, deviceId: `device-${index}` }),
    );

    expect(collectRealtimeTargets(events).tenantWide).toBe(true);
  });

  it("is tenant-wide when an event carries no device", () => {
    expect(collectRealtimeTargets([event({ deviceId: null })]).tenantWide).toBe(true);
  });

  it("unions scopes across kinds", () => {
    const targets = collectRealtimeTargets([
      event({ kind: "device.enrolled", deviceId: "device-a" }),
      event({ kind: "device.command", deviceId: "device-b" }),
    ]);

    expect([...targets.deviceIds].sort()).toEqual(["device-a", "device-b"]);
    expect(targets.scopes).toEqual(
      expect.arrayContaining(["device", "fleet", "activity", "enrollment", "commands"]),
    );
  });
});

describe("realtimeKeysForEvents", () => {
  it("maps a device event to that tenant's device and fleet keys", () => {
    const keys = realtimeKeysForEvents(tenantId, [event()]);

    expect(keys).toContainEqual(enterpriseKeys.item(tenantId, "device", "device-a"));
    expect(keys).toContainEqual(enterpriseKeys.deviceSearchPrefix(tenantId));
    expect(keys).toContainEqual(enterpriseKeys.deviceHealthSummary(tenantId));
    expect(keys).toContainEqual(enterpriseKeys.deviceActivity(tenantId, "device-a"));
  });

  it("never produces a key for another tenant", () => {
    for (const key of realtimeKeysForEvents(tenantId, [event()]))
      expect(key.includes("tenant-2")).toBe(false);
  });

  it("uses prefixes, not per-device keys, for a tenant-wide burst", () => {
    const keys = realtimeKeysForEvents(tenantId, [event({ deviceId: null })]);

    expect(keys).toContainEqual(["enterprise", "item", tenantId, "device"]);
    expect(keys).toContainEqual(["enterprise", "device-health", tenantId]);
    // No concrete device id is present because there is none to invalidate.
    expect(keys.some((key) => key.includes("device-a"))).toBe(false);
  });
});

describe("createRealtimeInvalidator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces a burst into one invalidation per key", () => {
    const client = fakeClient();

    const invalidator = createRealtimeInvalidator(client, tenantId, {
      debounceMs: 100,
    });

    for (let index = 0; index < 25; index++) invalidator.push(event({ seq: index + 1 }));

    expect(client.invalidateQueries).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    const calls = client.invalidateQueries.mock.calls.map(([input]) => input);

    expect(calls).toContainEqual({
      queryKey: enterpriseKeys.item(tenantId, "device", "device-a"),
      refetchType: "active",
    });
    // A repeated device does not produce repeated calls for the same key.
    expect(
      calls.filter(
        (input) =>
          JSON.stringify(input?.queryKey) ===
          JSON.stringify(enterpriseKeys.item(tenantId, "device", "device-a")),
      ),
    ).toHaveLength(1);
  });

  it("stops scheduling after dispose", () => {
    const client = fakeClient();

    const invalidator = createRealtimeInvalidator(client, tenantId, {
      debounceMs: 100,
    });

    invalidator.push(event());
    invalidator.dispose();
    vi.advanceTimersByTime(1_000);

    expect(client.invalidateQueries).not.toHaveBeenCalled();
  });

  it("invalidateAll refreshes every realtime family once", () => {
    const client = fakeClient();

    const invalidator = createRealtimeInvalidator(client, tenantId, {
      debounceMs: 1,
    });

    invalidator.invalidateAll();

    const calls = client.invalidateQueries.mock.calls.map(([input]) => input);

    expect(calls).toContainEqual({
      queryKey: enterpriseKeys.deviceSearchPrefix(tenantId),
      refetchType: "active",
    });
    expect(calls).toContainEqual({
      queryKey: ["enterprise", "item", tenantId, "device"],
      refetchType: "active",
    });
    expect(calls).toContainEqual({
      queryKey: enterpriseKeys.enrollmentAttempts(tenantId),
      refetchType: "active",
    });
  });
});

describe("decodeRealtimeEvent", () => {
  it("accepts the wire shape and rejects everything else", () => {
    expect(decodeRealtimeEvent(JSON.stringify(event()))).toMatchObject({
      seq: 1,
      kind: "device.checkin",
      deviceId: "device-a",
    });
    expect(decodeRealtimeEvent("not json")).toBeUndefined();
    expect(decodeRealtimeEvent(JSON.stringify({ seq: 1 }))).toBeUndefined();
    expect(decodeRealtimeEvent(JSON.stringify({ ...event(), kind: "nope" }))).toBeUndefined();
  });
});

describe("startTenantRealtime", () => {
  class FakeEventSource {
    static instances: FakeEventSource[] = [];

    readonly url: string;
    readyState = 1;
    closed = false;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(url: string) {
      this.url = url;
      FakeEventSource.instances.push(this);
    }

    close() {
      this.closed = true;
      this.readyState = 2;
    }

    open() {
      this.onopen?.();
    }

    message(data: string) {
      this.onmessage?.({ data });
    }

    fail() {
      this.onerror?.();
    }
  }

  const fakeDocument = (hidden = false) => {
    const listeners = new Map<string, Set<() => void>>();

    const target = {
      hidden,
      addEventListener: (type: string, listener: () => void) => {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener: (type: string, listener: () => void) => {
        listeners.get(type)?.delete(listener);
      },
      emit: (type: string) => {
        for (const listener of listeners.get(type) ?? []) listener();
      },
    };

    return target;
  };

  const fakeWindow = () => {
    const listeners = new Map<string, Set<() => void>>();

    return {
      addEventListener: (type: string, listener: () => void) => {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener: (type: string, listener: () => void) => {
        listeners.get(type)?.delete(listener);
      },
      emit: (type: string) => {
        for (const listener of listeners.get(type) ?? []) listener();
      },
    };
  };

  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  const start = (document = fakeDocument()) => {
    const client = fakeClient();

    const realtime = startTenantRealtime({
      tenantId,
      queryClient: client,
      eventSource: (url) => new FakeEventSource(url),
      document,
      window: fakeWindow(),
      random: () => 0,
      debounceMs: 10,
      fallbackPollMs: 1_000,
      maxRetries: 2,
      slowRetryMs: 5_000,
    });

    return { realtime, client, document };
  };

  it("connects to the tenant path and resumes from the newest cursor", () => {
    const { realtime } = start();
    const first = FakeEventSource.instances[0]!;

    expect(first.url).toBe("/api/v1/tenants/tenant-1/realtime");

    first.open();
    first.message(JSON.stringify(event({ seq: 5 })));
    first.message(JSON.stringify(event({ seq: 5 })));

    expect(realtime.status()).toBe("live");
    expect(realtime.cursor()).toBe(5);

    // A duplicate frame is ignored by seq, so a reconnect race cannot refetch.
    vi.advanceTimersByTime(10);
    expect(realtime.cursor()).toBe(5);

    first.fail();
    vi.advanceTimersByTime(1_000);

    expect(FakeEventSource.instances[1]?.url).toBe("/api/v1/tenants/tenant-1/realtime?after=5");

    realtime.dispose();
  });

  it("backs off and falls back to polling after repeated failures", () => {
    const { realtime, client } = start();

    FakeEventSource.instances[0]!.fail();
    expect(realtime.status()).toBe("reconnecting");

    vi.advanceTimersByTime(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);

    FakeEventSource.instances[1]!.fail();
    expect(realtime.status()).toBe("polling");

    vi.advanceTimersByTime(1_000);

    const calls = client.invalidateQueries.mock.calls.length;

    expect(calls).toBeGreaterThan(0);

    realtime.dispose();
  });

  it("pauses when the tab is hidden and reconnects on return", () => {
    const document = fakeDocument();
    const { realtime } = start(document);

    FakeEventSource.instances[0]!.open();

    document.hidden = true;
    document.emit("visibilitychange");

    expect(realtime.status()).toBe("paused");
    expect(FakeEventSource.instances[0]!.closed).toBe(true);

    document.hidden = false;
    document.emit("visibilitychange");

    expect(FakeEventSource.instances).toHaveLength(2);

    realtime.dispose();
  });

  it("uses the polling fallback when there is no EventSource", () => {
    const client = fakeClient();

    const realtime = startTenantRealtime({
      tenantId,
      queryClient: client,
      document: fakeDocument(),
      eventSource: undefined,
      fallbackPollMs: REALTIME_FALLBACK_POLL_MS,
    });

    expect(realtime.status()).toBe("polling");
    expect(client.invalidateQueries).not.toHaveBeenCalled();

    realtime.dispose();
  });
});
