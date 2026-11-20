import { Option, Schema } from "effect";

/**
 * Request-scoped observability helpers for the API Worker.
 *
 * Everything here is deliberately content-blind: we log the request line, the
 * response status, the tenant from the URL and an error tag. Bodies, query
 * strings, cookies and headers never reach the log, so tokens, reset links and
 * email addresses cannot leak through diagnostics.
 */

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Accept caller-supplied ids when they look like a UUID/ULID/trace id. Anything
 * else is replaced so a hostile header cannot inject log lines or break tracing.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._~:-]{8,128}$/;

export const resolveRequestId = (
  request: Request,
  generate: () => string = () => crypto.randomUUID(),
): string => {
  const supplied = request.headers.get(REQUEST_ID_HEADER)?.trim();

  return supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : generate();
};

const TENANT_PATH_PATTERN = /^\/api\/v1\/tenants\/([^/]+)(?:\/|$)/;

/** Tenant id from the canonical tenant-scoped API path, never from a body. */
export const tenantIdFromPath = (pathname: string): string | undefined => {
  const match = TENANT_PATH_PATTERN.exec(pathname);

  return match?.[1] || undefined;
};

export type RequestOutcome = "ok" | "client_error" | "server_error" | "rate_limited";

const outcomeForStatus = (status: number): RequestOutcome => {
  if (status === 429) return "rate_limited";

  if (status >= 500) return "server_error";

  if (status >= 400) return "client_error";

  return "ok";
};

/** A child span as it appears in a request log line. */
export type LoggedSpan = {
  readonly name: string;
  readonly durationMs: number;
  readonly status: "ok" | "error";
};

export type RequestLogEntry = {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly tenantId?: string;
  readonly errorTag?: string;
  /**
   * W3C trace context for this request. `traceId` is shared by the edge, the
   * API Worker and every child span, so one log line is enough to find the
   * others; `spanId` identifies this request's root span.
   */
  readonly traceId?: string;
  readonly spanId?: string;
  /** Slowest child spans (name, duration, status), already bounded by the caller. */
  readonly spans?: ReadonlyArray<LoggedSpan>;
  /** How many child spans were recorded, if more than `spans` holds. */
  readonly spanCount?: number;
  /** Short, secret-free description when the Worker itself threw. */
  readonly error?: string;
};

/** Stable JSON shape so Workers Logpush / Log Explorer can filter on fields. */
export const formatRequestLog = (entry: RequestLogEntry): string => {
  const outcome = outcomeForStatus(entry.status);

  return JSON.stringify({
    event: "http.request",
    requestId: entry.requestId,
    method: entry.method,
    path: entry.path,
    status: entry.status,
    outcome,
    durationMs: entry.durationMs,
    tenantId: entry.tenantId,
    traceId: entry.traceId,
    spanId: entry.spanId,
    spans: entry.spans,
    spanCount: entry.spanCount,
    errorTag: entry.errorTag,
    error: entry.error,
  });
};

export const logRequest = (
  entry: RequestLogEntry,
  log: Pick<Console, "log" | "error"> = console,
): void => {
  const line = formatRequestLog(entry);

  if (entry.status >= 500) log.error(line);
  else log.log(line);
};

const ErrorTagBody = Schema.Struct({ _tag: Schema.optional(Schema.String) });

/**
 * Read only the machine tag from an error response. Effect's `HttpApi` encodes
 * tagged failures as `{ "_tag": "EnterpriseBadRequest", ... }`; the rest of the
 * body (which can contain tenant data) is never read or logged.
 */
export const errorTagFromBody = (body: Schema.Json): string | undefined => {
  const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorTagBody)(body));

  return parsed?._tag && parsed._tag.length > 0 ? parsed._tag.slice(0, 120) : undefined;
};

export const readErrorTag = async (response: Response): Promise<string | undefined> => {
  if (response.status < 400) return undefined;
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("json")) return undefined;

  try {
    const body = Option.getOrUndefined(
      Schema.decodeUnknownOption(Schema.Json)(await response.clone().json()),
    );

    return body === undefined ? undefined : errorTagFromBody(body);
  } catch {
    return undefined;
  }
};

/**
 * Authenticated API responses default to `no-store`. Routes that return a
 * deliberately cacheable artifact (the OpenAPI document, a download with its
 * own policy) set `cache-control` themselves and are left untouched, so the
 * default can never turn a private response into a shared-cache hit.
 */
export const withDefaultNoStore = (response: Response): Response => {
  if (response.headers.has("cache-control")) return response;

  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

/** Attach the request id to every response, including ones produced by Effect. */
export const withRequestId = (response: Response, requestId: string): Response => {
  const headers = new Headers(response.headers);
  headers.set(REQUEST_ID_HEADER, requestId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const errorResponse = (
  status: number,
  requestId: string,
  body: { error: string; message: string },
): Response =>
  withRequestId(
    new Response(JSON.stringify({ ...body, requestId }), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
    requestId,
  );

/** Health/readiness probes and metric scrapes are high-frequency; only log failures. */
export const shouldLogRequest = (path: string, status: number): boolean => {
  if (status >= 400) return true;

  return (
    path !== "/api/health" && path !== "/health" && path !== "/api/ready" && path !== "/api/metrics"
  );
};
