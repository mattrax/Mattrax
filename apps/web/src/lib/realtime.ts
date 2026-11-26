import {
  Context,
  Effect,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Predicate,
  Queue,
  Ref,
  Schema,
  Scope,
} from "effect";
import {
  RealtimeEvent as RealtimeEventSchema,
  invalidationScopesForKind,
  realtimeEventsPath,
} from "@mattrax/enterprise-domain/client";
import type {
  RealtimeEvent,
  RealtimeEventKind,
  RealtimeInvalidationScope,
} from "@mattrax/enterprise-domain/client";
import { enterpriseKeys } from "~/lib/enterprise";

/**
 * Tenant realtime invalidation.
 *
 * One SSE connection per tenant per tab. Events only carry a kind and a device
 * id; they never carry state, so the cache stays the single source of truth and
 * every refetch still passes the API's own authorisation and scoping.
 *
 * Three behaviours keep a fleet check-in storm from turning into a refetch
 * storm:
 *
 * - Events are debounced into one flush window.
 * - Repeated events for one device collapse to one invalidation.
 * - Above a device cap the flush invalidates the tenant's device surface once
 *   instead of fanning out per device.
 *
 * The connection is deliberately bounded by the server (25s) and reconnects
 * with a cursor. Backoff is ours, not the browser's default retry, so a server
 * that is refusing the stream backs off instead of spinning. After a few
 * failures (or when `EventSource` is unavailable) a slower invalidation poll
 * takes over and SSE is retried on a long interval.
 */

/** Wait this long so a burst of check-ins becomes one refetch. */
export const REALTIME_DEBOUNCE_MS = 750;

/** Above this many distinct devices, invalidate the tenant surface once. */
export const REALTIME_MAX_DEVICES_PER_FLUSH = 40;

export const REALTIME_RETRY_BASE_MS = 1_000;

export const REALTIME_RETRY_MAX_MS = 30_000;

/** Poll interval used while SSE is unavailable or failing. */
export const REALTIME_FALLBACK_POLL_MS = 60_000;

/** After this many failures, stop hammering and retry SSE slowly. */
export const REALTIME_MAX_RETRIES = 6;

/** Slow SSE retry once the polling fallback is carrying the load. */
export const REALTIME_SLOW_RETRY_MS = 5 * 60_000;

export type RealtimeStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "polling"
  | "paused"
  | "offline";

/** Decode one SSE `data` payload. Returns undefined for anything malformed. */
export const decodeRealtimeEvent = (data: string): RealtimeEvent | undefined => {
  try {
    // SAFETY: `JSON.parse` returns the untrusted value; the schema decode
    // below is what establishes the domain type.
    const parsed: unknown = JSON.parse(data);

    return Option.getOrUndefined(Schema.decodeUnknownOption(RealtimeEventSchema)(parsed));
  } catch {
    return undefined;
  }
};

/**
 * Exponential backoff with 50–100% jitter, capped. Attempt 0 is 0.5–1s; the
 * jitter stops every open tab in a building reconnecting in lockstep after a
 * deploy.
 */
export const realtimeRetryDelay = (attempt: number, random: () => number = Math.random): number => {
  const exponent = Number.isFinite(attempt) ? Math.max(0, Math.trunc(attempt)) : 0;
  const ceiling = Math.min(REALTIME_RETRY_MAX_MS, REALTIME_RETRY_BASE_MS * 2 ** exponent);

  return Math.round(ceiling * (0.5 + random() * 0.5));
};

