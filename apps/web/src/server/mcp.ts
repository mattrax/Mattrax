import { env } from "cloudflare:workers";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import { DashboardDataset, DeviceQuery, enterpriseApi } from "@mattrax/enterprise-domain";

const API_BASE = "https://api.mattrax.internal";
const SERVER_NAME = "mattrax";
const SERVER_VERSION = "1.0.0";

type MeResponse = {
  user: { id: string; name: string; email: string };
  tenants: Array<{ id: string; name: string; slug: string; role: string }>;
};

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

const apiFetch = async (
  authorization: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
) => {
  const response = await env.API.fetch(
    new Request(`${API_BASE}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization,
        "x-mattrax-mcp-authorization": authorization,
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  );
  const contentType = response.headers.get("content-type") ?? "";
  let data: unknown;
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    data = await response.json().catch(() => null);
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
      base64: btoa(String.fromCharCode(...bytes)),
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
  await env.API.fetch(
    new Request(`${API_BASE}/api/v1/tenants/${encodeURIComponent(tenantId)}/mcp/activity`, {
      method: "POST",
      headers: {
        authorization,
        "x-mattrax-mcp-authorization": authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify(entry),
    }),
  ).catch(() => undefined);
};

const queryString = (value: unknown) => {
  if (typeof value !== "object" || value === null) return "";
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === undefined || raw === null) continue;
    if (Array.isArray(raw)) for (const item of raw) params.append(key, String(item));
    else params.set(key, String(raw));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
};

const toolName = (identifier: string) => {
  const name = identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .toLowerCase();
  if (name.length <= 64) return name;
  // Tool names are commonly capped at 64 characters. Keep a stable suffix so
  // two long endpoint identifiers cannot collapse onto the same tool.
  let hash = 0;
  for (const character of identifier) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return `${name.slice(0, 56)}_${Math.abs(hash).toString(36).slice(0, 7)}`;
};

const pathParameters = (path: string) =>
  [...path.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1]!);

const shouldExpose = (path: string) => {
  if (path.includes("/account")) return false;
  if (path.includes("/mcp/activity")) return false;
  if (path === "/v1/me" || path === "/v1/deleteMe") return false;
  if (path.includes("email-change") || path.includes("email-verification")) return false;
  return true;
};

/** Build the dynamic REST toolset plus two ergonomic discovery/query tools. */
const buildTools = (authorization: string, me: MeResponse) => {
  const listTenants = Tool.make("list_tenants", {
    description:
      "List the signed-in account, its tenants, and the role the user holds in each. Call this first, then pass a tenantId to other tools.",
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

  const tools: Array<ReturnType<typeof Tool.make>> = [listTenants, queryData, search, getOpenApi];
  const rest = new Map<string, { path: string; method: string }>();

  for (const [identifier, endpoint] of Object.entries(enterpriseApi.endpoints)) {
    const path = endpoint.path;
    if (!shouldExpose(path)) continue;
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
        description: `${identifier.replace(/([a-z])([A-Z])/g, "$1 $2")} — ${endpoint.method.toUpperCase()} ${path}. Pass path parameters by name; use queryParams for query strings and body for JSON payloads.`,
        parameters,
        success: Schema.Unknown,
      })
        .annotate(Tool.Readonly, endpoint.method.toUpperCase() === "GET")
        .annotate(Tool.Destructive, endpoint.method.toUpperCase() !== "GET") as ReturnType<
        typeof Tool.make
      >,
    );
    rest.set(name, { path, method: endpoint.method.toUpperCase() });
  }

  const handlers: Record<string, (params: any) => Effect.Effect<unknown, unknown>> = {
    list_tenants: () => Effect.succeed(me),
    search: (params) =>
      Effect.tryPromise({
        try: async () => {
          const path = `/api/v1/tenants/${encodeURIComponent(params.tenantId)}/search?q=${encodeURIComponent(params.q)}${params.limit ? `&limit=${params.limit}` : ""}`;
          const result = await apiFetch(authorization, path);
          await recordActivity(authorization, params.tenantId, {
            tool: "search",
            method: "GET",
            path,
            status: result.status,
          });
          if (!result.ok)
            throw new Error(
              `Search failed (${result.status}): ${typeof result.data === "string" ? result.data : JSON.stringify(result.data)}`,
            );
          return result.data;
        },
        catch: (error) => error,
      }),
    get_openapi: () =>
      Effect.tryPromise({
        try: async () => {
          const result = await apiFetch(authorization, "/api/openapi.json");
          return result.data;
        },
        catch: (error) => error,
      }),
    query_data: (params) =>
      Effect.tryPromise({
        try: async () => {
          const path = `/api/v1/tenants/${encodeURIComponent(params.tenantId)}/dashboard-query`;
          const result = await apiFetch(authorization, path, {
            method: "POST",
            body: {
              dataset: params.dataset,
              query: params.query,
              ...(params.groupBy ? { groupBy: params.groupBy } : {}),
              ...(params.limit ? { limit: params.limit } : {}),
            },
          });
          await recordActivity(authorization, params.tenantId, {
            tool: "query_data",
            method: "POST",
            path,
            status: result.status,
          });
          if (!result.ok)
            throw new Error(
              `Query failed (${result.status}): ${typeof result.data === "string" ? result.data : JSON.stringify(result.data)}`,
            );
          return result.data;
        },
        catch: (error) => error,
      }),
  };

  for (const [name, endpoint] of rest) {
    handlers[name] = (params) =>
      Effect.tryPromise({
        try: async () => {
          const path = endpoint.path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_, key: string) =>
            encodeURIComponent(String(params[key] ?? "")),
          );
          const query = queryString(params.queryParams);
          const body =
            endpoint.method === "GET" || endpoint.method === "HEAD" ? undefined : params.body;
          const result = await apiFetch(authorization, `${path}${query}`, {
            method: endpoint.method,
            ...(body === undefined ? {} : { body }),
          });
          const tenantId = typeof params.tenantId === "string" ? params.tenantId : undefined;
          if (tenantId)
            await recordActivity(authorization, tenantId, {
              tool: name,
              method: endpoint.method,
              path,
              status: result.status,
            });
          return { status: result.status, body: result.data };
        },
        catch: (error) => error,
      });
  }

  return { tools, handlers };
};

const mcpLayer = (authorization: string, me: MeResponse) => {
  const built = buildTools(authorization, me);
  const toolkit = Toolkit.make(...(built.tools as any));
  const registrations = McpServer.toolkit(toolkit as any).pipe(
    Layer.provide(toolkit.toLayer(built.handlers as any)),
  );
  return McpServer.layerHttpRequestScoped({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    path: "/mcp",
    protocols: [McpProtocol.v2026_07_28],
    instructions:
      "Mattrax manages Apple, Windows and Android fleets. Start with list_tenants to discover tenant ids. Use query_data for structured fleet/software filters, search for cross-entity lookups, and the generated tools for the rest of the dashboard API (devices, groups, policies, applications, dashboards, settings). Call get_openapi when you need request details for a generated tool. Every tool is scoped to the signed-in user's tenant membership. Account settings are intentionally not exposed.",
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

  const meResponse = await env.API.fetch(
    new Request("https://api.mattrax.internal/api/v1/me", {
      headers: {
        authorization,
        "x-mattrax-mcp-authorization": authorization,
        accept: "application/json",
      },
    }),
  );
  if (!meResponse.ok) return unauthorized(url.origin, request);
  const me = (await meResponse.json()) as MeResponse;

  const layer = mcpLayer(authorization, me).pipe(Layer.provide(HttpServer.layerServices));
  const web = HttpRouter.toWebHandler(layer as any);
  try {
    return withCors(await web.handler(request), request);
  } finally {
    await web.dispose().catch((cause) => console.error("MCP layer dispose failed", cause));
  }
};

export const handleMcpRequest = (event: { request: Request }) => handleMcp(event.request);
