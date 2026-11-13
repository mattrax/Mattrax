import { PostHog } from "posthog-node/edge";

/**
 * Server-side PostHog delivery for product analytics and error tracking.
 *
 * The API Worker captures one `api_request` event per user-facing request plus
 * named product events from the enterprise service layer. Browser events carry
 * the PostHog session and distinct ids in `x-posthog-session-id` and
 * `x-posthog-distinct-id`; once a request authenticates, the authenticated user
 * id replaces the client-supplied distinct id.
 *
 * Analytics is best-effort. A missing key, provider outage or malformed error
 * never changes an API response.
 */

export type AnalyticsClient = {
  capture: (message: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
    groups?: Record<string, string | number>;
    timestamp?: Date;
  }) => void;
  captureException: (
    error: unknown,
    distinctId?: string,
    additionalProperties?: Record<string, unknown>,
  ) => void;
  flush: () => Promise<void>;
};

export type AnalyticsIdentity = {
  readonly userId: string;
  readonly email?: string;
  readonly name?: string;
  readonly tenantId?: string;
  readonly tenantName?: string;
  readonly roleName?: string;
  readonly roleKind?: "built-in" | "custom";
};

export type AnalyticsConfig = {
  readonly key?: string;
  readonly host?: string;
  readonly environment?: string;
  readonly release?: string;
  readonly deploymentId?: string | null;
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly headers: Headers | Readonly<Record<string, string | undefined>>;
  /** Fraction of error events to send, 0..1. Defaults to 1. */
  readonly errorSampleRate?: number;
  /** Hard per-isolate error cap. Defaults to 20 per minute. */
  readonly maxErrorsPerMinute?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly warn?: (message: string) => void;
  /** Test seam; production creates the PostHog edge client. */
  readonly client?: AnalyticsClient;
};

export type RequestAnalytics = {
  readonly enabled: boolean;
  identify(identity: AnalyticsIdentity): void;
  capture(event: string, properties?: Record<string, unknown>): void;
  captureError(error: unknown, properties?: Record<string, unknown>): void;
  flush(): Promise<void>;
};

const MAX_MESSAGE_LENGTH = 500;
const DISTINCT_ID_PATTERN = /^[A-Za-z0-9._:@+-]{1,200}$/;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Remove emails and long opaque tokens, then bound the result. */
export const redactAnalyticsText = (value: unknown): string => {
  const error = value instanceof Error ? value : undefined;
  const text = error ? `${error.name}: ${error.message}` : String(value);
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, "[redacted]")
    .slice(0, MAX_MESSAGE_LENGTH);
};

/** Path only: never forward query strings, which can contain tokens. */
export const safeAnalyticsPath = (path: string): string => path.split("?")[0]?.slice(0, 512) ?? "/";

