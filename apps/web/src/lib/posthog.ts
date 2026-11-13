import { isServer } from "@solidjs/web";
import posthog from "posthog-js";
import { registerPostHogReader, analyticsHeaders } from "./posthog-context";

export type PostHogUser = {
  readonly id: string;
  readonly name?: string | null;
  readonly email?: string | null;
  readonly emailVerified?: boolean;
};

let initialized = false;
let lastUserId: string | null | undefined;
let lastTenantId: string | null | undefined;
let fetchInstalled = false;

const applyAnalyticsHeaders = (headers: Headers): void => {
  for (const [name, value] of Object.entries(analyticsHeaders())) headers.set(name, value);
};

/**
 * Add PostHog correlation headers to same-origin API calls.
 *
 * Covering `fetch` centrally means the dashboard's typed API client, auth
 * client and the handful of raw settings/account requests all join the same
 * browser session without every call site remembering to pass headers.
 */
const installFetchHeaders = (): void => {
  if (fetchInstalled || typeof window === "undefined") return;
  fetchInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    let url: URL;
    try {
      url = new URL(String(raw), window.location.href);
    } catch {
      return originalFetch(input, init);
    }
    if (
      url.origin !== window.location.origin ||
      !(url.pathname === "/api" || url.pathname.startsWith("/api/"))
    )
      return originalFetch(input, init);

    if (input instanceof Request) {
      const headers = new Headers(init?.headers ?? input.headers);
      applyAnalyticsHeaders(headers);
      return originalFetch(new Request(input, { ...init, headers }));
    }
    const headers = new Headers(init?.headers);
    applyAnalyticsHeaders(headers);
    return originalFetch(input, { ...init, headers });
  }) as typeof window.fetch;
};

const redact = (value: string): string =>
  value
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, "[redacted]");

const withoutQuery = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    const url = new URL(value, window.location.href);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
};

const sanitizeCapture = <T extends { properties?: Record<string, any> }>(capture: T): T => {
  const properties = capture.properties;
  if (!properties) return capture;
  for (const key of ["$current_url", "$referrer"]) {
    if (key in properties) properties[key] = withoutQuery(properties[key]);
  }
  const exceptionValues = properties.$exception_values;
  if (Array.isArray(exceptionValues))
    properties.$exception_values = exceptionValues.map((item) =>
      typeof item === "string" ? redact(item) : item,
    );
  const exceptions = properties.$exception_list;
  if (Array.isArray(exceptions))
    properties.$exception_list = exceptions.map((item) =>
      item && typeof item === "object" && typeof item.value === "string"
        ? { ...item, value: redact(item.value) }
        : item,
    );
  return capture;
};

/** Initialise the browser SDK once, from the config injected by the SSR shell. */
export const initPostHog = (): boolean => {
  if (isServer || initialized) return initialized;
  const config = window.__MATTRAX_POSTHOG__;
  if (!config?.key) return false;
  try {
    posthog.init(config.key, {
      api_host: config.host,
      capture_pageview: "history_change",
      capture_pageleave: true,
      autocapture: true,
      capture_exceptions: true,
      person_profiles: "identified_only",
      persistence: "localStorage+cookie",
      disable_session_recording: true,
      before_send: sanitizeCapture,
    });
    initialized = true;
    registerPostHogReader(() => ({
      distinctId: posthog.get_distinct_id(),
      sessionId: posthog.get_session_id(),
    }));
    installFetchHeaders();
    return true;
  } catch (error) {
    console.warn("PostHog initialisation failed", error);
    return false;
  }
};

/** Keep the PostHog person in sync with the dashboard's authenticated user. */
export const syncPostHogUser = (user: PostHogUser | null): void => {
  initPostHog();
  if (!initialized) return;
  if (user) {
    if (lastUserId === user.id) return;
    posthog.identify(user.id, {
      ...(user.email ? { email: user.email } : {}),
      ...(user.name ? { name: user.name } : {}),
      ...(user.emailVerified === undefined ? {} : { email_verified: user.emailVerified }),
    });
    lastUserId = user.id;
    return;
  }
  // A first-time signed-out visitor keeps their anonymous id. Only a real
  // sign-out (identified -> signed out) starts a fresh anonymous session.
  if (typeof lastUserId === "string") posthog.reset();
  lastUserId = null;
};

/** Group browser pageviews and interactions by the current tenant. */
export const syncPostHogTenant = (tenantId?: string | null): void => {
  initPostHog();
  if (!initialized) return;
  if (lastTenantId === tenantId) return;
  if (tenantId) posthog.group("tenant", tenantId);
  else posthog.resetGroups();
  lastTenantId = tenantId ?? null;
};

/** Capture a product event from the dashboard when server capture is not the source. */
export const capturePostHog = (event: string, properties?: Record<string, unknown>): void => {
  initPostHog();
  if (initialized) posthog.capture(event, properties);
};

// The browser entry imports this module before rendering, so initialise early
// enough to capture the first pageview and wrap fetch for API correlation.
initPostHog();
