import { isServer } from "@solidjs/web";
import { Schema } from "effect";
import type posthogSdk from "posthog-js";
import type { RaisedFailure } from "~/lib/errors";

type PostHog = typeof posthogSdk;

import { registerPostHogReader, analyticsHeaders } from "./posthog-context";
import { sanitizePostHogCapture } from "./posthog-sanitize";

export type PostHogUser = {
  readonly id: string;
  readonly name?: string | null;
  readonly email?: string | null;
  readonly emailVerified?: boolean;
};

let initialized = false;

let starting: Promise<boolean> | undefined;

let posthog: PostHog | undefined;

let loading: Promise<PostHog | undefined> | undefined;

let lastUserSignature: string | undefined;

let lastTenantSignature: string | undefined;

let fetchInstalled = false;

/**
 * `posthog-js` is ~470KB. Import it only when analytics is configured and the
 * browser is idle, so it never delays hydration or the first page load.
 */
const loadPostHog = (): Promise<PostHog | undefined> => {
  if (posthog) return Promise.resolve(posthog);

  loading ??= import("posthog-js")
    .then((module) => {
      posthog = module.default;

      return posthog;
    })
    .catch((error) => {
      console.warn("PostHog failed to load", error);

      return undefined;
    });

  return loading;
};

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
  // SAFETY: the wrapper accepts the same `(input, init)` arguments and forwards
  // every request unchanged to the bound native fetch.
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

/** Initialise the browser SDK once, from the config injected by the SSR shell. */
const startPostHog = async (): Promise<boolean> => {
  if (isServer || initialized) return initialized;
  const config = window.__MATTRAX_POSTHOG__;

  if (!config?.key) return false;

  const sdk = await loadPostHog();

  if (!sdk || initialized) return initialized;

  try {
    sdk.init(config.key, {
      api_host: config.host,
      capture_pageview: "history_change",
      capture_pageleave: true,
      autocapture: true,
      capture_exceptions: true,
      person_profiles: "identified_only",
      persistence: "localStorage+cookie",
      disable_session_recording: true,
      // Super properties every browser event carries, so product analytics
      // can be filtered by the same release/environment as the API Worker.
      before_send: (event) =>
        sanitizePostHogCapture(event, {
          ...(config.environment ? { environment: config.environment } : {}),
          ...(config.release ? { release: config.release } : {}),
          ...(config.deploymentId ? { deployment_id: config.deploymentId } : {}),
        }),
    });
    initialized = true;
    registerPostHogReader(() => ({
      distinctId: sdk.get_distinct_id(),
      sessionId: sdk.get_session_id(),
    }));
    installFetchHeaders();

    return true;
  } catch (error) {
    console.warn("PostHog initialisation failed", error);

    return false;
  }
};

export const initPostHog = (): Promise<boolean> => {
  starting ??= startPostHog();

  return starting;
};

/** Keep the PostHog person in sync with the dashboard's authenticated user. */
export const syncPostHogUser = (user: PostHogUser | null): void => {
  void initPostHog().then((ready) => {
    if (!ready || !posthog) return;

    if (user) {
      // Re-identify when the profile changes too: an account can rename itself
      // or verify its email without signing out, and PostHog should not keep
      // the previous person properties.
      const signature = JSON.stringify([
        user.id,
        user.email ?? null,
        user.name ?? null,
        user.emailVerified ?? null,
      ]);

      if (lastUserSignature === signature) return;

      const properties: Record<string, Schema.Json> = {};

      if (user.email) properties.email = user.email;

      if (user.name) properties.name = user.name;

      if (user.emailVerified !== undefined) properties.email_verified = user.emailVerified;

      posthog.identify(user.id, properties);
      lastUserSignature = signature;

      return;
    }

    // A first-time signed-out visitor keeps their anonymous id. Only a real
    // sign-out (identified -> signed out) starts a fresh anonymous session.
    if (lastUserSignature !== undefined) posthog.reset();
    lastUserSignature = undefined;
  });
};

/** Group browser pageviews and interactions by the current tenant. */
export const syncPostHogTenant = (
  tenantId?: string | null,
  tenantName?: string | null,
): void => {
  void initPostHog().then((ready) => {
    if (!ready || !posthog) return;

    const signature = tenantId ? `${tenantId}\u0000${tenantName ?? ""}` : undefined;

    if (lastTenantSignature === signature) return;

    if (tenantId) {
      posthog.group("tenant", tenantId, tenantName ? { name: tenantName } : undefined);
    } else {
      posthog.resetGroups();
    }

    lastTenantSignature = signature;
  });
};

/** Capture a product event from the dashboard when server capture is not the source. */
export const capturePostHog = (event: string, properties?: Record<string, Schema.Json>): void => {
  void initPostHog().then((ready) => {
    if (ready) posthog?.capture(event, properties);
  });
};

/**
 * Report a caught render error.
 *
 * `capture_exceptions` only sees uncaught window errors; Solid error boundaries
 * handle their error and never rethrow, so boundaries call this explicitly. The
 * additional properties carry the boundary's support reference id.
 */
export const capturePostHogException = (
  error: RaisedFailure,
  properties?: Record<string, Schema.Json>,
): void => {
  void initPostHog().then((ready) => {
    if (ready && posthog) posthog.captureException(error, properties);
  });
};

// Analytics is not on the critical path. Give hydration a head start, then
// load the SDK while the browser is otherwise idle.
if (!isServer) setTimeout(() => void initPostHog(), 1_500);
