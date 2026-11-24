import { isServer } from "@solidjs/web";
import { Option, Schema } from "effect";
import type { RaisedFailure } from "~/lib/errors";
import { registerPostHogReader } from "./posthog-context";
import { sanitizePostHogCapture } from "./posthog-sanitize";
import { AnalyticsQueue } from "./analytics-queue";

/**
 * Minimal browser analytics client.
 *
 * The official `posthog-js` bundle is ~470 KB before it is useful to a page
 * whose analytics are pageviews, identity, groups, exceptions and click
 * autocapture. This client posts the same `/batch/` envelope as the API Worker,
 * which keeps the browser bundle small and lets events share a session id with
 * server-side product analytics.
 *
 * Session identity is local to the browser and rotates after 30 idle minutes.
 * The distinct id is anonymous until `syncPostHogUser` identifies the account.
 */

type PostHogConfig = {
  readonly key: string;
  readonly host: string;
  readonly environment?: string;
  readonly release?: string;
  readonly deploymentId?: string;
};

type AnalyticsProperties = Record<string, Schema.Json>;

type CapturedEvent = {
  event: string;
  distinct_id: string;
  properties: AnalyticsProperties;
  timestamp: string;
  groups?: Record<string, string>;
};

const isString = Schema.is(Schema.String);

const STORAGE_KEY = "mattrax.posthog";

const SESSION_IDLE_MILLIS = 30 * 60 * 1000;

const FLUSH_AFTER_MILLIS = 2_000;

const MAX_QUEUE = 20;

