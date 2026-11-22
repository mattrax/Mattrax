import { Option, Schema } from "effect";

export type AnalyticsValue =
  | string
  | number
  | boolean
  | null
  | readonly AnalyticsValue[]
  | { readonly [key: string]: AnalyticsValue };

export type AnalyticsProperties = Record<string, AnalyticsValue>;

type AnalyticsBaseProperties = {
  $lib: string;
  $current_url: string;
  request_id: string;
  method: string;
  path: string;
  $lib_version?: string;
  release?: string;
  environment?: string;
  deployment_id?: string;
  $session_id?: string;
  tenant_id?: string;
  role_name?: string;
  role_kind?: string;
};

type AnalyticsCaptureMessage = Parameters<AnalyticsClient["capture"]>[0];

type IdentifyProperties = AnalyticsBaseProperties & {
  $set: AnalyticsProperties;
  $set_once: { first_seen_at: string };
  $anon_distinct_id?: string;
};

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
    properties?: AnalyticsProperties;
    groups?: Record<string, string | number>;
    timestamp?: Date;
  }) => void;
  captureException: (
    cause: unknown,
    distinctId?: string,
    additionalProperties?: AnalyticsProperties,
  ) => void;
  flush: () => Promise<void>;
};

export type AnalyticsIdentity = {
  readonly userId: string;
  readonly email?: string;
  readonly name?: string;
  readonly emailVerified?: boolean;
  readonly tenantId?: string;
  readonly tenantName?: string;
  readonly roleName?: string;
  readonly roleKind?: "built-in" | "custom";
};

export type AnalyticsConfig = {
  readonly key?: string;
  readonly host?: string;
  readonly environment?: string;
  /** `$lib` label; defaults to the API Worker's value. */
  readonly lib?: string;
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
  capture(event: string, properties?: AnalyticsProperties): void;
  captureError(cause: unknown, properties?: AnalyticsProperties): void;
  flush(): Promise<void>;
};

const MAX_MESSAGE_LENGTH = 500;

const DISTINCT_ID_PATTERN = /^[A-Za-z0-9._:@+-]{1,200}$/;

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Remove emails and long opaque tokens, then bound the result. */
export const redactAnalyticsText = (cause: unknown): string => {
  const error = cause instanceof Error ? cause : undefined;
  const text = error ? `${error.name}: ${error.message}` : String(cause);

  return text
    .replaceAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replaceAll(/\b[A-Za-z0-9+/=_-]{32,}\b/g, "[redacted]")
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
  while (errorTimestamps.length > 0 && now - errorTimestamps[0] >= 60_000) errorTimestamps.shift();

  if (errorTimestamps.length >= maxEvents) return false;
  errorTimestamps.push(now);

  return true;
};

const sanitizeError = (cause: unknown): Error => {
  if (!(cause instanceof Error)) return new Error(redactAnalyticsText(cause));
  const message = redactAnalyticsText(cause.message);
  const safe = new Error(message);
  safe.name = redactAnalyticsText(cause.name);

  if (cause.stack)
    safe.stack = cause.stack
      .split("\n")
      .map((line) => line.replace(cause.message, message))
      .join("\n");

  return safe;
};

