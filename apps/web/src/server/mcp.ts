import { fetchApi } from "./api";
import { Effect, Layer, Option, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import type { DashboardQueryRequest } from "@mattrax/enterprise-domain/client";
import {
  DashboardDataset,
  DeviceQuery,
  enterpriseAccountApi,
  enterpriseApi,
  enterpriseAttributeApi,
  McpContextResponse as McpContextResponseSchema,
} from "@mattrax/enterprise-domain/client";
import type { McpContextResponse, MeResponse } from "@mattrax/enterprise-domain/client";

const API_BASE = "https://api.mattrax.internal";

const SERVER_NAME = "mattrax";

const SERVER_VERSION = "1.0.0";

const isString = Schema.is(Schema.String);

const isNumber = Schema.is(Schema.Number);

const isJsonObject = Schema.is(Schema.JsonObject);

const decodeJson = Schema.decodeUnknownOption(Schema.Json);

const decodeDataset = Schema.decodeUnknownOption(DashboardDataset);

const decodeDeviceQuery = Schema.decodeUnknownOption(DeviceQuery);

const decodeMcpContext = Schema.decodeUnknownOption(McpContextResponseSchema);

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

type ApiRequestBody = Schema.Json | DashboardQueryRequest;

interface ApiRequestInit {
  method: string;
  body?: ApiRequestBody;
}

type ToolParameters = Record<string, Schema.Json | undefined>;

type ToolHandler = (params: ToolParameters) => Effect.Effect<Schema.Json | MeResponse, Error>;

const withCors = (response: Response, request: Request) => {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin");

  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "origin");
  }

  headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "authorization, content-type, mcp-session-id, mcp-protocol-version, last-event-id",
  );
  headers.set("access-control-expose-headers", "mcp-session-id");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const unauthorized = (origin: string, request: Request) =>
  withCors(
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
          "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
        },
      },
    ),
    request,
  );

/** Upstream/API failures must not be reported as an authentication problem. */
const unavailable = (request: Request) =>
  withCors(
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: "The Mattrax API is temporarily unavailable" },
        id: null,
      }),
      {
        status: 503,
        headers: { "content-type": "application/json", "retry-after": "30" },
      },
    ),
    request,
  );

const statusMessage = (status: number) => {
  if (status === 400) return "Bad request";

  if (status === 401) return "Unauthorized";

  if (status === 403) return "Forbidden";

  if (status === 404) return "Not found";

  if (status === 409) return "Conflict";

  if (status === 422) return "Unprocessable request";

  if (status === 429) return "Too many requests";

  if (status >= 500) return "The Mattrax API returned an internal error";

  return "Request failed";
};

/**
 * Tool errors are model-visible. Keep only a short, single-line description:
 * never return a full REST response body to the MCP client.
 */
const failureMessage = (operation: string, status: number, data: Schema.Json) => {
  // Internal server errors often carry diagnostic text. Never forward it.
  const candidate = status >= 500 ? undefined : isString(data) ? data : undefined;
  const envelope = isJsonObject(data) ? data : undefined;
  const description = candidate ?? envelope?.error ?? envelope?.message ?? envelope?.detail;

  const summary =
    isString(description) && description.trim()
      ? description.trim().replaceAll(/\s+/g, " ").slice(0, 200)
      : statusMessage(status);

  return `${operation} failed (${status}): ${summary}`;
};

/** `String.fromCharCode(...bytes)` overflows the argument limit for large bodies. */
const toBase64 = (bytes: Uint8Array) => {
  const chunkSize = 0x8000;
  const chunks: string[] = [];

  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }

  return btoa(chunks.join(""));
};

const apiFetch = async (
  authorization: string,
  path: string,
  init: { method?: string; body?: ApiRequestBody } = {},
) => {
  let response: Response;

  const headers = new Headers({
    authorization,
    "x-mattrax-mcp-authorization": authorization,
    accept: "application/json",
  });

  const requestInit: RequestInit = { method: init.method ?? "GET", headers };

  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    requestInit.body = JSON.stringify(init.body);
  }

  try {
    response = await fetchApi(new Request(`${API_BASE}${path}`, requestInit));
  } catch {
    throw new Error("The Mattrax API could not be reached");
  }

  const contentType = response.headers.get("content-type") ?? "";
  let data: Schema.Json;

  if (contentType.includes("application/json") || contentType.includes("+json")) {
    data = Option.getOrUndefined(decodeJson(await response.json().catch(() => null))) ?? null;
  } else if (
    contentType.startsWith("text/") ||
    contentType.includes("csv") ||
    contentType.includes("xml") ||
    contentType.includes("javascript")
  ) {
    data = await response.text();
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    data = {
      contentType,
      base64: toBase64(bytes),
      bytes: bytes.byteLength,
    };
  }

  return {
    status: response.status,
    ok: response.ok,
    contentType,
    data,
  };
};

