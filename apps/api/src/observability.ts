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

export type RequestLogEntry = {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly tenantId?: string;
  readonly errorTag?: string;
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
    ...(entry.tenantId ? { tenantId: entry.tenantId } : {}),
    ...(entry.errorTag ? { errorTag: entry.errorTag } : {}),
    ...(entry.error ? { error: entry.error } : {}),
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

/**
 * Read only the machine tag from an error response. Effect's `HttpApi` encodes
 * tagged failures as `{ "_tag": "EnterpriseBadRequest", ... }`; the rest of the
 * body (which can contain tenant data) is never read or logged.
 */
export const errorTagFromBody = (body: unknown): string | undefined => {
  if (!body || typeof body !== "object") return undefined;
  const tag = (body as { _tag?: unknown })._tag;
  return typeof tag === "string" && tag.length > 0 ? tag.slice(0, 120) : undefined;
};

export const readErrorTag = async (response: Response): Promise<string | undefined> => {
  if (response.status < 400) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return undefined;
  try {
    return errorTagFromBody(await response.clone().json());
  } catch {
    return undefined;
  }
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

/** Health/readiness probes are high-frequency; only log them when they fail. */
export const shouldLogRequest = (path: string, status: number): boolean => {
  if (status >= 400) return true;
  return path !== "/api/health" && path !== "/health" && path !== "/api/ready";
};