type PostHogEvent = {
  readonly event: string;
  readonly distinct_id: string;
  readonly properties: AnalyticsProperties;
  readonly timestamp: string;
  readonly groups?: Readonly<Record<string, string | number>>;
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

/**
 * Minimal PostHog client for the Worker.
 *
 * `posthog-node` bundles its own batching, retry, UUID, gzip, and error-
 * tracking stack (~365KB of the Worker's startup graph). The API sends one or
 * two events per request and already awaits `flush()` inside `waitUntil`, so a
 * direct `/batch/` POST keeps the same semantics without the SDK. Delivery is
 * best-effort, exactly like the SDK path.
 */
const createClient = (config: AnalyticsConfig & { key: string }): AnalyticsClient => {
  const host = (config.host ?? "https://us.i.posthog.com").replace(/\/+$/, "");
  const endpoint = `${host}/batch/`;
  const send = config.fetch ?? globalThis.fetch;
  const pending: Promise<void>[] = [];

  const enqueue = (event: PostHogEvent) => {
    const request = send(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: config.key, batch: [event] }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`PostHog responded ${response.status}`);
      })
      .catch((error: unknown) => {
        (config.warn ?? ((message: string) => console.warn(message)))(
          `PostHog delivery failed: ${redactAnalyticsText(error)}`,
        );
      });

    pending.push(request);
  };

  return {
    capture: (message) => {
      enqueue({
        event: message.event,
        distinct_id: message.distinctId,
        properties: message.properties ?? {},
        timestamp: (message.timestamp ?? new Date()).toISOString(),
        groups: message.groups,
      });
    },
    captureException: (cause, distinctId, additionalProperties) => {
      const error = cause instanceof Error ? cause : new Error(redactAnalyticsText(cause));
      const type = redactAnalyticsText(error.name);
      const value = redactAnalyticsText(error.message);

      enqueue({
        event: "$exception",
        distinct_id: distinctId ?? "anonymous",
        properties: {
          ...additionalProperties,
          $exception_list: [
            {
              type,
              value,
              mechanism: { handled: true, synthetic: false },
              stacktrace: { type: "raw", frames: stackFrames(error.stack) },
            },
          ],
          $exception_values: [`${type}: ${value}`],
        },
        timestamp: new Date().toISOString(),
      });
    },
    flush: async () => {
      await Promise.allSettled(pending);
    },
  };
};

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
  /** Tenant whose name still needs a `$groupidentify` on this request. */
  let groupToDescribe: string | undefined;
  /** Person fields for a caller with no browser SDK, sent once with an event. */
  let personProperties: AnalyticsProperties | undefined;
  let personPropertiesSent = false;

  const baseProperties = (): AnalyticsBaseProperties => {
    const properties: AnalyticsBaseProperties = {
      $lib: config.lib ?? "mattrax-api",
      $current_url: path,
      request_id: config.requestId,
      method,
      path,
    };

    if (config.release) {
      properties.$lib_version = config.release;
      properties.release = config.release;
    }

    if (config.environment) properties.environment = config.environment;

    if (config.deploymentId) properties.deployment_id = config.deploymentId;

    if (sessionId) properties.$session_id = sessionId;

    if (tenantId) properties.tenant_id = tenantId;

    if (roleName) properties.role_name = roleName;

    if (roleKind) properties.role_kind = roleKind;

    return properties;
  };

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

  /** Describe the tenant once per request, immediately before a real event. */
  const describeGroup = (target: string) => {
    const groupSet: AnalyticsProperties = {};

    if (tenantName) groupSet.name = tenantName;

    safeCapture({
      distinctId,
      event: "$groupidentify",
      properties: {
        ...baseProperties(),
        $group_type: "tenant",
        $group_key: target,
        $group_set: groupSet,
      },
      groups: { tenant: target },
    });
    groupToDescribe = undefined;
  };

  /**
   * Person fields for a caller that has no browser SDK (API tokens, scripts,
   * OAuth). They ride on the first event rather than an `$identify` per request.
   */
  const takePersonProperties = (): AnalyticsProperties | undefined => {
    if (personPropertiesSent || !personProperties) return undefined;

    personPropertiesSent = true;

    return personProperties;
  };

  const safeCaptureException = (
    cause: unknown,
    properties: AnalyticsProperties,
    distinct: string,
  ) => {
    const active = ensureClient();

    if (!active) return;
    captured = true;

    try {
      active.captureException(cause, distinct, properties);
    } catch (error) {
      warn(`PostHog exception capture failed: ${redactAnalyticsText(error)}`);
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

      const previous = distinctId;
      const userChanged = identifiedUserId !== identity.userId;
      identifiedUserId = identity.userId;
      distinctId = identity.userId;

      if (tenantId) groupToDescribe = tenantId;

      const set: AnalyticsProperties = {};

      if (identity.email) set.email = identity.email;

      if (identity.name) set.name = identity.name;

      if (identity.emailVerified !== undefined) set.email_verified = identity.emailVerified;

      // A browser SDK is the identity authority. It sends `$identify` when it
      // learns the user, which merges the anonymous id into the account. The
      // server only has to merge when the request still carries an anonymous
      // browser id; sending `$identify` on every authenticated request would
      // create one event per API call.
      if (!clientDistinctId) {
        if (Object.keys(set).length > 0) personProperties = set;

        return;
      }

      if (!userChanged || previous === distinctId || previous === identity.userId) return;

      const properties: IdentifyProperties = {
        ...baseProperties(),
        $set: set,
        $set_once: { first_seen_at: new Date(now()).toISOString() },
        $anon_distinct_id: previous,
      };

      const message: AnalyticsCaptureMessage = {
        distinctId,
        event: "$identify",
        properties,
      };

      if (tenantId) message.groups = { tenant: tenantId };

      safeCapture(message);

      // The browser sends the same merge, so describe the tenant now rather
      // than leaving the group without a name until a later mutation.
      if (groupToDescribe) describeGroup(groupToDescribe);
    },
    capture: (event, properties = {}) => {
      // Reads are the bulk of API traffic; describe the tenant on the rarer
      // named/product events instead of attaching one group event per request.
      if (groupToDescribe && event !== "api_request" && event !== "api_operation")
        describeGroup(groupToDescribe);

      const person = takePersonProperties();

      const message: AnalyticsCaptureMessage = {
        distinctId,
        event,
        properties: {
          ...baseProperties(),
          ...properties,
          ...(person ? { $set: person } : {}),
        },
      };

      if (tenantId) message.groups = { tenant: tenantId };

      safeCapture(message);
    },
    captureError: (cause, properties = {}) => {
      if (random() >= errorSampleRate) return;

      if (!withinErrorBudget(now(), maxErrors)) return;
      const person = takePersonProperties();

      safeCaptureException(
        sanitizeError(cause),
        { ...baseProperties(), ...properties, ...(person ? { $set: person } : {}) },
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
    case "/api/v1/completePasskeySignIn":
      return "auth_signed_in";
    case "/api/v1/completePasskeyRegistration":
      return "auth_register_submitted";
    case "/api/v1/signOut":
      return "auth_signed_out";
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
const AuthOutcomeBody = Schema.Struct({
  value: Schema.optional(Schema.Struct({ _tag: Schema.optional(Schema.String) })),
  _tag: Schema.optional(Schema.String),
});

export const authOutcomeFromResponse = async (
  response: Response,
): Promise<"authenticated" | "pending" | undefined> => {
  if (!(response.headers.get("content-type") ?? "").includes("json")) return undefined;

  try {
    const raw: Schema.Json = await response.clone().json();
    const body = Option.getOrUndefined(Schema.decodeUnknownOption(AuthOutcomeBody)(raw));

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
    // A Prometheus scrape is operational traffic, not product usage.
    pathname === "/api/metrics" ||
    pathname === "/api/version" ||
    pathname === "/api/openapi.json" ||
    pathname === "/api/webhooks/openapi.json" ||
    pathname === "/api/v1/getSession" ||
    pathname === "/api/v1/bootstrap" ||
    pathname === "/api/v1/mcp/context" ||
    pathname.startsWith("/api/docs") ||
    pathname.startsWith("/api/debug/")
  )
    return false;

  return pathname.startsWith("/api/") || pathname === "/api";
};