/** Concrete query keys for one invalidation scope. */
export const realtimeInvalidationKeys = (
  tenantId: string,
  scope: RealtimeInvalidationScope,
  deviceId: string | null,
): ReadonlyArray<readonly unknown[]> => {
  const deviceKeys = (): ReadonlyArray<readonly unknown[]> =>
    deviceId === null
      ? [
          // No device id means "every device", which is a prefix invalidation
          // rather than a fan-out over ids.
          ["enterprise", "device-health", tenantId] as const,
          ["enterprise", "item", tenantId, "device"] as const,
          enterpriseKeys.entitySummaryPrefix(tenantId, "device"),
          ["enterprise", "device-activity", tenantId] as const,
          ["enterprise", "device-applications", tenantId] as const,
          ["enterprise", "device-effective-policy", tenantId] as const,
          ["enterprise", "device-users", tenantId] as const,
          ["enterprise", "device-apple-users", tenantId] as const,
          ["enterprise", "windows-failures", tenantId] as const,
        ]
      : [
          enterpriseKeys.deviceHealth(tenantId, deviceId),
          // Prefix: covers the device detail, its commands, groups and any
          // other per-device query under `item`.
          enterpriseKeys.item(tenantId, "device", deviceId),
          enterpriseKeys.entitySummary(tenantId, "device", deviceId),
          enterpriseKeys.deviceActivity(tenantId, deviceId),
          enterpriseKeys.deviceApplications(tenantId, deviceId),
          enterpriseKeys.deviceEffectivePolicy(tenantId, deviceId),
          enterpriseKeys.deviceUsers(tenantId, deviceId),
          enterpriseKeys.deviceAppleUsers(tenantId, deviceId),
          enterpriseKeys.windowsFailures(tenantId, deviceId),
        ];

  switch (scope) {
    case "device":
    case "commands":
    case "declarations":
      return deviceKeys();

    case "fleet":
      return [
        enterpriseKeys.deviceSearchPrefix(tenantId),
        enterpriseKeys.listPrefix(tenantId, "device"),
        enterpriseKeys.entitySummaryPrefix(tenantId, "device"),
        enterpriseKeys.deviceHealthSummary(tenantId),
        // Fleet/dashboard widgets are cached under these two prefixes.
        ["enterprise", "dashboard-query", tenantId] as const,
        ["enterprise", "dashboard-query-batch", tenantId] as const,
      ];

    case "activity":
      return [
        ...deviceKeys(),
        ["enterprise", "audit-search", tenantId] as const,
        enterpriseKeys.windowsFailures(tenantId),
      ];

    case "enrollment":
      return [
        enterpriseKeys.enrollment(tenantId),
        enterpriseKeys.enrollmentAttempts(tenantId),
        enterpriseKeys.devicePreRegistrations(tenantId),
      ];
  }
};

export type RealtimeInvalidationTargets = {
  /** One tenant-wide pass; used for missing device ids and big bursts. */
  readonly tenantWide: boolean;
  readonly deviceIds: ReadonlyArray<string>;
  readonly scopes: ReadonlyArray<RealtimeInvalidationScope>;
};

/**
 * Collapse a burst of events into at most one target per device and one set of
 * scopes. Pure, so the storm behaviour is testable without timers.
 */
export const collectRealtimeTargets = (
  events: ReadonlyArray<RealtimeEvent>,
  maxDevices: number = REALTIME_MAX_DEVICES_PER_FLUSH,
): RealtimeInvalidationTargets => {
  const scopes = new Set<RealtimeInvalidationScope>();
  const devices = new Set<string>();
  let tenantWide = false;

  for (const event of events) {
    for (const scope of invalidationScopesForKind(event.kind)) scopes.add(scope);

    if (event.deviceId === null) {
      // A tenant-level event cannot be narrowed to one device.
      tenantWide = true;
      continue;
    }

    devices.add(event.deviceId);

    if (devices.size > maxDevices) tenantWide = true;
  }

  if (tenantWide) devices.clear();

  return { tenantWide, deviceIds: [...devices], scopes: [...scopes] };
};

