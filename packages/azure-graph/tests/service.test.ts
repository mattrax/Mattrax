import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { AzureGraph, AzureGraphLive, type AzureGraphConfig } from "../src/index.js";

const tenantId = "11111111-1111-1111-1111-111111111111";

const config: AzureGraphConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  origin: "https://mattrax.test",
};

type FetchHandler = (
  url: string,
  init: globalThis.RequestInit | undefined,
) => Response | Promise<Response>;

function mockLayer(handler: FetchHandler) {
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return handler(url, init);
  };
  return FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)));
}

function run<A, E>(effect: Effect.Effect<A, E, AzureGraph>, handler: FetchHandler) {
  return Effect.runPromise(
    effect.pipe(Effect.provide(AzureGraphLive(config).pipe(Layer.provide(mockLayer(handler))))),
  );
}

function header(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) return new Headers(headers).get(name) ?? undefined;
  const record = headers as Record<string, string>;
  return record[name.toLowerCase()] ?? record[name];
}

function bodyText(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return "";
}

const isTokenRequest = (url: string) => url.includes("/oauth2/v2.0/token");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function tokenResponse(token = "graph-token", expiresIn = 3_600): Response {
  return json({ access_token: token, token_type: "Bearer", expires_in: expiresIn });
}

function domainsResponse(
  domains: ReadonlyArray<{
    id: string;
    isVerified: boolean;
    isDefault: boolean;
    isInitial: boolean;
  }>,
): Response {
  return json({ value: domains });
}

const contosoDomain = {
  id: "contoso.com",
  isVerified: true,
  isDefault: true,
  isInitial: false,
};