const recordActivity = async (
  authorization: string,
  tenantId: string,
  entry: { tool: string; method: string; path: string; status: number },
) => {
  try {
    const response = await fetchApi(
      new Request(`${API_BASE}/api/v1/tenants/${encodeURIComponent(tenantId)}/mcp/activity`, {
        method: "POST",
        headers: {
          authorization,
          "x-mattrax-mcp-authorization": authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify(entry),
      }),
    );

    if (!response.ok) console.error(`MCP activity recording failed with status ${response.status}`);
  } catch (error) {
    console.error("MCP activity recording failed", error);
  }
};

const queryString = (value: Schema.Json | undefined) => {
  if (!isJsonObject(value)) return "";
  const params = new URLSearchParams();

  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || raw === null) continue;

    if (Array.isArray(raw)) for (const item of raw) params.append(key, String(item));
    else params.set(key, String(raw));
  }

  const text = params.toString();

  return text ? `?${text}` : "";
};

const toolName = (identifier: string) => {
  const name = identifier
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll(/[^A-Za-z0-9_]/g, "_")
    .toLowerCase();

  if (name.length <= 64) return name;
  // Tool names are commonly capped at 64 characters. Keep a stable suffix so
  // two long endpoint identifiers cannot collapse onto the same tool.
  let hash = 0;

  for (const character of identifier) hash = (hash * 31 + character.charCodeAt(0)) | 0;

  return `${name.slice(0, 56)}_${Math.abs(hash).toString(36).slice(0, 7)}`;
};

const pathParameters = (path: string) =>
  [...path.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1]);

const shouldExpose = (path: string) => {
  if (path.includes("/account")) return false;

  if (path.includes("/mcp/")) return false;

  if (path === "/v1/me" || path === "/v1/deleteMe") return false;

  if (path.includes("email-change") || path.includes("email-verification")) return false;

  if (path.includes("/answers")) return false;

  // Credentials, secret material and administrator management are not part of
  // the consent grant an MCP client receives, even when the signed-in account
  // happens to hold the underlying permission.
  for (const blocked of [
    "/scim-tokens",
    "/webhooks",
    "/roles",
    "/invitations",
    "/accounts",
    "/members",
    "/abm",
    "/vpp",
    "/api-tokens",
    "/backups",
  ])
    if (path.includes(blocked)) return false;

  return true;
};

/**
 * Build the tools this credential may call.
 *
 * `methods` is the API's effective grant (credential ceiling intersected with
 * the account's role permissions), so a read-only or narrowed connection does
 * not advertise write tools at all. The API still authorises every call.
 */