/** Which query keys one burst should invalidate. */
export const realtimeKeysForEvents = (
  tenantId: string,
  events: ReadonlyArray<RealtimeEvent>,
  maxDevices: number = REALTIME_MAX_DEVICES_PER_FLUSH,
): ReadonlyArray<readonly unknown[]> => {
  const targets = collectRealtimeTargets(events, maxDevices);
  const keys: (readonly unknown[])[] = [];
  const seen = new Set<string>();

  const add = (key: readonly unknown[]) => {
    const id = JSON.stringify(key);

    if (seen.has(id)) return;
    seen.add(id);
    keys.push(key);
  };

  for (const scope of targets.scopes) {
    if (targets.tenantWide) {
      // A tenant-wide burst invalidates each affected family once. Per-device
      // keys for every device would be exactly the fan-out we are avoiding.
      for (const key of realtimeInvalidationKeys(tenantId, scope, null)) add(key);

      continue;
    }

    for (const deviceId of targets.deviceIds)
      for (const key of realtimeInvalidationKeys(tenantId, scope, deviceId)) add(key);
  }

  return keys;
};

/**
 * The slice of a query client realtime uses. Narrow enough for tests to pass a
 * plain object; a real `QueryClient` satisfies it.
 */
export type RealtimeQueryCache = {
  readonly invalidateQueries: (filters: {
    readonly queryKey: readonly unknown[];
    readonly refetchType: "active";
  }) => Promise<void>;
};

/** Injectable query-cache port; tests provide a fake, no client spying. */
export class RealtimeQueryCacheService extends Context.Service<
  RealtimeQueryCacheService,
  RealtimeQueryCache
>()("mattraxe/web/RealtimeQueryCache") {}

export type RealtimeInvalidator = {
  /** Queue events; they are flushed after the debounce window. */
  readonly push: (event: RealtimeEvent) => void;
  /** Invalidate the whole tenant surface now (polling fallback). */
  readonly invalidateAll: () => void;
  readonly flush: () => void;
  readonly dispose: () => Promise<void>;
};

export class RealtimeInvalidatorService extends Context.Service<
  RealtimeInvalidatorService,
  {
    readonly push: (event: RealtimeEvent) => Effect.Effect<void>;
    readonly invalidateAll: Effect.Effect<void>;
    readonly flush: Effect.Effect<void>;
  }
>()("mattraxe/web/RealtimeInvalidator") {}

const invalidateKeys = (queryClient: RealtimeQueryCache, keys: ReadonlyArray<readonly unknown[]>) =>
  Effect.forEach(
    keys,
    (queryKey) =>
      Effect.tryPromise(() =>
        queryClient.invalidateQueries({ queryKey, refetchType: "active" }),
      ).pipe(Effect.catch(() => Effect.void)),
    { discard: true },
  );

export const realtimeInvalidatorLayer = (
  tenantId: string,
  options: { readonly debounceMs?: number; readonly maxDevices?: number } = {},
): Layer.Layer<RealtimeInvalidatorService, never, RealtimeQueryCacheService> =>
  Layer.effect(
    RealtimeInvalidatorService,
    Effect.gen(function* () {
      const queryClient = yield* RealtimeQueryCacheService;
      const debounceMs = options.debounceMs ?? REALTIME_DEBOUNCE_MS;
      const maxDevices = options.maxDevices ?? REALTIME_MAX_DEVICES_PER_FLUSH;
      const scope = yield* Scope.Scope;
      const pending = yield* Ref.make<ReadonlyArray<RealtimeEvent>>([]);
      const scheduled = yield* Ref.make(false);

      const flush: Effect.Effect<void> = Effect.gen(function* () {
        const events = yield* Ref.getAndSet(pending, []);
        yield* Ref.set(scheduled, false);

        if (events.length > 0)
          yield* invalidateKeys(queryClient, realtimeKeysForEvents(tenantId, events, maxDevices));

        if ((yield* Ref.get(pending)).length > 0) yield* schedule;
      });

      const schedule: Effect.Effect<void> = Effect.gen(function* () {
        const alreadyScheduled = yield* Ref.getAndUpdate(scheduled, () => true);

        if (!alreadyScheduled)
          yield* Effect.forkIn(Effect.sleep(debounceMs).pipe(Effect.andThen(flush)), scope);
      });

      return RealtimeInvalidatorService.of({
        push: (event) =>
          Ref.update(pending, (events) => [...events, event]).pipe(Effect.andThen(schedule)),
        invalidateAll: invalidateKeys(
          queryClient,
          (["device", "fleet", "activity", "enrollment"] as const).flatMap((scope) =>
            realtimeInvalidationKeys(tenantId, scope, null),
          ),
        ),
        flush,
      });
    }),
  );

