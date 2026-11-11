/**
 * Minimal Sentry-compatible error tracking.
 *
 * The Worker already writes one structured JSON line per request. This module
 * adds optional cross-request grouping for uncaught errors and 5xx responses
 * by sending a Sentry envelope over `fetch`. It deliberately does not pull in
 * the Sentry SDK: an envelope is two JSON headers plus one event, and a small
 * sender keeps the Worker bundle and cold start untouched.
 *
 * Privacy rules are the same as request logging: no bodies, cookies, headers,
 * query strings, email addresses or long opaque tokens. Only the redacted
 * error message, method, path, request id, status and release tags leave the
 * Worker.
 */

export type ErrorTrackingConfig = {
  readonly dsn?: string;
  readonly environment?: string;
  readonly release?: string;
  readonly deploymentId?: string | null;
  /** Fraction of eligible events to send, 0..1. Defaults to 1. */
  readonly sampleRate?: number;
  /** Hard per-isolate cap. Defaults to 20 per minute. */
  readonly maxEventsPerMinute?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly warn?: (message: string, error?: unknown) => void;
};

export type ErrorEventInput = {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly status?: number;
  readonly errorTag?: string;
  /** Uncaught error or failure cause; only the redacted message is sent. */
  readonly error?: unknown;
};

export type ParsedSentryDsn = {
  readonly endpoint: string;
  readonly publicKey: string;
  readonly projectId: string;
};

/**
 * Parse `https://<public-key>@<host>/<project-id>`. A malformed or non-HTTP
 * DSN disables tracking rather than throwing at module load.
 */
export const parseSentryDsn = (dsn: string | undefined): ParsedSentryDsn | null => {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.username || !url.host) return null;
    const projectId = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!projectId) return null;
    const endpoint = `${url.protocol}//${url.host}/api/${encodeURIComponent(
      projectId,
    )}/envelope/?sentry_key=${encodeURIComponent(url.username)}&sentry_version=7`;
    return { endpoint, publicKey: url.username, projectId };
  } catch {
    return null;
  }
};

const MAX_MESSAGE_LENGTH = 500;

/** Remove emails and long opaque tokens, then bound the result. */
export const redactErrorText = (value: unknown): string => {
  const error = value instanceof Error ? value : undefined;
  const text = error ? `${error.name}: ${error.message}` : String(value);
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, "[redacted]")
    .slice(0, MAX_MESSAGE_LENGTH);
};

/** Path only: never forward query strings, which can contain tokens. */
export const safeEventPath = (path: string): string => path.split("?")[0]?.slice(0, 512) ?? "/";

export type SentryEventContext = {
  readonly eventId: string;
  readonly timestamp: Date;
  readonly environment?: string;
  readonly release?: string;
  readonly deploymentId?: string | null;
  readonly error?: unknown;
};

/**
 * Build a Sentry envelope (three newline-delimited JSON documents). Exported so
 * the payload can be asserted in tests without a network call.
 */
export const buildSentryEnvelope = (
  input: ErrorEventInput,
  context: SentryEventContext,
): string => {
  const path = safeEventPath(input.path);
  const eventId = context.eventId.replaceAll("-", "").slice(0, 32);
  const message =
    input.error !== undefined
      ? redactErrorText(input.error)
      : `${input.method} ${path} responded ${input.status ?? 500}`;
  const tags: Record<string, string> = {
    request_id: input.requestId,
    path,
    method: input.method,
  };
  if (input.status !== undefined) tags.status = String(input.status);
  if (input.errorTag) tags.error_tag = input.errorTag;
  if (context.deploymentId) tags.deployment_id = context.deploymentId;

  const envelope = {
    event_id: eventId,
    sent_at: context.timestamp.toISOString(),
  };
  const item = { type: "event", content_type: "application/json" };
  const event = {
    event_id: eventId,
    timestamp: context.timestamp.toISOString(),
    level: "error",
    platform: "javascript",
    logger: "mattrax.api",
    message: { formatted: message },
    tags,
    ...(context.environment ? { environment: context.environment } : {}),
    ...(context.release ? { release: context.release } : {}),
  };
  return `${JSON.stringify(envelope)}\n${JSON.stringify(item)}\n${JSON.stringify(event)}`;
};

/**
 * Only uncaught failures and 5xx responses are worth an error event. Health
 * probes still report a 5xx, but 4xx client mistakes and 429s do not.
 */
export const shouldReportError = (status: number | undefined, uncaught: boolean): boolean =>
  uncaught || (status !== undefined && status >= 500);

export type ErrorTracker = {
  readonly enabled: boolean;
  /** Returns whether an envelope was actually sent (useful for tests/logs). */
  capture(input: ErrorEventInput): Promise<boolean>;
};

/**
 * Create the tracker once per isolate so the per-minute cap and sampling are
 * shared across requests. `capture` never throws: a tracking outage must not
 * affect the response.
 */
export const createErrorTracker = (config: ErrorTrackingConfig = {}): ErrorTracker => {
  const dsn = parseSentryDsn(config.dsn);
  const sampleRate = Math.min(1, Math.max(0, config.sampleRate ?? 1));
  const maxEvents = Math.max(1, config.maxEventsPerMinute ?? 20);
  const now = config.now ?? Date.now;
  const random = config.random ?? Math.random;
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const warn = config.warn ?? ((message, error) => console.warn(message, error));
  const sentAt: number[] = [];

  if (!dsn || sampleRate <= 0 || typeof fetchImpl !== "function")
    return { enabled: false, capture: async () => false };

  const withinBudget = (): boolean => {
    const current = now();
    while (sentAt.length > 0 && current - sentAt[0]! >= 60_000) sentAt.shift();
    if (sentAt.length >= maxEvents) return false;
    sentAt.push(current);
    return true;
  };

  return {
    enabled: true,
    capture: async (input) => {
      if (random() >= sampleRate) return false;
      if (!withinBudget()) return false;
      try {
        const envelope = buildSentryEnvelope(input, {
          eventId: crypto.randomUUID(),
          timestamp: new Date(now()),
          ...(config.environment ? { environment: config.environment } : {}),
          ...(config.release ? { release: config.release } : {}),
          ...(config.deploymentId !== undefined ? { deploymentId: config.deploymentId } : {}),
          ...(input.error !== undefined ? { error: input.error } : {}),
        });
        const response = await fetchImpl(dsn.endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-sentry-envelope" },
          body: envelope,
        });
        if (!response.ok) warn(`Sentry rejected an error event (${response.status})`);
        return response.ok;
      } catch (error) {
        warn("Sentry error event delivery failed", error);
        return false;
      }
    },
  };
};
