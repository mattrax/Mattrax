import { expect, test } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { api, bootstrapTenant, gotoHydrated, stepUpGrant } from "./helpers";

const base64Url = (value: Buffer) => value.toString("base64url");

const mcpMeta = {
  _meta: {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
  },
};

test.describe("MCP", () => {
  test("authorises an OAuth client, exposes tools, records activity and can be revoked", async ({
    page,
  }) => {
    const tenant = await bootstrapTenant(page, "MCP Tenant");

    const resourceMetadata = await page.request.get("/.well-known/oauth-protected-resource");
    expect(resourceMetadata.status()).toBe(200);
    expect(await resourceMetadata.json()).toMatchObject({
      resource: "http://localhost:9050/mcp",
    });
    const authorizationMetadata = await page.request.get("/.well-known/oauth-authorization-server");
    expect(authorizationMetadata.status()).toBe(200);
    expect(await authorizationMetadata.json()).toMatchObject({
      authorization_endpoint: "http://localhost:9050/api/oauth/authorize",
      token_endpoint: "http://localhost:9050/api/oauth/token",
    });

    const registration = await page.request.post("/api/oauth/register", {
      data: {
        client_name: "E2E Agent",
        redirect_uris: ["http://localhost:7777/callback"],
      },
    });
    expect(registration.status()).toBe(201);
    const client = (await registration.json()) as { client_id: string };

    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    const authorize = await page.request.post("/api/oauth/authorize", {
      form: {
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: "http://localhost:7777/callback",
        scope: "mcp",
        state: "e2e",
        code_challenge: challenge,
        code_challenge_method: "S256",
        decision: "approve",
      },
      maxRedirects: 0,
    });
    expect(authorize.status()).toBe(302);
    const location = new URL(authorize.headers()["location"]!);
    expect(location.searchParams.get("state")).toBe("e2e");
    const code = location.searchParams.get("code")!;

    const tokenResponse = await page.request.post("/api/oauth/token", {
      form: {
        grant_type: "authorization_code",
        client_id: client.client_id,
        code,
        redirect_uri: "http://localhost:7777/callback",
        code_verifier: verifier,
      },
    });
    expect(tokenResponse.status()).toBe(200);
    const tokens = (await tokenResponse.json()) as { access_token: string };

    const headers = {
      authorization: `Bearer ${tokens.access_token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/list",
    };

    const unauthenticated = await page.request.post("/mcp", {
      headers: { ...headers, authorization: "" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: mcpMeta },
    });
    expect(unauthenticated.status()).toBe(401);
    expect(unauthenticated.headers()["www-authenticate"]).toContain("resource_metadata=");

    const list = await page.request.post("/mcp", {
      headers,
      data: { jsonrpc: "2.0", id: 2, method: "tools/list", params: mcpMeta },
    });
    expect(list.status()).toBe(200);
    const listed = (await list.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["list_tenants", "query_data", "list_devices", "patch_device"]),
    );

    const query = await page.request.post("/mcp", {
      headers: {
        ...headers,
        "mcp-method": "tools/call",
        "mcp-name": "query_data",
      },
      data: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "query_data",
          arguments: {
            tenantId: tenant.id,
            dataset: "devices",
            query: { all: [] },
          },
          ...mcpMeta,
        },
      },
    });
    expect(query.status()).toBe(200);
    const result = (await query.json()) as {
      result: { structuredContent: { total: number } };
    };
    expect(result.result.structuredContent.total).toBe(0);

    const devices = await page.request.post("/mcp", {
      headers: {
        ...headers,
        "mcp-method": "tools/call",
        "mcp-name": "list_devices",
      },
      data: {
        jsonrpc: "2.0",
        id: 31,
        method: "tools/call",
        params: {
          name: "list_devices",
          arguments: { tenantId: tenant.id },
          ...mcpMeta,
        },
      },
    });
    expect(devices.status()).toBe(200);
    const devicesResult = (await devices.json()) as {
      result: { structuredContent: { status: number; body: { rows: unknown[] } } };
    };
    expect(devicesResult.result.structuredContent.status).toBe(200);
    expect(Array.isArray(devicesResult.result.structuredContent.body.rows)).toBe(true);

    const connections = await api<{
      connections: Array<{
        id: string;
        clientName: string;
        requestCount: number;
        lastAction: string | null;
      }>;
    }>(page, "/api/v1/account/mcp-connections");
    const connection = connections.connections.find((item) => item.clientName === "E2E Agent");
    expect(connection).toBeDefined();
    expect(connection!.requestCount).toBeGreaterThan(0);
    expect(connection!.lastAction).toBe("mcp.tool_called");

    await gotoHydrated(page, "/account");
    await expect(page.getByText("Agent access (MCP)")).toBeVisible();
    await expect(page.getByText("E2E Agent")).toBeVisible();

    await api(page, `/api/v1/account/mcp-connections/${connection!.id}`, {
      method: "DELETE",
    });
    const afterRevoke = await page.request.post("/mcp", {
      headers,
      data: { jsonrpc: "2.0", id: 4, method: "tools/list", params: mcpMeta },
    });
    expect(afterRevoke.status()).toBe(401);

    const audit = await api<{
      entries?: Array<{ action: string; metadata?: unknown }>;
      rows?: Array<{ action: string; metadata?: unknown }>;
    }>(page, `/api/v1/tenants/${tenant.id}/audit-log?limit=20`);
    const entries = audit.entries ?? audit.rows ?? [];
    const toolAudit = entries.find((entry) => entry.action === "mcp.tool_called");
    expect(toolAudit).toBeDefined();
    expect(JSON.stringify(toolAudit!.metadata)).toContain('"type":"oauth"');
  });

  test("authenticates with an account API key and attributes actions to it", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "MCP Key Tenant");
    const grant = await stepUpGrant(page, "api-token-create");
    const created = await page.request.post("/api/v1/account/api-tokens", {
      data: { name: "Agent key", scopes: ["read", "write"] },
      headers: {
        origin: "http://localhost:9050",
        "x-effect-auth-csrf": "1",
        "x-mattrax-step-up": grant,
      },
    });
    expect(created.status()).toBe(200);
    const { token } = (await created.json()) as { token: string };

    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": "list_tenants",
    };
    const call = await page.request.post("/mcp", {
      headers,
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_tenants", arguments: {}, ...mcpMeta },
      },
    });
    expect(call.status()).toBe(200);

    const queryHeaders = { ...headers, "mcp-name": "query_data" };
    const query = await page.request.post("/mcp", {
      headers: queryHeaders,
      data: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "query_data",
          arguments: { tenantId: tenant.id, dataset: "devices", query: { all: [] } },
          ...mcpMeta,
        },
      },
    });
    expect(query.status()).toBe(200);

    const audit = await api<{
      entries: Array<{ action: string; metadata?: unknown }>;
    }>(page, `/api/v1/tenants/${tenant.id}/audit-log?limit=20`);
    const entry = audit.entries.find((item) => item.action === "mcp.tool_called");
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry!.metadata)).toContain('"type":"api_token"');
    expect(JSON.stringify(entry!.metadata)).toContain("Agent key");
  });
});