/** Promise adapter for Solid callers; the timer and fiber belong to a Scope. */
export const createRealtimeInvalidator = (
  queryClient: RealtimeQueryCache,
  tenantId: string,
  options: { readonly debounceMs?: number; readonly maxDevices?: number } = {},
): RealtimeInvalidator => {
  let service: RealtimeInvalidatorService["Service"] | undefined;
  const runtime = ManagedRuntime.make(
    realtimeInvalidatorLayer(tenantId, options).pipe(
      Layer.provide(
        Layer.succeed(RealtimeQueryCacheService, RealtimeQueryCacheService.of(queryClient)),
      ),
    ),
  );

  runtime.runSync(
    Effect.gen(function* () {
      service = yield* RealtimeInvalidatorService;
    }),
  );

  return {
    push: (event) => runtime.runPromise(service!.push(event)),
    invalidateAll: () => runtime.runPromise(service!.invalidateAll),
    flush: () => runtime.runPromise(service!.flush),
    dispose: () => runtime.dispose(),
  };
};

type EventSourceLike = {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: string }) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
};

/** Browser EventSource is only a callback adapter; Effect owns its lifetime. */
class BrowserEventSource implements EventSourceLike {
  private readonly source: EventSource;

  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.source = new EventSource(url);
    this.source.onopen = () => this.onopen?.();
    this.source.onmessage = (event) => this.onmessage?.({ data: String(event.data) });
    this.source.onerror = () => this.onerror?.();
  }

  get readyState(): number {
    return this.source.readyState;
  }

  close(): void {
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.source.close();
  }
}

