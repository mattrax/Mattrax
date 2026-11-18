# AI agents and MCP

Mattrax exposes a Model Context Protocol server so an agent can inspect and
manage a fleet without a hand-written REST client. The server lives at `/mcp`
on your Mattrax origin.

## Authenticate

Two credentials work:

- **OAuth** — an MCP client can discover the authorization server from
  `/.well-known/oauth-protected-resource`, register itself, and ask for access.
  The consent screen shows the client, your account, the tenants you belong to
  and a permission picker grouped like the dashboard's RBAC editor. Choose
  **No access**, **Read** or **Write** per group, or expand a group to select
  individual permissions. The default matches full role access; narrowing it is
  remembered if you re-authorise the same client. Each authorised client appears
  under **Account → Agent access (MCP)**, with its granted permissions, request
  count, last action and last-used time.
- **Account API token** — the same tokens under **Account → API tokens** can be
  sent as `Authorization: Bearer …`. Narrow the token to the permissions the
  agent needs; the MCP tool list is filtered to that grant.

MCP tokens are per user. Every tool checks that the user is still a member of the
requested tenant and that both the credential grant and the current role allow
the permission. The tool catalogue is filtered from that effective set, so a
read-only connection does not advertise write tools. Account settings are
deliberately unavailable to MCP tokens, even if a tool is not listed in the
agent's tool catalogue.

## Tools

`list_tenants` returns the account and its tenants. Call it first, then pass a
tenant id to the other tools.

`query_data` uses the same structured query language as dashboards:

```json
{
  "tenantId": "…",
  "dataset": "devices",
  "query": {
    "all": [
      { "field": "platform", "op": "eq", "value": "apple" },
      { "field": "staleDays", "op": "gte", "value": 14 }
    ]
  },
  "groupBy": "health"
}
```

`search` performs a cross-entity lookup across devices, groups, policies and
people. `get_openapi` returns the tenant REST API's OpenAPI document. The remaining
tools are generated from that API: devices, groups, policies, applications,
dashboards, enrollment, identity, webhooks, billing and audit all have a tool.
Path parameters are named exactly as they appear in the API path
(`tenantId`, `id`, `dashboardId`, …); use `queryParams` for query strings and
`body` for JSON payloads.

## Audit and revocation

Every MCP tool call writes an `mcp.tool_called` audit entry. Other actions an
agent takes are recorded like dashboard actions. Audit entries include the
credential that made the call:

- `credential.type = "oauth"` with the client name, for an OAuth client
- `credential.type = "api_token"` with the token name, for an API key

Revoking a client under **Account → Agent access (MCP)** immediately invalidates
its access and refresh tokens. Revoking an API token invalidates that key.

## Protocol details

- Transport: Streamable HTTP at `/mcp`
- OAuth: authorization code with PKCE (S256), public clients, refresh tokens
- Access tokens expire after one hour; refresh tokens after thirty days
- Discovery:
  - `/.well-known/oauth-protected-resource`
  - `/.well-known/oauth-authorization-server`