const randomId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `anon-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

type StoredIdentity = {
  distinctId?: string;
  sessionId?: string;
  activeAt?: number;
};

const readStorage = (): StoredIdentity => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);

    if (!raw) return {};

    const decoded = Schema.decodeUnknownOption(
      Schema.Struct({
        distinctId: Schema.optional(Schema.String),
        sessionId: Schema.optional(Schema.String),
        activeAt: Schema.optional(Schema.Number),
      }),
    )(JSON.parse(raw));

    return Option.isSome(decoded) ? decoded.value : {};
  } catch {
    return {};
  }
};

const writeStorage = (value: StoredIdentity): void => {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private mode or a full quota: analytics degrades to this page.
  }
};

let config: PostHogConfig | undefined;

let started = false;

let ready = false;

let distinctId = "";

let sessionId = "";

let sessionActiveAt = 0;

let tenant: { id: string; name?: string } | undefined;

let identifySignature: string | undefined;

let lastPage: string | undefined;

let analyticsQueue: AnalyticsQueue<CapturedEvent> | undefined;

const persist = (): void => {
  writeStorage({ distinctId, sessionId, activeAt: sessionActiveAt });
};

const ensureSession = (): void => {
  const now = Date.now();

  if (!sessionId || now - sessionActiveAt >= SESSION_IDLE_MILLIS) sessionId = randomId();

  sessionActiveAt = now;
  persist();
};

const pageUrl = (): string => {
  try {
    const url = new URL(globalThis.location.href);
    url.search = "";
    url.hash = "";

    return url.toString();
  } catch {
    return "";
  }
};

const externalReferrer = (): string | undefined => {
  try {
    if (!document.referrer) return undefined;
    const referrer = new URL(document.referrer);

    if (referrer.origin === globalThis.location.origin) return undefined;
    referrer.search = "";
    referrer.hash = "";

    return referrer.toString();
  } catch {
    return undefined;
  }
};

const baseProperties = () => {
  const referrer = externalReferrer();

  return {
    $lib: "web",
    $lib_version: "1.0.0",
    $current_url: pageUrl(),
    ...(referrer ? { $referrer: referrer } : {}),
    ...(config?.environment ? { environment: config.environment } : {}),
    ...(config?.release ? { release: config.release } : {}),
    ...(config?.deploymentId ? { deployment_id: config.deploymentId } : {}),
    $session_id: sessionId,
  } satisfies AnalyticsProperties;
};

const endpoint = (): string => `${config!.host.replace(/\/+$/, "")}/batch/`;

const sendBatch = (batch: ReadonlyArray<CapturedEvent>): Promise<void> =>
  fetch(endpoint(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: config!.key, batch }),
    keepalive: true,
    mode: "cors",
  }).then(() => undefined);

const flush = (beacon = false): Promise<void> => {
  if (!config || !analyticsQueue) return Promise.resolve();

  if (beacon && navigator.sendBeacon)
    return analyticsQueue.flushWith((batch) =>
      Promise.resolve(
        navigator.sendBeacon(
          endpoint(),
          new Blob([JSON.stringify({ api_key: config!.key, batch })], { type: "application/json" }),
        ),
      ).then((sent) => {
        if (!sent) throw new Error("Analytics beacon was rejected");
      }),
    );

  return analyticsQueue.flush();
};

const enqueue = (event: string, properties: AnalyticsProperties): void => {
  if (!config) return;
  ensureSession();

  const capture = sanitizePostHogCapture({
    event,
    properties: { ...baseProperties(), ...properties },
  });

  analyticsQueue?.push({
    event,
    distinct_id: distinctId,
    properties: capture.properties ?? {},
    timestamp: new Date().toISOString(),
    ...(tenant ? { groups: { tenant: tenant.id } } : {}),
  });

  if (analyticsQueue && analyticsQueue.size >= MAX_QUEUE) void flush();
};

const stackFrames = (stack: string | undefined) => {
  if (!stack) return [];

  const frames = [];

  for (const line of stack.split("\n").slice(1)) {
    const match = line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);

    if (!match) continue;
    frames.push({
      function: match[1] ?? "<anonymous>",
      filename: match[2],
      lineno: Number(match[3]),
      colno: Number(match[4]),
    });
  }

  return frames;
};

const describeFailure = (failure: RaisedFailure) => {
  if (isString(failure)) return { type: "Error", value: failure, stack: undefined };

  const value = failure instanceof Error ? failure.message : String(failure);
  const type = failure instanceof Error ? failure.name : "Error";
  const stack = failure instanceof Error ? failure.stack : undefined;

  return { type, value, stack };
};

const start = (): void => {
  if (isServer || started) return;
  started = true;

  const injected = window.__MATTRAX_POSTHOG__;

  if (!injected?.key) return;
  config = injected;

  const stored = readStorage();
  distinctId = stored.distinctId ?? randomId();
  sessionId = stored.sessionId ?? randomId();
  sessionActiveAt = stored.activeAt ?? Date.now();
  ensureSession();
  ready = true;

  registerPostHogReader(() => ({ distinctId, sessionId }));
  analyticsQueue = new AnalyticsQueue({ delay: FLUSH_AFTER_MILLIS, send: sendBatch });

  document.addEventListener(
    "click",
    (event) => {
      if (!ready) return;
      const target = event.target instanceof Element ? event.target : undefined;
      const element = target?.closest("a,button,[role='button'],input,select,textarea,label");

      if (!element || element.closest("[data-ph-no-capture]")) return;
      const href = element instanceof HTMLAnchorElement ? element.href : undefined;
      const text = element.textContent?.trim().slice(0, 120) ?? "";

      enqueue("$autocapture", {
        $event_type: "click",
        $el_text: text,
        $elements: [
          {
            tag_name: element.tagName.toLowerCase(),
            ...(href ? { attr__href: href } : {}),
            ...(text ? { $el_text: text } : {}),
          },
        ],
      });
    },
    true,
  );

  window.addEventListener("pagehide", () => {
    enqueue("$pageleave", { $pathname: location.pathname });
    void flush(true);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    enqueue("$pageleave", { $pathname: location.pathname });
    void flush(true);
  });
};

export const initPostHog = (): Promise<boolean> => {
  start();

  return Promise.resolve(ready);
};

export const capturePostHogPageview = (pathname: string): void => {
  start();

  if (!config || lastPage === pathname) return;
  lastPage = pathname;
  enqueue("$pageview", { $pathname: pathname });
};

export type PostHogUser = {
  readonly id: string;
  readonly name?: string | null;
  readonly email?: string | null;
  readonly emailVerified?: boolean;
};

/** Keep the person in sync with the dashboard's authenticated account. */
export const syncPostHogUser = (user: PostHogUser | null): void => {
  start();

  if (!config) return;

  if (!user) {
    // Only a real sign-out (identified -> signed out) starts a new person and
    // session; a first-time anonymous visitor keeps their id.
    if (identifySignature === undefined) return;
    distinctId = randomId();
    sessionId = randomId();
    sessionActiveAt = Date.now();
    tenant = undefined;
    identifySignature = undefined;
    lastPage = undefined;
    persist();
    void flush();

    return;
  }

  const signature = JSON.stringify([
    user.id,
    user.email ?? null,
    user.name ?? null,
    user.emailVerified ?? null,
  ]);

  if (identifySignature === signature) return;

  const previous = distinctId;
  distinctId = user.id;

  const set: AnalyticsProperties = {};

  if (user.email) set.email = user.email;

  if (user.name) set.name = user.name;

  if (user.emailVerified !== undefined) set.email_verified = user.emailVerified;

  enqueue("$identify", {
    $set: set,
    $set_once: { first_seen_at: new Date().toISOString() },
    ...(previous && previous !== distinctId ? { $anon_distinct_id: previous } : {}),
  });

  identifySignature = signature;
  persist();
};

/** Group pageviews and interactions by the active tenant. */
export const syncPostHogTenant = (tenantId?: string | null, tenantName?: string | null): void => {
  start();

  if (!config) return;
  const next = tenantId ? { id: tenantId, ...(tenantName ? { name: tenantName } : {}) } : undefined;

  if (tenant?.id === next?.id && tenant?.name === next?.name) return;
  tenant = next;

  if (next)
    enqueue("$groupidentify", {
      $group_type: "tenant",
      $group_key: next.id,
      $group_set: next.name ? { name: next.name } : {},
    });
};

/** Capture a product event from the dashboard when server capture is not the source. */
export const capturePostHog = (event: string, properties?: AnalyticsProperties): void => {
  start();
  enqueue(event, properties ?? {});
};

/**
 * Report a caught render error.
 *
 * `capture_exceptions` sees uncaught window errors; Solid boundaries handle
 * their error and never rethrow, so they call this explicitly.
 */
export const capturePostHogException = (
  error: RaisedFailure,
  properties?: AnalyticsProperties,
): void => {
  start();

  if (!config) return;
  const failure = describeFailure(error);

  enqueue("$exception", {
    ...properties,
    $exception_list: [
      {
        type: failure.type,
        value: failure.value,
        mechanism: { handled: true, synthetic: false },
        stacktrace: { type: "raw", frames: stackFrames(failure.stack) },
      },
    ],
    $exception_values: [`${failure.type}: ${failure.value}`],
  });
  void flush();
};

if (!isServer) start();
