import { Option, Schema } from "effect";
import {
  RealtimeEvent as RealtimeEventSchema,
  invalidationScopesForKind,
  realtimeEventsPath,
  type RealtimeEvent,
  type RealtimeEventKind,
  type RealtimeInvalidationScope,
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

export type RealtimeInvalidator = {
  /** Queue events; they are flushed after the debounce window. */
  readonly push: (event: RealtimeEvent) => void;
  /** Invalidate the whole tenant surface now (polling fallback). */
  readonly invalidateAll: () => void;
  readonly flush: () => void;
  readonly dispose: () => void;
};

/**
 * Create the debounced invalidator for one tenant.
 *
 * `refetchType: "active"` is deliberate: background and unmounted queries are
 * marked stale without a request, so a check-in storm cannot force every page
 * the user previously visited to refetch.
 */
export const createRealtimeInvalidator = (
  queryClient: RealtimeQueryCache,
  tenantId: string,
  options: { readonly debounceMs?: number; readonly maxDevices?: number } = {},
): RealtimeInvalidator => {
  const debounceMs = options.debounceMs ?? REALTIME_DEBOUNCE_MS;
  const maxDevices = options.maxDevices ?? REALTIME_MAX_DEVICES_PER_FLUSH;
  let pending: RealtimeEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const invalidate = (keys: ReadonlyArray<readonly unknown[]>) => {
    for (const key of keys) {
      void queryClient.invalidateQueries({ queryKey: key, refetchType: "active" });
    }
  };

  const flush = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }

    if (disposed || pending.length === 0) {
      pending = [];

      return;
    }

    const events = pending;
    pending = [];

    invalidate(realtimeKeysForEvents(tenantId, events, maxDevices));
  };

  const schedule = () => {
    if (disposed || timer !== undefined) return;

    timer = setTimeout(flush, debounceMs);
  };

  return {
    push(event) {
      if (disposed) return;
      pending.push(event);
      schedule();
    },
    invalidateAll() {
      if (disposed) return;

      // No event means no scope; the polling fallback refreshes every family
      // realtime can affect, using prefixes rather than a per-device fan-out.
      for (const scope of ["device", "fleet", "activity", "enrollment"] as const)
        invalidate(realtimeInvalidationKeys(tenantId, scope, null));
    },
    flush,
    dispose() {
      disposed = true;
      pending = [];

      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
};

type EventSourceLike = {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: string }) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
};

/**
 * Adapt the platform `EventSource` to the small structural surface above.
 * Keeping the adapter here avoids casts at the boundary and gives the test
 * double the same shape.
 */
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
    this.source.close();
  }
}

/** The document surface realtime needs; the page's document satisfies it. */
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

/** The window surface realtime needs; the page's window satisfies it. */
const browserWindow = (): TenantRealtimeOptions["window"] | undefined => {
  if (typeof window === "undefined") return undefined;

  return {
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    removeEventListener: (type, listener) => window.removeEventListener(type, listener),
  };
};