const buildTools = (authorization: string, me: MeResponse, methods: ReadonlyArray<string>) => {
  const allowed = new Set(methods);

  const listTenants = Tool.make("list_tenants", {
    description:
      "List the signed-in account, its tenants, and the role the account holds in each. Call this first, then pass a tenantId to other tools.",
    success: Schema.Unknown,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false);

  const queryData = Tool.make("query_data", {
    description:
      "Query devices or reported software with the same structured filters and group-by dimensions as Mattrax dashboards. Returns rows and optional pie buckets.",
    parameters: Schema.Struct({
      tenantId: Schema.String,
      dataset: DashboardDataset,
      query: DeviceQuery,
      groupBy: Schema.optional(Schema.String),
      limit: Schema.optional(Schema.Number),
    }),
    success: Schema.Unknown,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false);

  const search = Tool.make("search", {
    description:
      "Search a tenant across devices, groups, policies and people by name, serial, email or other identifiers. Use query_data when you need structured device filters or aggregates.",
    parameters: Schema.Struct({
      tenantId: Schema.String,
      q: Schema.String,
      limit: Schema.optional(Schema.Number),
    }),
    success: Schema.Unknown,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false);

  const getOpenApi = Tool.make("get_openapi", {
    description:
      "Return the tenant REST API's OpenAPI document. Use it to discover the path parameters, query parameters and JSON body shape for the generated endpoint tools. Account settings endpoints appear in the document but are not exposed as MCP tools.",
    success: Schema.Unknown,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false);

  const tools: Array<Tool.Any> = [listTenants, getOpenApi];

  if (allowed.has("queryDashboard")) tools.push(queryData);

  if (allowed.has("search")) tools.push(search);

  const rest = new Map<string, { path: string; method: string }>();

  for (const [identifier, endpoint] of Object.entries({
    ...enterpriseAccountApi.endpoints,
    ...enterpriseApi.endpoints,
    ...enterpriseAttributeApi.endpoints,
  })) {
    const path = endpoint.path;

    if (!shouldExpose(path) || !allowed.has(identifier)) continue;
    const name = toolName(identifier);

    if (name === "list_tenants" || name === "query_data" || rest.has(name)) continue;
    const placeholders = pathParameters(path);

    const parameters = Schema.Struct({
      ...Object.fromEntries(placeholders.map((parameter) => [parameter, Schema.String])),
      queryParams: Schema.optional(Schema.Unknown),
      body: Schema.optional(Schema.Unknown),
    });

    tools.push(
      Tool.make(name, {
        description: `${identifier.replaceAll(/([a-z])([A-Z])/g, "$1 $2")} — ${endpoint.method.toUpperCase()} ${path}. Pass path parameters by name; use queryParams for query strings and body for JSON payloads.`,
        parameters,
        success: Schema.Unknown,
      })
        .annotate(Tool.Readonly, endpoint.method.toUpperCase() === "GET")
        .annotate(Tool.Destructive, endpoint.method.toUpperCase() !== "GET"),
    );
    rest.set(name, { path, method: endpoint.method.toUpperCase() });
  }

  const handlers = new Map<string, ToolHandler>([
    ["list_tenants", () => Effect.succeed(me)],
    [
      "search",
      (params) => {
        const tenantId = isString(params.tenantId) ? params.tenantId : undefined;
        const q = isString(params.q) ? params.q : undefined;

        if (tenantId === undefined || q === undefined)
          return Effect.fail(new Error("Search requires tenantId and q"));

        const limit = isNumber(params.limit) ? params.limit : undefined;

        return Effect.tryPromise({
          try: async () => {
            const path = `/api/v1/tenants/${encodeURIComponent(tenantId)}/search?q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ""}`;
            const result = await apiFetch(authorization, path);
            await recordActivity(authorization, tenantId, {
              tool: "search",
              method: "GET",
              path,
              status: result.status,
            });

            if (!result.ok) throw new Error(failureMessage("Search", result.status, result.data));

            return result.data;
          },
          catch: asError,
        });
      },
    ],
    [
      "get_openapi",
      () =>
        Effect.tryPromise({
          try: async () => {
            const result = await apiFetch(authorization, "/api/openapi.json");

            if (!result.ok)
              throw new Error(failureMessage("OpenAPI discovery", result.status, result.data));

            return result.data;
          },
          catch: asError,
        }),
    ],
    [
      "query_data",
      (params) => {
        const tenantId = isString(params.tenantId) ? params.tenantId : undefined;
        const dataset = Option.getOrUndefined(decodeDataset(params.dataset));
        const query = Option.getOrUndefined(decodeDeviceQuery(params.query));

        if (tenantId === undefined || dataset === undefined || query === undefined)
          return Effect.fail(new Error("Query requires tenantId, dataset and query"));

        const body: DashboardQueryRequest = {
          dataset,
          query,
          groupBy: isString(params.groupBy) ? params.groupBy : undefined,
          limit: isNumber(params.limit) ? params.limit : undefined,
        };

        return Effect.tryPromise({
          try: async () => {
            const path = `/api/v1/tenants/${encodeURIComponent(tenantId)}/dashboard-query`;
            const result = await apiFetch(authorization, path, { method: "POST", body });

            await recordActivity(authorization, tenantId, {
              tool: "query_data",
              method: "POST",
              path,
              status: result.status,
            });

            if (!result.ok) throw new Error(failureMessage("Query", result.status, result.data));

            return result.data;
          },
          catch: asError,
        });
      },
    ],
  ]);

  for (const [name, endpoint] of rest) {
    handlers.set(name, (params) =>
      Effect.tryPromise({
        try: async () => {
          const path = endpoint.path.replaceAll(/:([A-Za-z][A-Za-z0-9]*)/g, (_, key: string) =>
            encodeURIComponent(String(params[key] ?? "")),
          );

          const query = queryString(params.queryParams);

          const body =
            endpoint.method === "GET" || endpoint.method === "HEAD" ? undefined : params.body;

          const init: ApiRequestInit = { method: endpoint.method };

          if (body !== undefined) init.body = body;

          const result = await apiFetch(authorization, `${path}${query}`, init);

          const tenantId = isString(params.tenantId) ? params.tenantId : undefined;

          if (tenantId)
            await recordActivity(authorization, tenantId, {
              tool: name,
              method: endpoint.method,
              path,
              status: result.status,
            });

          if (!result.ok)
            throw new Error(
              failureMessage(`${endpoint.method} ${endpoint.path}`, result.status, result.data),
            );

          return { status: result.status, body: result.data };
        },
        catch: asError,
      }),
    );
  }

  const exposed = new Set(tools.map((tool) => tool.name));

  return {
    tools,
    handlers: Object.fromEntries([...handlers].filter(([name]) => exposed.has(name))),
  };
};

const mcpLayer = (authorization: string, me: MeResponse, methods: ReadonlyArray<string>) => {
  const built = buildTools(authorization, me, methods);
  const toolkit = Toolkit.make(...built.tools);

  const registrations = McpServer.toolkit(toolkit).pipe(
    // SAFETY: handler keys are the same tool names registered in `toolkit`,
    // and each handler returns the JSON payload the tool's success schema accepts.
    Layer.provide(toolkit.toLayer(built.handlers as Parameters<typeof toolkit.toLayer>[0])),
  );

  return McpServer.layerHttpRequestScoped({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    path: "/mcp",
    protocols: [McpProtocol.v2026_07_28],
    instructions:
      "Mattrax manages Apple, Windows and Android fleets. Start with list_tenants to discover tenant ids. Use query_data for structured fleet/software filters, search for cross-entity lookups, and the generated tools for the rest of the dashboard API (devices, groups, policies, applications, dashboards, settings). Call get_openapi when you need request details for a generated tool. Every tool is scoped to the signed-in account's tenant membership. Account settings are intentionally not exposed.",
    registrations,
  });
};

const handleMcp = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }), request);
  }

  const authorization = request.headers.get("authorization") ?? "";

  if (!/^Bearer\s+\S+/i.test(authorization)) return unauthorized(url.origin, request);

  let contextResponse: Response;

  try {
    contextResponse = await fetchApi(
      new Request("https://api.mattrax.internal/api/v1/mcp/context", {
        headers: {
          authorization,
          "x-mattrax-mcp-authorization": authorization,
          accept: "application/json",
        },
      }),
    );
  } catch (error) {
    console.error("MCP context lookup failed", error);

    return unavailable(request);
  }

  // Only a rejected credential is an MCP authentication failure. Anything else
  // (including a 5xx or a malformed response) is an availability problem.
  if (contextResponse.status === 401 || contextResponse.status === 403)
    return unauthorized(url.origin, request);

  if (!contextResponse.ok) {
    console.error(`MCP context lookup failed with status ${contextResponse.status}`);

    return unavailable(request);
  }

  let context: McpContextResponse;

  try {
    const body = Option.getOrUndefined(decodeMcpContext(await contextResponse.json()));

    if (body === undefined) throw new Error("Unexpected context response");

    context = body;
  } catch (error) {
    console.error("MCP context response could not be read", error);

    return unavailable(request);
  }

  const layer = mcpLayer(authorization, context.me, context.methods).pipe(
    Layer.provide(HttpServer.layerServices),
  );

  // SAFETY: `mcpLayer` provides the HTTP server services this layer needs; the
  // concrete layer type is opaque to the router constructor, which only reads
  // the router back out of the built layer.
  const web = HttpRouter.toWebHandler(
    layer as Layer.Layer<unknown, unknown, HttpRouter.HttpRouter>,
  );

  try {
    return withCors(await web.handler(request), request);
  } finally {
    await web.dispose().catch((error: unknown) => console.error("MCP layer dispose failed", error));
  }
};

export const handleMcpRequest = (event: { request: Request }) => handleMcp(event.request);