type VisibilityTarget = {
  readonly hidden: boolean;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

const browserDocument = (): VisibilityTarget | undefined => {
  if (typeof document === "undefined") return undefined;

  return {
    get hidden() {
      return document.hidden;
    },
    addEventListener: (type, listener) => document.addEventListener(type, listener),
    removeEventListener: (type, listener) => document.removeEventListener(type, listener),
  };
};

const browserWindow = (): TenantRealtimeOptions["window"] | undefined => {
  if (typeof window === "undefined") return undefined;

  return {
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    removeEventListener: (type, listener) => window.removeEventListener(type, listener),
  };
};

export type TenantRealtimeOptions = {
  readonly tenantId: string;
  readonly queryClient: RealtimeQueryCache;
  /** Injection seam for tests; production uses the global EventSource. */
  readonly eventSource?: (url: string) => EventSourceLike;
  readonly document?: VisibilityTarget;
  readonly window?: {
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
  };
  readonly random?: () => number;
  readonly debounceMs?: number;
  readonly fallbackPollMs?: number;
  readonly maxRetries?: number;
  readonly slowRetryMs?: number;
};

export type TenantRealtime = {
  readonly dispose: () => Promise<void>;
  readonly status: () => RealtimeStatus;
  /** Newest cursor observed; useful for diagnostics and tests. */
  readonly cursor: () => number | undefined;
};

export type ScopedTenantRealtime = {
  readonly status: Effect.Effect<RealtimeStatus>;
  readonly cursor: Effect.Effect<number | undefined>;
};

type RealtimeControl = "visibility" | "focus" | "online" | "offline";

/**
 * Start a tenant subscription inside the caller's Scope. EventSource callbacks
 * only enqueue values; reconnect, debounce and polling are scoped Effect fibers.
 */
export const startTenantRealtimeEffect = (
  options: TenantRealtimeOptions,
): Effect.Effect<ScopedTenantRealtime, never, Scope.Scope | RealtimeInvalidatorService> =>
  Effect.gen(function* () {
    const doc = options.document ?? browserDocument();

    if (!doc)
      return {
        status: Effect.succeed("offline" as const),
        cursor: Effect.succeed(undefined),
      };

    const invalidator = yield* RealtimeInvalidatorService;
    const events = yield* Queue.unbounded<RealtimeEvent>();
    const controls = yield* Queue.unbounded<RealtimeControl>();
    const status = yield* Ref.make<RealtimeStatus>("connecting");
    const cursor = yield* Ref.make<number | undefined>(undefined);
    const failures = yield* Ref.make(0);
    const polling = yield* Ref.make(false);
    const connection = yield* Ref.make<Fiber.Fiber<never, never> | undefined>(undefined);
    const makeSource = options.eventSource ?? ((url: string) => new BrowserEventSource(url));
    const fallbackPollMs = options.fallbackPollMs ?? REALTIME_FALLBACK_POLL_MS;
    const maxRetries = options.maxRetries ?? REALTIME_MAX_RETRIES;
    const slowRetryMs = options.slowRetryMs ?? REALTIME_SLOW_RETRY_MS;
    const random = options.random ?? Math.random;

    const eventLoop: Effect.Effect<void> = Queue.take(events).pipe(
      Effect.flatMap((event) =>
        Effect.gen(function* () {
          const previous = yield* Ref.get(cursor);

          if (previous !== undefined && event.seq <= previous) return;
          yield* Ref.set(cursor, event.seq);
          yield* invalidator.push(event);
        }),
      ),
      Effect.andThen(Effect.suspend(() => eventLoop)),
    );

    const connectOnce = (url: string): Effect.Effect<never, Error> =>
      Effect.callback<never, Error>((resume) => {
        let source: EventSourceLike;

        try {
          source = makeSource(url);
        } catch (error) {
          resume(Effect.fail(Predicate.isError(error) ? error : new Error(String(error))));

          return Effect.void;
        }

        source.onopen = () => {
          Effect.runSync(Ref.set(failures, 0));
          Effect.runSync(Ref.set(polling, false));
          Effect.runSync(Ref.set(status, "live"));
        };
        source.onmessage = (message) => {
          const event = decodeRealtimeEvent(message.data);

          if (event) Queue.offerUnsafe(events, event);
        };
        source.onerror = () => {
          source.close();
          resume(Effect.fail(new Error("Realtime stream disconnected")));
        };

        return Effect.sync(() => source.close());
      });

    const runConnection = (attempt: number): Effect.Effect<never> =>
      connectOnce(
        cursorValue(cursor) === undefined
          ? realtimeEventsPath(options.tenantId)
          : realtimeEventsPath(options.tenantId) + "?after=" + cursorValue(cursor),
      ).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const next = attempt + 1;
            yield* Ref.set(failures, next);
            yield* Ref.set(status, next >= 2 ? "polling" : "reconnecting");

            if (next >= 2) yield* Ref.set(polling, true);

            const delay = next >= maxRetries ? slowRetryMs : realtimeRetryDelay(next - 1, random);
            yield* Effect.logDebug(error.message);
            yield* Effect.sleep(delay);
            return yield* runConnection(next);
          }),
        ),
      );

    const connectNow = Effect.gen(function* () {
      const current = yield* Ref.get(connection);

      if (current) yield* Fiber.interrupt(current);
      yield* Ref.set(connection, undefined);
      yield* Ref.set(status, "connecting");
      const fiber = yield* Effect.forkScoped(runConnection(0));
      yield* Ref.set(connection, fiber);
    });

    const disconnect = Effect.gen(function* () {
      const current = yield* Ref.get(connection);

      if (current) yield* Fiber.interrupt(current);
      yield* Ref.set(connection, undefined);
    });

    const controlLoop: Effect.Effect<void, never, Scope.Scope> = Queue.take(controls).pipe(
      Effect.flatMap((control) =>
        Effect.gen(function* () {
          if (control === "visibility") {
            if (doc.hidden) {
              yield* disconnect;
              yield* Ref.set(polling, false);
              yield* Ref.set(status, "paused");
            } else {
              yield* Ref.set(failures, 0);
              yield* connectNow;
            }
          } else if (control === "focus") {
            const current = yield* Ref.get(status);

            if (!doc.hidden && current !== "live" && current !== "connecting") {
              yield* Ref.set(failures, 0);
              yield* connectNow;
            }
          } else if (control === "online") {
            yield* Ref.set(failures, 0);
            yield* connectNow;
          } else {
            yield* disconnect;
            yield* Ref.set(polling, false);
            yield* Ref.set(status, "offline");
          }
        }),
      ),
      Effect.andThen(Effect.suspend(() => controlLoop)),
    );

    const pollLoop: Effect.Effect<void> = Effect.sleep(fallbackPollMs).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          if (!doc.hidden && (yield* Ref.get(polling))) yield* invalidator.invalidateAll;
        }),
      ),
      Effect.andThen(Effect.suspend(() => pollLoop)),
    );

    const win = options.window ?? browserWindow();
    const onVisibility = () => Queue.offerUnsafe(controls, "visibility");
    const onFocus = () => Queue.offerUnsafe(controls, "focus");
    const onOnline = () => Queue.offerUnsafe(controls, "online");
    const onOffline = () => Queue.offerUnsafe(controls, "offline");

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        doc.addEventListener("visibilitychange", onVisibility);
        win?.addEventListener("focus", onFocus);
        win?.addEventListener("online", onOnline);
        win?.addEventListener("offline", onOffline);
      }),
      () =>
        Effect.sync(() => {
          doc.removeEventListener("visibilitychange", onVisibility);
          win?.removeEventListener("focus", onFocus);
          win?.removeEventListener("online", onOnline);
          win?.removeEventListener("offline", onOffline);
        }),
    );

    yield* Effect.forkScoped(eventLoop);
    yield* Effect.forkScoped(controlLoop);
    yield* Effect.forkScoped(pollLoop);
    yield* connectNow;

    return {
      status: Ref.get(status),
      cursor: Ref.get(cursor),
    };
  });