type VisibilityTarget = {
  readonly hidden: boolean;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export type TenantRealtimeOptions = {
  readonly tenantId: string;
  readonly queryClient: RealtimeQueryCache;
  /** Injection seam for tests; production uses the global `EventSource`. */
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
  readonly dispose: () => void;
  readonly status: () => RealtimeStatus;
  /** Newest cursor observed; useful for diagnostics and tests. */
  readonly cursor: () => number | undefined;
};

/**
 * Start the tenant subscription. A no-op on the server and during SSR, so it is
 * safe to call from a layout effect.
 */
export const startTenantRealtime = (options: TenantRealtimeOptions): TenantRealtime => {
  const doc = options.document ?? browserDocument();

  // No document means SSR (or a non-browser runtime): there is nothing to
  // subscribe. A test injects its own document instead.
  if (!doc) return { dispose: () => {}, status: () => "offline", cursor: () => undefined };

  const win = options.window ?? browserWindow();
  // Construction is attempted inside `connect` so a missing or blocked
  // EventSource degrades to polling instead of throwing here.
  const makeSource = options.eventSource ?? ((url: string) => new BrowserEventSource(url));

  const fallbackPollMs = options.fallbackPollMs ?? REALTIME_FALLBACK_POLL_MS;
  const maxRetries = options.maxRetries ?? REALTIME_MAX_RETRIES;
  const slowRetryMs = options.slowRetryMs ?? REALTIME_SLOW_RETRY_MS;
  const random = options.random ?? Math.random;

  const invalidator = createRealtimeInvalidator(options.queryClient, options.tenantId, {
    debounceMs: options.debounceMs,
  });

  let disposed = false;
  let source: EventSourceLike | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let failures = 0;
  let cursor: number | undefined;
  let status: RealtimeStatus = "connecting";

  const setStatus = (next: RealtimeStatus) => {
    status = next;
  };

  const clearRetry = () => {
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  };

  const stopPolling = () => {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  const startPolling = () => {
    if (disposed || pollTimer !== undefined) return;

    setStatus("polling");
    // A slower full invalidation is the fallback. It marks every query stale
    // once a minute; TanStack only refetches what is mounted, so the UI does
    // not spin and hidden tabs do no work.
    pollTimer = setInterval(() => {
      if (doc.hidden) return;
      invalidator.invalidateAll();
    }, fallbackPollMs);
  };

  const closeSource = () => {
    if (!source) return;

    source.onopen = null;
    source.onmessage = null;
    source.onerror = null;
    source.close();
    source = undefined;
  };

  const scheduleReconnect = (delay: number) => {
    clearRetry();
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      connect();
    }, delay);
  };

  const connect = () => {
    if (disposed || doc.hidden) {
      setStatus(doc.hidden ? "paused" : "offline");

      return;
    }

    closeSource();
    setStatus(failures === 0 ? "connecting" : "reconnecting");

    const url =
      cursor === undefined
        ? realtimeEventsPath(options.tenantId)
        : `${realtimeEventsPath(options.tenantId)}?after=${cursor}`;

    let next: EventSourceLike;

    try {
      next = makeSource(url);
    } catch {
      // A CSP or a broken polyfill can make the constructor throw. Fall back to
      // polling and retry the stream on the slow interval.
      startPolling();
      scheduleReconnect(Math.min(slowRetryMs, REALTIME_RETRY_MAX_MS));

      return;
    }

    source = next;

    next.onopen = () => {
      failures = 0;
      clearRetry();
      stopPolling();
      setStatus("live");
    };

    next.onmessage = (event) => {
      const decoded = decodeRealtimeEvent(event.data);

      // A duplicate (server replay or a reconnect race) must not refetch.
      if (!decoded || (cursor !== undefined && decoded.seq <= cursor)) return;

      cursor = decoded.seq;
      invalidator.push(decoded);
    };

    next.onerror = () => {
      closeSource();

      if (disposed) return;

      failures += 1;
      setStatus(failures >= 2 ? "polling" : "reconnecting");

      if (failures >= maxRetries) {
        // Keep the data fresh with polling and retry the stream slowly. This is
        // what keeps a blocked/failing stream from becoming a request loop.
        startPolling();
        scheduleReconnect(slowRetryMs);

        return;
      }

      if (failures >= 2) startPolling();

      scheduleReconnect(realtimeRetryDelay(failures - 1, random));
    };
  };

  const onVisibility = () => {
    if (doc.hidden) {
      closeSource();
      clearRetry();
      stopPolling();
      setStatus("paused");

      return;
    }

    // A tab returning to the foreground must not replay a long backlog; the
    // cursor resumes exactly where the previous stream stopped.
    failures = 0;
    connect();
  };

  const onFocus = () => {
    if (doc.hidden || status === "live" || status === "connecting") return;

    failures = 0;
    connect();
  };

  const onOnline = () => {
    failures = 0;
    connect();
  };

  const onOffline = () => {
    closeSource();
    clearRetry();
    stopPolling();
    setStatus("offline");
  };

  doc.addEventListener("visibilitychange", onVisibility);
  win?.addEventListener("focus", onFocus);
  win?.addEventListener("online", onOnline);
  win?.addEventListener("offline", onOffline);

  connect();

  return {
    status: () => status,
    cursor: () => cursor,
    dispose() {
      disposed = true;
      closeSource();
      clearRetry();
      stopPolling();
      invalidator.dispose();
      doc.removeEventListener("visibilitychange", onVisibility);
      win?.removeEventListener("focus", onFocus);
      win?.removeEventListener("online", onOnline);
      win?.removeEventListener("offline", onOffline);
      setStatus("offline");
    },
  };
};

/** @internal Re-exported for tests that only need the kind type. */
export type { RealtimeEventKind };
