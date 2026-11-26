import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "@mattrax/enterprise-domain/client";
import { enterpriseKeys } from "~/lib/enterprise";
import {
  REALTIME_MAX_DEVICES_PER_FLUSH,
  REALTIME_RETRY_MAX_MS,
  collectRealtimeTargets,
  RealtimeInvalidatorService,
  realtimeInvalidatorLayer,
  startTenantRealtimeEffect,
  decodeRealtimeEvent,
  realtimeKeysForEvents,
  realtimeRetryDelay,
} from "./realtime";
import type { RealtimeQueryCache } from "./realtime";

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
    expect(keys).toContainEqual(enterpriseKeys.entitySummary(tenantId, "device", "device-a"));
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
    expect(keys).toContainEqual(enterpriseKeys.entitySummaryPrefix(tenantId, "device"));
    expect(keys).toContainEqual(["enterprise", "device-health", tenantId]);
    // No concrete device id is present because there is none to invalidate.
    expect(keys.some((key) => key.includes("device-a"))).toBe(false);
  });
});

describe("createRealtimeInvalidator", () => {
  it("debounces a burst into one invalidation per key", async () => {
    const client = fakeClient();

    await Effect.runPromise(
      Effect.gen(function* () {
        const invalidator = yield* RealtimeInvalidatorService;

        for (let index = 0; index < 25; index++) yield* invalidator.push(event({ seq: index + 1 }));
        expect(client.invalidateQueries).not.toHaveBeenCalled();

        yield* TestClock.adjust(100);
        yield* Effect.yieldNow;
        const calls = client.invalidateQueries.mock.calls.map(([input]) => input);
        expect(calls).toContainEqual({
          queryKey: enterpriseKeys.item(tenantId, "device", "device-a"),
          refetchType: "active",
        });
        expect(
          calls.filter(
            (input) =>
              JSON.stringify(input?.queryKey) ===
              JSON.stringify(enterpriseKeys.item(tenantId, "device", "device-a")),
          ),
        ).toHaveLength(1);
      }).pipe(
        Effect.provide(realtimeInvalidatorLayer(client, tenantId, { debounceMs: 100 })),
        Effect.provide(TestClock.layer()),
        Effect.scoped,
      ),
    );
  });

  it("cancels scheduled work when its scope closes", async () => {
    const client = fakeClient();

    await Effect.runPromise(
      Effect.gen(function* () {
        const invalidator = yield* RealtimeInvalidatorService;
        yield* invalidator.push(event());
        yield* Effect.yieldNow;
      }).pipe(
        Effect.provide(realtimeInvalidatorLayer(client, tenantId, { debounceMs: 100 })),
        Effect.provide(TestClock.layer()),
        Effect.scoped,
      ),
    );
    await Effect.runPromise(TestClock.adjust(1_000).pipe(Effect.provide(TestClock.layer())));
    expect(client.invalidateQueries).not.toHaveBeenCalled();
  });

  it("invalidateAll refreshes every realtime family once", async () => {
    const client = fakeClient();

    await Effect.runPromise(
      Effect.gen(function* () {
        const invalidator = yield* RealtimeInvalidatorService;
        yield* invalidator.invalidateAll;
        yield* Effect.yieldNow;
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
      }).pipe(
        Effect.provide(realtimeInvalidatorLayer(client, tenantId)),
        Effect.provide(TestClock.layer()),
        Effect.scoped,
      ),
    );
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

describe("startTenantRealtimeEffect", () => {
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
      listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
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

  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>, client: RealtimeQueryCache) =>
    effect.pipe(
      Effect.provide(realtimeInvalidatorLayer(client, tenantId, { debounceMs: 10 })),
      Effect.provide(TestClock.layer()),
      Effect.scoped,
    );

  it("connects, resumes from the cursor and closes on scope exit", async () => {
    FakeEventSource.instances = [];
    const client = fakeClient();
    const document = fakeDocument();
    let first: FakeEventSource | undefined;
    let latest: FakeEventSource | undefined;

    await Effect.runPromise(
      provide(
        Effect.gen(function* () {
          const handle = yield* startTenantRealtimeEffect({
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
          yield* Effect.yieldNow;
          first = FakeEventSource.instances[0];
          expect(first.url).toBe("/api/v1/tenants/tenant-1/realtime");
          first.open();
          first.message(JSON.stringify(event({ seq: 5 })));
          first.message(JSON.stringify(event({ seq: 5 })));
          yield* Effect.yieldNow;
          expect(yield* handle.status).toBe("live");
          expect(yield* handle.cursor).toBe(5);
          yield* TestClock.adjust(10);
          first.fail();
          yield* TestClock.adjust(1_000);
          yield* Effect.yieldNow;
          latest = FakeEventSource.instances[1];
          expect(latest?.url).toBe("/api/v1/tenants/tenant-1/realtime?after=5");
        }),
        client,
      ),
    );

    expect(first?.closed).toBe(true);
    expect(latest?.closed).toBe(true);
    expect(document.listenerCount()).toBe(0);
  });

  it("backs off and falls back to polling after repeated failures", async () => {
    FakeEventSource.instances = [];
    const client = fakeClient();
    const document = fakeDocument();

    await Effect.runPromise(
      provide(
        Effect.gen(function* () {
          const handle = yield* startTenantRealtimeEffect({
            tenantId,
            queryClient: client,
            eventSource: (url) => new FakeEventSource(url),
            document,
            random: () => 0,
            fallbackPollMs: 1_000,
            maxRetries: 2,
            slowRetryMs: 5_000,
          });
          yield* Effect.yieldNow;
          FakeEventSource.instances[0].fail();
          yield* Effect.yieldNow;
          expect(yield* handle.status).toBe("reconnecting");
          yield* TestClock.adjust(1_000);
          FakeEventSource.instances[1].fail();
          yield* Effect.yieldNow;
          expect(yield* handle.status).toBe("polling");
          yield* TestClock.adjust(1_000);
          yield* Effect.yieldNow;
          expect(client.invalidateQueries).toHaveBeenCalled();
        }),
        client,
      ),
    );
  });

  it("pauses while hidden and reconnects on return", async () => {
    FakeEventSource.instances = [];
    const client = fakeClient();
    const document = fakeDocument();

    await Effect.runPromise(
      provide(
        Effect.gen(function* () {
          const handle = yield* startTenantRealtimeEffect({
            tenantId,
            queryClient: client,
            eventSource: (url) => new FakeEventSource(url),
            document,
            random: () => 0,
          });
          yield* Effect.yieldNow;
          FakeEventSource.instances[0].open();
          document.hidden = true;
          document.emit("visibilitychange");
          yield* Effect.yieldNow;
          expect(yield* handle.status).toBe("paused");
          expect(FakeEventSource.instances[0].closed).toBe(true);
          document.hidden = false;
          document.emit("visibilitychange");
          yield* TestClock.adjust(0);
          expect(FakeEventSource.instances).toHaveLength(2);
        }),
        client,
      ),
    );
  });

  it("uses the polling fallback when EventSource construction fails", async () => {
    FakeEventSource.instances = [];
    const client = fakeClient();
    const document = fakeDocument();

    await Effect.runPromise(
      provide(
        Effect.gen(function* () {
          const handle = yield* startTenantRealtimeEffect({
            tenantId,
            queryClient: client,
            eventSource: () => {
              throw new Error("blocked");
            },
            document,
            random: () => 0,
            fallbackPollMs: 1_000,
          });
          yield* Effect.yieldNow;
          expect(yield* handle.status).toBe("reconnecting");
          yield* TestClock.adjust(1_000);
          yield* Effect.yieldNow;
          expect(yield* handle.status).toBe("polling");
          expect(client.invalidateQueries).toHaveBeenCalled();
        }),
        client,
      ),
    );
  });
});