const cursorValue = (cursor: Ref.Ref<number | undefined>): number | undefined =>
  Ref.getUnsafe(cursor);

/** Promise adapter used by Solid layout effects. */
export const startTenantRealtime = (options: TenantRealtimeOptions): TenantRealtime => {
  const doc = options.document ?? browserDocument();

  if (!doc) return { dispose: async () => {}, status: () => "offline", cursor: () => undefined };

  let handle: ScopedTenantRealtime | undefined;
  const runtime = ManagedRuntime.make(
    Layer.effectDiscard(
      startTenantRealtimeEffect(options).pipe(
        Effect.tap((next) =>
          Effect.sync(() => {
            handle = next;
          }),
        ),
      ),
    )
      .pipe(Layer.provide(realtimeInvalidatorLayer(options.tenantId, options)))
      .pipe(
        Layer.provide(
          Layer.succeed(
            RealtimeQueryCacheService,
            RealtimeQueryCacheService.of(options.queryClient),
          ),
        ),
      ),
  );

  runtime.runSync(Effect.void);

  return {
    status: () => runtime.runSync(handle!.status),
    cursor: () => runtime.runSync(handle!.cursor),
    dispose: () => runtime.dispose(),
  };
};

/** @internal Re-exported for tests that only need the kind type. */
export type { RealtimeEventKind };