describe("AzureGraph", () => {
  it("requests a client-credentials token and sends it as a bearer token", async () => {
    const tokenBodies: string[] = [];
    let tokenMethod: string | undefined;
    let authorization: string | undefined;
    let domainsUrl: string | undefined;

    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;
        return yield* graph.domains(tenantId);
      }),
      (url, init) => {
        if (isTokenRequest(url)) {
          tokenMethod = init?.method;
          tokenBodies.push(bodyText(init));
          return tokenResponse("token-1");
        }
        authorization = header(init, "authorization");
        domainsUrl = url;
        return domainsResponse([contosoDomain]);
      },
    );

    expect(tokenMethod).toBe("POST");
    const tokenBody = new URLSearchParams(tokenBodies[0]!);
    expect(tokenBody.get("grant_type")).toBe("client_credentials");
    expect(tokenBody.get("client_id")).toBe("client-id");
    expect(tokenBody.get("client_secret")).toBe("client-secret");
    expect(tokenBody.get("scope")).toBe("https://graph.microsoft.com/.default");
    expect(authorization).toBe("Bearer token-1");
    expect(decodeURIComponent(domainsUrl!)).toContain(
      "/v1.0/domains?$select=id,isVerified,isDefault,isInitial",
    );
    expect(result).toEqual([contosoDomain]);
  });

  it("caches tokens per tenant until shortly before expiry", async () => {
    let tokenCalls = 0;

    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;
        yield* graph.domains(tenantId);
        return yield* graph.domains(tenantId);
      }),
      (url) => {
        if (isTokenRequest(url)) {
          tokenCalls++;
          return tokenResponse();
        }
        return domainsResponse([contosoDomain]);
      },
    );

    expect(tokenCalls).toBe(1);
    expect(result).toEqual([contosoDomain]);
  });

  it("follows a users delta nextLink one page at a time and returns the deltaLink", async () => {
    const requestedUrls: string[] = [];
    const nextLink = "https://graph.microsoft.com/v1.0/users/delta?$skiptoken=page-2";
    const deltaLink = "https://graph.microsoft.com/v1.0/users/delta?$deltatoken=final";

    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;
        const first = yield* graph.usersDelta(tenantId);
        const second = yield* graph.usersDelta(tenantId, first.nextLink!);
        return { first, second };
      }),
      (url) => {
        if (isTokenRequest(url)) return tokenResponse();
        requestedUrls.push(url);
        if (url === nextLink) {
          return json({
            value: [
              {
                id: "user-2",
                displayName: "Grace Hopper",
                mail: "grace@contoso.com",
                userPrincipalName: "grace@contoso.com",
                accountEnabled: true,
                givenName: "Grace",
                surname: "Hopper",
                userType: "Member",
              },
            ],
            "@odata.deltaLink": deltaLink,
          });
        }
        return json({
          value: [
            {
              id: "user-1",
              displayName: "Ada Lovelace",
              mail: null,
              userPrincipalName: "ada@contoso.com",
              accountEnabled: true,
              givenName: "Ada",
              surname: "Lovelace",
              userType: "Member",
            },
          ],
          "@odata.nextLink": nextLink,
        });
      },
    );

    expect(requestedUrls).toHaveLength(2);
    expect(decodeURIComponent(requestedUrls[0]!)).toContain(
      "/v1.0/users/delta?$select=id,displayName,mail,userPrincipalName,accountEnabled,givenName,surname,userType",
    );
    expect(result.first.items).toEqual([
      {
        id: "user-1",
        displayName: "Ada Lovelace",
        mail: undefined,
        userPrincipalName: "ada@contoso.com",
        accountEnabled: true,
        givenName: "Ada",
        surname: "Lovelace",
        userType: "Member",
        removed: undefined,
      },
    ]);
    expect(result.first.nextLink).toBe(nextLink);
    expect(result.first.deltaLink).toBeNull();
    expect(result.second.items[0]?.id).toBe("user-2");
    expect(result.second.nextLink).toBeNull();
    expect(result.second.deltaLink).toBe(deltaLink);
  });

  it("parses group membership additions and removals from members@delta", async () => {
    let requestedUrl: string | undefined;
    const deltaLink = "https://graph.microsoft.com/v1.0/groups/delta?$deltatoken=groups-final";

    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;
        return yield* graph.groupsDelta(tenantId);
      }),
      (url) => {
        if (isTokenRequest(url)) return tokenResponse();
        requestedUrl = url;
        return json({
          value: [
            {
              id: "group-1",
              displayName: "Engineering",
              description: "Builds things",
              "members@delta": [
                { id: "user-1", "@odata.type": "#microsoft.graph.user" },
                {
                  id: "user-2",
                  "@odata.type": "#microsoft.graph.user",
                  "@removed": { reason: "deleted" },
                },
              ],
            },
            { id: "group-2", "@removed": { reason: "deleted" } },
          ],
          "@odata.deltaLink": deltaLink,
        });
      },
    );

    expect(decodeURIComponent(requestedUrl!)).toContain(
      "/v1.0/groups/delta?$select=displayName,description,members",
    );
    expect(result.items).toEqual([
      {
        id: "group-1",
        displayName: "Engineering",
        description: "Builds things",
        members: [
          { id: "user-1", type: "user", removed: undefined },
          { id: "user-2", type: "user", removed: true },
        ],
      },
      {
        id: "group-2",
        displayName: "",
        description: undefined,
        members: undefined,
        removed: true,
      },
    ]);
    expect(result.nextLink).toBeNull();
    expect(result.deltaLink).toBe(deltaLink);
  });

  it("parses verified domains", async () => {
    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;
        return yield* graph.domains(tenantId);
      }),
      (url) =>
        isTokenRequest(url)
          ? tokenResponse()
          : domainsResponse([
              contosoDomain,
              {
                id: "mattrax.onmicrosoft.com",
                isVerified: true,
                isDefault: false,
                isInitial: true,
              },
            ]),
    );

    expect(result).toEqual([
      contosoDomain,
      {
        id: "mattrax.onmicrosoft.com",
        isVerified: true,
        isDefault: false,
        isInitial: true,
      },
    ]);
  });

  it("maps 403 responses to ConsentRequired", async () => {
    await expect(
      run(
        Effect.gen(function* () {
          const graph = yield* AzureGraph;
          return yield* graph.domains(tenantId);
        }),
        (url) =>
          isTokenRequest(url)
            ? tokenResponse()
            : json(
                {
                  error: {
                    code: "Authorization_RequestDenied",
                    message: "Insufficient privileges to complete the operation.",
                  },
                },
                403,
              ),
      ),
    ).rejects.toMatchObject({ _tag: "ConsentRequired", status: 403 });
  });

  it("retries a 429 once after the Retry-After delay", async () => {
    let graphCalls = 0;
    let tokenCalls = 0;
    const startedAt = Date.now();

    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;
        return yield* graph.domains(tenantId);
      }),
      (url) => {
        if (isTokenRequest(url)) {
          tokenCalls++;
          return tokenResponse();
        }
        graphCalls++;
        if (graphCalls === 1) {
          return new Response(JSON.stringify({ error: { code: "TooManyRequests" } }), {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "0.05" },
          });
        }
        return domainsResponse([contosoDomain]);
      },
    );

    expect(tokenCalls).toBe(1);
    expect(graphCalls).toBe(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(40);
    expect(result).toEqual([contosoDomain]);
  });

  it("maps invalid JSON to InvalidResponse", async () => {
    await expect(
      run(
        Effect.gen(function* () {
          const graph = yield* AzureGraph;
          return yield* graph.domains(tenantId);
        }),
        (url) =>
          isTokenRequest(url) ? tokenResponse() : new Response("this is not json", { status: 200 }),
      ),
    ).rejects.toMatchObject({ _tag: "InvalidResponse" });
  });

  it("builds an admin-consent URL with the configured origin", async () => {
    const url = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;
        return graph.consentUrl(tenantId);
      }),
      () => new Response("unused"),
    );

    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://login.microsoftonline.com");
    expect(parsed.pathname).toBe(`/${tenantId}/v2.0/adminconsent`);
    expect(parsed.searchParams.get("client_id")).toBe("client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://mattrax.test/api/v1/sso/azure/callback",
    );
  });
});