const headerValue = (
  headers: Headers | Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined => {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return match?.[1]?.trim() || undefined;
};

/** A browser-provided distinct id is analytics context, never authorization. */
export const readClientDistinctId = (
  headers: Headers | Readonly<Record<string, string | undefined>>,
): string | undefined => {
  const value = headerValue(headers, "x-posthog-distinct-id");
  return value && DISTINCT_ID_PATTERN.test(value) ? value : undefined;
};

/** PostHog session ids are UUIDs; anything else is ignored. */
export const readClientSessionId = (
  headers: Headers | Readonly<Record<string, string | undefined>>,
): string | undefined => {
  const value = headerValue(headers, "x-posthog-session-id");
  return value && SESSION_ID_PATTERN.test(value) ? value : undefined;
};

/**
 * Only uncaught failures and 5xx responses are worth an error event. Health
 * probes still report a 5xx, but 4xx client mistakes and 429s do not.
 */
export const shouldReportError = (status: number | undefined, uncaught: boolean): boolean =>
  uncaught || (status !== undefined && status >= 500);

const errorTimestamps: number[] = [];

const withinErrorBudget = (now: number, maxEvents: number): boolean => {
  while (errorTimestamps.length > 0 && now - errorTimestamps[0]! >= 60_000) errorTimestamps.shift();
  if (errorTimestamps.length >= maxEvents) return false;
  errorTimestamps.push(now);
  return true;
};

const sanitizeError = (error: unknown): Error => {
  if (!(error instanceof Error)) return new Error(redactAnalyticsText(error));
  const message = redactAnalyticsText(error.message);
  const safe = new Error(message);
  safe.name = redactAnalyticsText(error.name);
  if (error.stack)
    safe.stack = error.stack
      .split("\n")
      .map((line) => line.replace(error.message, message))
      .join("\n");
  return safe;
};

const createClient = (config: AnalyticsConfig & { key: string }): AnalyticsClient =>
  new PostHog(config.key, {
    host: (config.host ?? "https://us.i.posthog.com").replace(/\/+$/, ""),
    flushAt: 50,
    flushInterval: 0,
    enableExceptionAutocapture: false,
    ...(config.fetch ? { fetch: config.fetch as never } : {}),
  });

/**
 * Create a request-scoped analytics session. The client is created lazily only
 * when a key is configured, so local/self-hosted deployments do not pay for it.
 */
export const createRequestAnalytics = (config: AnalyticsConfig): RequestAnalytics => {
  const key = config.key?.trim();
  let client = config.client;
  let captured = false;
  const enabled = Boolean(client || key);
  if (!enabled) {
    return {
      enabled: false,
      identify: () => {},
      capture: () => {},
      captureError: () => {},
      flush: async () => {},
    };
  }
  let clientUnavailable = false;
  const ensureClient = (): AnalyticsClient | undefined => {
    if (client || !key || clientUnavailable) return client;
    try {
      client = createClient({ ...config, key });
    } catch (error) {
      clientUnavailable = true;
      (config.warn ?? ((message: string) => console.warn(message)))(
        `PostHog client creation failed: ${redactAnalyticsText(error)}`,
      );
    }
    return client;
  };

  const now = config.now ?? Date.now;
  const random = config.random ?? Math.random;
  const warn = config.warn ?? ((message: string) => console.warn(message));
  const requestedSampleRate = config.errorSampleRate ?? 1;
  const errorSampleRate = Number.isFinite(requestedSampleRate)
    ? Math.min(1, Math.max(0, requestedSampleRate))
    : 1;
  const requestedMaxErrors = config.maxErrorsPerMinute ?? 20;
  const maxErrors = Number.isFinite(requestedMaxErrors) ? Math.max(1, requestedMaxErrors) : 20;
  const method = config.method.toUpperCase();
  const path = safeAnalyticsPath(config.path);
  const clientDistinctId = readClientDistinctId(config.headers);
  const sessionId = readClientSessionId(config.headers);
  let distinctId = clientDistinctId ?? `anonymous:${config.requestId}`;
  let identifiedUserId: string | undefined;
  let tenantId: string | undefined;
  let tenantName: string | undefined;
  let roleName: string | undefined;
  let roleKind: "built-in" | "custom" | undefined;
  let groupedTenant: string | undefined;

  const baseProperties = (): Record<string, unknown> => ({
    $lib: "mattrax-api",
    $current_url: path,
    request_id: config.requestId,
    method,
    path,
    ...(config.release ? { $lib_version: config.release, release: config.release } : {}),
    ...(config.environment ? { environment: config.environment } : {}),
    ...(config.deploymentId ? { deployment_id: config.deploymentId } : {}),
    ...(sessionId ? { $session_id: sessionId } : {}),
    ...(tenantId ? { tenant_id: tenantId } : {}),
    ...(roleName ? { role_name: roleName } : {}),
    ...(roleKind ? { role_kind: roleKind } : {}),
  });

  const safeCapture = (message: Parameters<AnalyticsClient["capture"]>[0]) => {
    const active = ensureClient();
    if (!active) return;
    captured = true;
    try {
      active.capture(message);
    } catch (error) {
      warn(`PostHog capture failed: ${redactAnalyticsText(error)}`);
    }
  };

  const safeCaptureException = (
    error: unknown,
    properties: Record<string, unknown>,
    distinct: string,
  ) => {
    const active = ensureClient();
    if (!active) return;
    captured = true;
    try {
      active.captureException(error, distinct, properties);
    } catch (cause) {
      warn(`PostHog exception capture failed: ${redactAnalyticsText(cause)}`);
    }
  };

  return {
    enabled,
    identify: (identity) => {
      if (!DISTINCT_ID_PATTERN.test(identity.userId)) return;
      tenantId = identity.tenantId;
      tenantName = identity.tenantName;
      roleName = identity.roleName;
      roleKind = identity.roleKind;

      if (identifiedUserId !== identity.userId) {
        const previous = distinctId;
        distinctId = identity.userId;
        safeCapture({
          distinctId,
          event: "$identify",
          properties: {
            ...baseProperties(),
            $set: {
              ...(identity.email ? { email: identity.email } : {}),
              ...(identity.name ? { name: identity.name } : {}),
            },
            $set_once: { first_seen_at: new Date(now()).toISOString() },
            ...(previous !== distinctId ? { $anon_distinct_id: previous } : {}),
          },
          ...(tenantId ? { groups: { tenant: tenantId } } : {}),
        });
        identifiedUserId = identity.userId;
      }

      if (tenantId && groupedTenant !== tenantId) {
        safeCapture({
          distinctId,
          event: "$groupidentify",
          properties: {
            ...baseProperties(),
            $group_type: "tenant",
            $group_key: tenantId,
            $group_set: {
              ...(tenantName ? { name: tenantName } : {}),
            },
          },
          groups: { tenant: tenantId },
        });
        groupedTenant = tenantId;
      }
    },
    capture: (event, properties = {}) => {
      safeCapture({
        distinctId,
        event,
        properties: { ...baseProperties(), ...properties },
        ...(tenantId ? { groups: { tenant: tenantId } } : {}),
      });
    },
    captureError: (error, properties = {}) => {
      if (random() >= errorSampleRate) return;
      if (!withinErrorBudget(now(), maxErrors)) return;
      safeCaptureException(
        sanitizeError(error),
        { ...baseProperties(), ...properties },
        distinctId,
      );
    },
    flush: async () => {
      if (!captured) return;
      const active = ensureClient();
      if (!active) return;
      try {
        await active.flush();
      } catch (error) {
        warn(`PostHog flush failed: ${redactAnalyticsText(error)}`);
      }
    },
  };
};

/** Map a successful auth request to a conversion event for product analytics. */
export const authEventForRequest = (
  path: string,
  method: string,
  status: number,
): string | undefined => {
  if (status >= 400) return undefined;
  if (method !== "POST") return undefined;
  switch (safeAnalyticsPath(path)) {
    case "/api/v1/signIn":
      return "auth_signed_in";
    case "/api/v1/register":
      return "auth_register_submitted";
    case "/api/v1/signOut":
      return "auth_signed_out";
    case "/api/v1/completeReset":
      return "auth_password_reset_completed";
    case "/api/v1/verify-email":
      return "auth_email_verified";
    case "/api/v1/invitations/accept":
      return "member_invitation_accepted";
    case "/api/v1/ssoSignIn":
      return "auth_sso_signed_in";
    default:
      return undefined;
  }
};

/**
 * Read only the auth completion tag (never the credentials or session body) so
 * an MFA challenge is not counted as a completed sign-in conversion.
 */
export const authOutcomeFromResponse = async (
  response: Response,
): Promise<"authenticated" | "pending" | undefined> => {
  if (!(response.headers.get("content-type") ?? "").includes("json")) return undefined;
  try {
    const body = (await response.clone().json()) as {
      value?: { _tag?: unknown };
      _tag?: unknown;
    };
    const tag = body?.value?._tag ?? body?._tag;
    if (tag === "Authenticated") return "authenticated";
    if (tag === "PendingAuthentication") return "pending";
    return undefined;
  } catch {
    return undefined;
  }
};

/** Health, docs, version and preflight requests are not product usage. */
export const shouldTrackApiRequest = (path: string, method: string): boolean => {
  if (method === "OPTIONS") return false;
  const pathname = safeAnalyticsPath(path);
  if (
    pathname === "/api/health" ||
    pathname === "/health" ||
    pathname === "/api/ready" ||
    pathname === "/api/version" ||
    pathname === "/api/openapi.json" ||
    pathname === "/api/v1/getSession" ||
    pathname.startsWith("/api/docs") ||
    pathname.startsWith("/api/debug/")
  )
    return false;
  return pathname.startsWith("/api/") || pathname === "/api";
};
