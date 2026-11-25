import { describe, expect, it } from "vitest";
import { Effect, Fiber, Layer, Logger, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import {
  AzureGraph,
  AzureGraphConsentRequired,
  AzureGraphConsentRevocationFailed,
  AzureGraphInvalidResponse,
  AzureGraphInvalidUrl,
  AzureGraphLive,
  AzureGraphNotFound,
  AzureGraphPaginationExhausted,
  AzureGraphRequestFailed,
  AzureGraphUnauthorized,
  GRAPH_PAGINATION_LIMIT,
  makeAzureGraphTokenCache,
} from "../src/index.js";
import type { AzureGraphConfig, AzureGraphService } from "../src/index.js";

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
    const url = input instanceof URL ? input.href : input instanceof Request ? input.url : input;

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

  return new Headers(headers).get(name) ?? undefined;
}

function bodyText(init: RequestInit | undefined): string {
  const body = init?.body;

  if (Schema.is(Schema.String)(body)) return body;

  if (body instanceof URLSearchParams) return body.toString();

  if (body instanceof Uint8Array) return new TextDecoder().decode(body);

  return "";
}

const isTokenRequest = (url: string) => url.includes("/oauth2/v2.0/token");

function json(body: Schema.Json, status = 200): Response {
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
    const tokenBody = new URLSearchParams(tokenBodies[0]);
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

  it("reuses a shared token cache across rebuilt request layers", async () => {
    let tokenCalls = 0;
    const tokenCache = makeAzureGraphTokenCache();
    const layer = () =>
      AzureGraphLive(config, { tokenCache }).pipe(
        Layer.provide(
          mockLayer((url) => {
            if (isTokenRequest(url)) {
              tokenCalls++;

              return tokenResponse("shared-token");
            }

            return domainsResponse([contosoDomain]);
          }),
        ),
      );
    const domains = (graphLayer: ReturnType<typeof layer>) =>
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.domains(tenantId);
      }).pipe(Effect.provide(graphLayer));

    await Effect.runPromise(domains(layer()));
    await Effect.runPromise(domains(layer()));

    expect(tokenCalls).toBe(1);
  });

  it("keys a shared cache by app registration and secret", async () => {
    const cases: ReadonlyArray<readonly [AzureGraphConfig, AzureGraphConfig]> = [
      [
        { ...config, clientId: "client-a", clientSecret: "secret-a" },
        { ...config, clientId: "client-a", clientSecret: "secret-b" },
      ],
      [
        { ...config, clientId: "client-c", clientSecret: "secret-c" },
        { ...config, clientId: "client-d", clientSecret: "secret-c" },
      ],
    ];

    for (const [first, second] of cases) {
      let tokenCalls = 0;
      const tokenCache = makeAzureGraphTokenCache();
      const layer = (graphConfig: AzureGraphConfig) =>
        AzureGraphLive(graphConfig, { tokenCache }).pipe(
          Layer.provide(
            mockLayer((url) => {
              if (isTokenRequest(url)) {
                tokenCalls++;

                return tokenResponse(`token-${tokenCalls}`);
              }

              return domainsResponse([contosoDomain]);
            }),
          ),
        );
      const domains = (graphLayer: ReturnType<typeof layer>) =>
        Effect.gen(function* () {
          const graph = yield* AzureGraph;

          return yield* graph.domains(tenantId);
        }).pipe(Effect.provide(graphLayer));

      await Effect.runPromise(domains(layer(first)));
      await Effect.runPromise(domains(layer(second)));

      expect(tokenCalls).toBe(2);
    }
  });

  it("expires and revokes a shared token instead of reusing it", async () => {
    let tokenCalls = 0;
    let reject = false;
    const tokenCache = makeAzureGraphTokenCache();
    const layer = () =>
      AzureGraphLive(config, { tokenCache }).pipe(
        Layer.provide(
          mockLayer((url) => {
            if (isTokenRequest(url)) {
              tokenCalls++;

              return tokenResponse(`token-${tokenCalls}`);
            }

            return reject ? json({ error: "revoked" }, 401) : domainsResponse([contosoDomain]);
          }),
        ),
      );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_000_000);
        const first = yield* Effect.gen(function* () {
          const graph = yield* AzureGraph;

          return yield* graph.domains(tenantId);
        }).pipe(Effect.provide(layer()));

        yield* TestClock.adjust("2 hours");

        const afterExpiry = yield* Effect.gen(function* () {
          const graph = yield* AzureGraph;

          return yield* graph.domains(tenantId);
        }).pipe(Effect.provide(layer()));

        reject = true;

        const revoked = yield* Effect.flip(
          Effect.gen(function* () {
            const graph = yield* AzureGraph;

            return yield* graph.domains(tenantId);
          }).pipe(Effect.provide(layer())),
        );

        reject = false;

        const afterRevocation = yield* Effect.gen(function* () {
          const graph = yield* AzureGraph;

          return yield* graph.domains(tenantId);
        }).pipe(Effect.provide(layer()));

        return { first, afterExpiry, revoked, afterRevocation };
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(result.first).toEqual([contosoDomain]);
    expect(result.afterExpiry).toEqual([contosoDomain]);
    expect(result.revoked).toBeInstanceOf(AzureGraphUnauthorized);
    expect(result.afterRevocation).toEqual([contosoDomain]);
    // Initial token, refresh after expiry, refresh after 401 invalidation.
    expect(tokenCalls).toBe(3);
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
    expect(decodeURIComponent(requestedUrls[0])).toContain(
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
    ).rejects.toBeInstanceOf(AzureGraphConsentRequired);
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
    ).rejects.toBeInstanceOf(AzureGraphInvalidResponse);
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

/** Never responds, but rejects when the underlying fetch is aborted. */
const hangingResponse = (_url: string, init: RequestInit | undefined) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError")),
    );
  });

function runWithConfig<A, E>(
  effect: Effect.Effect<A, E, AzureGraph>,
  handler: FetchHandler,
  overrides: Partial<AzureGraphConfig>,
) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        AzureGraphLive({ ...config, ...overrides }).pipe(Layer.provide(mockLayer(handler))),
      ),
    ),
  );
}

function runWithClock<A, E>(
  effect: Effect.Effect<A, E, AzureGraph>,
  handler: FetchHandler,
  overrides: Partial<AzureGraphConfig> = {},
) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        AzureGraphLive({ ...config, ...overrides }).pipe(Layer.provide(mockLayer(handler))),
      ),
      Effect.provide(TestClock.layer()),
    ),
  );
}

describe("AzureGraph outbound timeouts", () => {
  const domains = Effect.gen(function* () {
    const graph = yield* AzureGraph;

    return yield* graph.domains(tenantId);
  });

  it("fails a hung Graph request with a timeout instead of hanging", async () => {
    const started = Date.now();

    const error = await runWithConfig(
      domains,
      (url, init) => (isTokenRequest(url) ? tokenResponse() : hangingResponse(url, init)),
      { timeoutMs: 50 },
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphRequestFailed);
    expect(error instanceof Error ? error.message : "").toContain("timed out after 50ms");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("bounds the token request too", async () => {
    const error = await runWithConfig(domains, hangingResponse, { timeoutMs: 50 }).catch(
      (error_: unknown) => error_,
    );

    expect(error).toBeInstanceOf(AzureGraphRequestFailed);
    expect(error instanceof Error ? error.message : "").toContain("timed out after 50ms");
  });

  it("still retries a throttled request within the deadline", async () => {
    let graphCalls = 0;

    const result = await runWithConfig(
      domains,
      (url) => {
        if (isTokenRequest(url)) return tokenResponse();
        graphCalls++;

        if (graphCalls === 1) {
          return json({ error: "throttled" }, 429);
        }

        return domainsResponse([contosoDomain]);
      },
      { timeoutMs: 1_000, retryDelayMs: 1 },
    );

    expect(graphCalls).toBe(2);
    expect(result).toEqual([contosoDomain]);
  });
});

const autopilotDevice = {
  id: "autopilot-1",
  serialNumber: "ABC123",
  hardwareIdentifier: "aGFzaA==",
  groupTag: "Engineering",
  model: "Surface Laptop",
  manufacturer: "Microsoft",
  azureADDeviceId: "entra-device-1",
  enrollmentState: "enrolled",
  deploymentProfileAssignmentStatus: "assignedInSync",
  deploymentProfileAssignedDateTime: "2026-01-01T00:00:00Z",
  lastContactedDateTime: "2026-01-02T00:00:00Z",
};

describe("AzureGraph Autopilot", () => {
  it("imports hardware hashes with the documented Graph request shape", async () => {
    const requests: Array<{ url: string; method?: string; body?: unknown; auth?: string }> = [];

    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.importAutopilotDevices(tenantId, [
          {
            serialNumber: "ABC123",
            hardwareIdentifier: "aGFzaA==",
            groupTag: "Engineering",
          },
        ]);
      }),
      (url, init) => {
        if (isTokenRequest(url)) return tokenResponse();
        requests.push({
          url,
          method: init?.method,
          body: JSON.parse(bodyText(init)),
          auth: header(init, "authorization"),
        });

        return json(autopilotDevice);
      },
    );

    expect(requests).toHaveLength(1);
    expect(decodeURIComponent(requests[0].url)).toContain(
      "/v1.0/deviceManagement/importedWindowsAutopilotDeviceIdentities",
    );
    expect(requests[0].method).toBe("POST");
    expect(requests[0].auth).toBe("Bearer graph-token");
    expect(requests[0].body).toMatchObject({
      "@odata.type": "#microsoft.graph.importedWindowsAutopilotDeviceIdentity",
      serialNumber: "ABC123",
      hardwareIdentifier: "aGFzaA==",
      groupTag: "Engineering",
    });
    expect(result[0]).toMatchObject({
      id: "autopilot-1",
      serialNumber: "ABC123",
      profileStatus: "assigned",
      enrollmentState: "enrolled",
      azureAdDeviceId: "entra-device-1",
    });
  });

  it("accepts a collection-shaped import response", async () => {
    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.importAutopilotDevices(tenantId, [
          { serialNumber: "ABC123", hardwareIdentifier: "aGFzaA==" },
        ]);
      }),
      (url) => (isTokenRequest(url) ? tokenResponse() : json({ value: [autopilotDevice] })),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.serialNumber).toBe("ABC123");
  });

  it("lists device identities across nextLinks", async () => {
    const nextLink =
      "https://graph.microsoft.com/v1.0/deviceManagement/windowsAutopilotDeviceIdentities?$skiptoken=2";

    const urls: string[] = [];

    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;
        const first = yield* graph.listAutopilotDevices(tenantId);
        const second = yield* graph.listAutopilotDevices(tenantId, first.nextLink!);

        return { first, second };
      }),
      (url) => {
        if (isTokenRequest(url)) return tokenResponse();
        urls.push(url);

        return url === nextLink
          ? json({ value: [{ ...autopilotDevice, id: "autopilot-2", serialNumber: "DEF456" }] })
          : json({ value: [autopilotDevice], "@odata.nextLink": nextLink });
      },
    );

    expect(decodeURIComponent(urls[0])).toContain(
      "/v1.0/deviceManagement/windowsAutopilotDeviceIdentities?$top=100",
    );
    expect(result.first.items).toHaveLength(1);
    expect(result.first.nextLink).toBe(nextLink);
    expect(result.second.items[0]?.serialNumber).toBe("DEF456");
    expect(result.second.nextLink).toBeNull();
  });

  it("creates, updates and assigns deployment profiles", async () => {
    const requests: Array<{ url: string; method?: string; body?: any }> = [];

    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        const created = yield* graph.createAutopilotProfile(tenantId, {
          displayName: "Standard",
          deploymentMode: "userDriven",
          joinType: "azureADJoin",
          deviceNameTemplate: "DESKTOP-%SERIAL%",
          enableDevicePreparation: true,
        });

        const updated = yield* graph.updateAutopilotProfile(tenantId, created.id, {
          displayName: "Standard v2",
          deploymentMode: "selfDeploying",
          joinType: "azureADJoinUsingDeviceAuth",
          enableDevicePreparation: false,
        });

        yield* graph.assignAutopilotProfile(tenantId, created.id, "group-1");

        return { created, updated };
      }),
      (url, init) => {
        if (isTokenRequest(url)) return tokenResponse();
        requests.push({ url, method: init?.method, body: JSON.parse(bodyText(init)) });

        if (url.endsWith("/assign")) return new Response(null, { status: 204 });

        return json({
          id: "profile-1",
          displayName: requests.at(-1)?.body.displayName,
          deploymentMode: requests.at(-1)?.body.deploymentMode,
          joinType: requests.at(-1)?.body.joinType,
          deviceNameTemplate: requests.at(-1)?.body.deviceNameTemplate,
          enableWhiteGlove: requests.at(-1)?.body.enableWhiteGlove,
        });
      },
    );

    expect(decodeURIComponent(requests[0].url)).toContain(
      "/v1.0/deviceManagement/windowsAutopilotDeploymentProfiles",
    );
    expect(requests[0].method).toBe("POST");
    expect(requests[0].body).toMatchObject({
      "@odata.type": "#microsoft.graph.windowsAutopilotDeploymentProfile",
      displayName: "Standard",
      deploymentMode: "userDriven",
      joinType: "azureADJoin",
      enableWhiteGlove: true,
    });
    expect(requests[1].method).toBe("PATCH");
    expect(requests[1].body).toMatchObject({ displayName: "Standard v2" });
    expect(requests[1].body["@odata.type"]).toBeUndefined();
    expect(requests[2].url).toContain("/profile-1/assign");
    expect(requests[2].body).toMatchObject({
      "@odata.type": "#microsoft.graph.windowsAutopilotDeploymentProfileAssignment",
      target: {
        "@odata.type": "#microsoft.graph.groupAssignmentTarget",
        groupId: "group-1",
      },
    });
    expect(result.created.id).toBe("profile-1");
    expect(result.updated.id).toBe("profile-1");
  });

  it("deletes a device identity and maps 404 to NotFound", async () => {
    let method: string | undefined;
    await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;
        yield* graph.deleteAutopilotDevice(tenantId, "autopilot-1");
      }),
      (url, init) => {
        if (isTokenRequest(url)) return tokenResponse();
        method = init?.method;

        return new Response(null, { status: 204 });
      },
    );
    expect(method).toBe("DELETE");

    await expect(
      run(
        Effect.gen(function* () {
          const graph = yield* AzureGraph;
          yield* graph.deleteAutopilotDevice(tenantId, "missing");
        }),
        (url) => (isTokenRequest(url) ? tokenResponse() : json({ error: "not found" }, 404)),
      ),
    ).rejects.toBeInstanceOf(AzureGraphNotFound);
  });
});

describe("AzureGraph delegated consent revocation", () => {
  const servicePrincipalId = "sp-1";
  const nextGrantsLink =
    "https://graph.microsoft.com/v1.0/oauth2PermissionGrants?$skiptoken=grants-2";

  it("finds our service principal and deletes only our delegated grants", async () => {
    const requested: Array<{ url: string; method?: string }> = [];
    let grantPage = 0;

    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.revokeDelegatedConsent(tenantId);
      }),
      (url, init) => {
        requested.push({ url, method: init?.method });

        if (isTokenRequest(url)) return tokenResponse();

        const decoded = decodeURIComponent(url);

        if (decoded.includes("/servicePrincipals?")) {
          expect(decoded).toContain("appId eq 'client-id'");

          return json({ value: [{ id: servicePrincipalId }] });
        }

        if (decoded.includes("/oauth2PermissionGrants?") && init?.method !== "DELETE") {
          // Only the first page carries the filter; the nextLink is followed
          // verbatim, as Graph returns it.
          if (!decoded.includes("$skiptoken"))
            expect(decoded).toContain(`clientId eq '${servicePrincipalId}'`);
          grantPage++;

          if (grantPage === 1)
            return json({
              value: [
                { id: "grant-ours-1", clientId: servicePrincipalId },
                { id: "grant-theirs", clientId: "another-app" },
              ],
              "@odata.nextLink": nextGrantsLink,
            });

          return json({ value: [{ id: "grant-ours-2", clientId: servicePrincipalId }] });
        }

        return new Response(null, { status: 204 });
      },
    );

    expect(result).toEqual({ servicePrincipalId, grantsRemoved: 2 });

    const deletes = requested.filter((entry) => entry.method === "DELETE");
    expect(deletes.map((entry) => entry.url.split("/").at(-1))).toEqual([
      "grant-ours-1",
      "grant-ours-2",
    ]);
    expect(deletes.some((entry) => entry.url.includes("grant-theirs"))).toBe(false);
  });

  it("treats a missing service principal as already revoked", async () => {
    const methods: Array<string | undefined> = [];

    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.revokeDelegatedConsent(tenantId);
      }),
      (url, init) => {
        if (isTokenRequest(url)) return tokenResponse();

        methods.push(init?.method);

        return json({ value: [] });
      },
    );

    expect(result).toEqual({ servicePrincipalId: null, grantsRemoved: 0 });
    // Only the service-principal lookup ran; no grant request was made.
    expect(methods).toEqual(["GET"]);
  });

  it("treats a grant that disappeared before deletion as removed", async () => {
    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.revokeDelegatedConsent(tenantId);
      }),
      (url) => {
        if (isTokenRequest(url)) return tokenResponse();

        const decoded = decodeURIComponent(url);

        if (decoded.includes("/servicePrincipals?"))
          return json({ value: [{ id: servicePrincipalId }] });

        if (decoded.includes("/oauth2PermissionGrants?"))
          return json({ value: [{ id: "grant-1", clientId: servicePrincipalId }] });

        return json({ error: "not found" }, 404);
      },
    );

    expect(result).toEqual({ servicePrincipalId, grantsRemoved: 1 });
  });

  it("surfaces a Graph rejection so the caller can report a failed revocation", async () => {
    await expect(
      run(
        Effect.gen(function* () {
          const graph = yield* AzureGraph;

          return yield* graph.revokeDelegatedConsent(tenantId);
        }),
        (url) => {
          if (isTokenRequest(url)) return tokenResponse();

          return json({ error: "forbidden" }, 403);
        },
      ),
    ).rejects.toBeInstanceOf(AzureGraphConsentRequired);
  });

  it("treats a deleted enterprise application as already revoked", async () => {
    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.revokeDelegatedConsent(tenantId);
      }),
      (url) => {
        if (isTokenRequest(url))
          return json(
            {
              error: "invalid_client",
              error_description:
                "AADSTS700016: Application with identifier 'client-id' was not found in the directory.",
            },
            400,
          );

        throw new Error("Graph must not be called when the token endpoint says the app is gone");
      },
    );

    expect(result).toEqual({ servicePrincipalId: null, grantsRemoved: 0 });
  });

  it("treats a deleted tenant as already revoked", async () => {
    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.revokeDelegatedConsent(tenantId);
      }),
      (url) => {
        if (isTokenRequest(url))
          return json(
            {
              error: "invalid_request",
              error_description: "AADSTS90002: Tenant not found.",
            },
            400,
          );

        throw new Error("Graph must not be called when the token endpoint says the tenant is gone");
      },
    );

    expect(result).toEqual({ servicePrincipalId: null, grantsRemoved: 0 });
  });

  it("still fails when the token endpoint rejects the client secret", async () => {
    await expect(
      run(
        Effect.gen(function* () {
          const graph = yield* AzureGraph;

          return yield* graph.revokeDelegatedConsent(tenantId);
        }),
        (url) =>
          isTokenRequest(url)
            ? json(
                {
                  error: "invalid_client",
                  error_description: "AADSTS7000215: Invalid client secret provided.",
                },
                400,
              )
            : new Response(null, { status: 204 }),
      ),
    ).rejects.toBeInstanceOf(AzureGraphRequestFailed);
  });

  it("reports how many grants were removed before a delete failed", async () => {
    let deletes = 0;

    const error = await runWithConfig(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.revokeDelegatedConsent(tenantId);
      }),
      (url, init) => {
        if (isTokenRequest(url)) return tokenResponse();

        const decoded = decodeURIComponent(url);

        if (decoded.includes("/servicePrincipals?"))
          return json({ value: [{ id: servicePrincipalId }] });

        if (decoded.includes("/oauth2PermissionGrants?") && init?.method !== "DELETE")
          return json({
            value: [
              { id: "grant-1", clientId: servicePrincipalId },
              { id: "grant-2", clientId: servicePrincipalId },
            ],
          });

        deletes++;

        return deletes === 1
          ? new Response(null, { status: 204 })
          : json({ error: "server error" }, 500);
      },
      { retryDelayMs: 1 },
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphConsentRevocationFailed);
    expect(error).toMatchObject({ grantsRemoved: 1, status: 500 });
  });
  it("lists BitLocker keys with a device filter and fetches one with $select=key", async () => {
    const urls: string[] = [];

    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;
        const keys = yield* graph.listBitlockerRecoveryKeys(tenantId, "entra-device");
        const key = yield* graph.getBitlockerRecoveryKey(tenantId, "key-1");

        return { keys, key };
      }),
      (url) => {
        if (isTokenRequest(url)) return tokenResponse();
        urls.push(decodeURIComponent(url));

        if (url.includes("/recoveryKeys/key-1"))
          return json({
            id: "key-1",
            deviceId: "entra-device",
            createdDateTime: "2026-11-01T00:00:00Z",
            volumeType: 1,
            key: "111111-222222",
          });

        return json({
          value: [
            {
              id: "key-1",
              deviceId: "entra-device",
              createdDateTime: "2026-11-01T00:00:00Z",
              volumeType: 1,
            },
          ],
        });
      },
    );

    expect(urls[0]).toContain(
      "/informationProtection/bitlocker/recoveryKeys?$filter=deviceId eq 'entra-device'",
    );
    expect(urls[1]).toContain(
      "/informationProtection/bitlocker/recoveryKeys/key-1?$select=id,deviceId,createdDateTime,volumeType,key",
    );
    expect(result.keys).toHaveLength(1);
    expect(result.key.key).toBe("111111-222222");
  });
});

describe("AzureGraph URL policy", () => {
  const taintedCursor = "https://attacker.example/collect";

  it.each([
    "https://attacker.example/collect",
    "http://graph.microsoft.com/v1.0/users",
    "https://graph.microsoft.com:444/v1.0/users",
    "https://user:password@graph.microsoft.com/v1.0/users",
    "https://graph.microsoft.com/v1.0/users#fragment",
    "not a URL",
  ])("rejects %s before acquiring a token", async (url) => {
    let calls = 0;

    const error = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.get(tenantId, url, Schema.Unknown);
      }),
      () => {
        calls++;

        return tokenResponse();
      },
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphInvalidUrl);
    expect(calls).toBe(0);
  });

  const cursorMethods: ReadonlyArray<
    readonly [string, (graph: AzureGraphService) => Effect.Effect<unknown, unknown>]
  > = [
    ["users delta", (graph) => graph.usersDelta(tenantId, taintedCursor)],
    ["groups delta", (graph) => graph.groupsDelta(tenantId, taintedCursor)],
    ["Autopilot devices", (graph) => graph.listAutopilotDevices(tenantId, taintedCursor)],
    ["Autopilot profiles", (graph) => graph.listAutopilotProfiles(tenantId, taintedCursor)],
  ];

  it.each(cursorMethods)("rejects a tainted %s cursor before sending it", async (_name, call) => {
    let calls = 0;

    const error = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* call(graph);
      }),
      () => {
        calls++;

        return tokenResponse();
      },
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphInvalidUrl);
    expect(calls).toBe(0);
  });

  it("writes structured failure logs without cursor URLs or credentials", async () => {
    const messages: Array<unknown> = [];
    const logger = Logger.make((options) => {
      messages.push(options.message);
    });
    const cursor = "https://attacker.example/collect?secret=do-not-log";

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.usersDelta(tenantId, cursor);
      }).pipe(
        Effect.provide(
          AzureGraphLive(config).pipe(Layer.provide(mockLayer(() => tokenResponse()))),
        ),
        Effect.provide(Logger.layer([logger])),
      ),
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphInvalidUrl);
    expect(JSON.stringify(messages)).toContain("azure_graph.request_failed");
    expect(JSON.stringify(messages)).not.toContain("attacker.example");
    expect(JSON.stringify(messages)).not.toContain("do-not-log");
    expect(JSON.stringify(messages)).not.toContain(config.clientSecret);
  });

  it("rejects a tainted nextLink while collecting domains", async () => {
    const requested: string[] = [];

    const error = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.domains(tenantId);
      }),
      (url) => {
        if (isTokenRequest(url)) return tokenResponse();
        requested.push(url);

        return json({ value: [], "@odata.nextLink": taintedCursor });
      },
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphInvalidUrl);
    expect(requested).toHaveLength(1);
    expect(requested.some((url) => url.includes("attacker.example"))).toBe(false);
  });

  it("rejects a tainted service-principal nextLink before looking up grants", async () => {
    const methods: Array<string | undefined> = [];

    const error = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.revokeDelegatedConsent(tenantId);
      }),
      (url, init) => {
        if (isTokenRequest(url)) return tokenResponse();
        methods.push(init?.method);

        return json({ value: [], "@odata.nextLink": taintedCursor });
      },
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphInvalidUrl);
    expect(methods).toEqual(["GET"]);
  });

  it("rejects a tainted permission-grant nextLink before deleting anything", async () => {
    const methods: Array<string | undefined> = [];

    const error = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.revokeDelegatedConsent(tenantId);
      }),
      (url, init) => {
        if (isTokenRequest(url)) return tokenResponse();
        methods.push(init?.method);
        const decoded = decodeURIComponent(url);

        if (decoded.includes("/servicePrincipals?")) return json({ value: [{ id: "sp-1" }] });

        return json({ value: [], "@odata.nextLink": taintedCursor });
      },
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphInvalidUrl);
    expect(methods).toEqual(["GET", "GET"]);
  });

  it("disables fetch redirects so a Location header cannot receive the bearer token", async () => {
    const requests: Array<{ url: string; authorization?: string; redirect?: RequestRedirect }> = [];

    const error = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.domains(tenantId);
      }),
      (url, init) => {
        if (isTokenRequest(url)) return tokenResponse();
        requests.push({
          url,
          authorization: header(init, "authorization"),
          redirect: init?.redirect,
        });

        return new Response(null, {
          status: 302,
          headers: { location: taintedCursor },
        });
      },
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphInvalidUrl);
    expect(requests).toEqual([
      {
        url: expect.stringContaining("graph.microsoft.com"),
        authorization: "Bearer graph-token",
        redirect: "manual",
      },
    ]);
  });
});

describe("AzureGraph strict response schemas", () => {
  const malformedCollections: ReadonlyArray<
    readonly [string, (graph: AzureGraphService) => Effect.Effect<unknown, unknown>]
  > = [
    ["users delta", (graph) => graph.usersDelta(tenantId)],
    ["groups delta", (graph) => graph.groupsDelta(tenantId)],
    ["domains", (graph) => graph.domains(tenantId)],
    ["Autopilot devices", (graph) => graph.listAutopilotDevices(tenantId)],
    ["Autopilot profiles", (graph) => graph.listAutopilotProfiles(tenantId)],
  ];

  it.each(malformedCollections)("rejects a %s page without a value array", async (_name, call) => {
    const error = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* call(graph);
      }),
      (url) => (isTokenRequest(url) ? tokenResponse() : json({})),
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphInvalidResponse);
  });

  it.each(["devices", "profiles"])("rejects an Autopilot %s row without an id", async (kind) => {
    const error = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return kind === "devices"
          ? yield* graph.listAutopilotDevices(tenantId)
          : yield* graph.listAutopilotProfiles(tenantId);
      }),
      (url) =>
        isTokenRequest(url) ? tokenResponse() : json({ value: [{ displayName: "No id" }] }),
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphInvalidResponse);
  });

  const missingIdOperations: ReadonlyArray<
    readonly [string, (graph: AzureGraphService) => Effect.Effect<unknown, unknown>]
  > = [
    ["single device", (graph) => graph.getAutopilotDevice(tenantId, "expected")],
    [
      "single imported device",
      (graph) =>
        graph.importAutopilotDevices(tenantId, [
          { serialNumber: "ABC123", hardwareIdentifier: "aGFzaA==" },
        ]),
    ],
    [
      "created profile",
      (graph) =>
        graph.createAutopilotProfile(tenantId, {
          displayName: "Standard",
          deploymentMode: "userDriven",
          joinType: "azureADJoin",
        }),
    ],
  ];

  it.each(missingIdOperations)("rejects a %s response without an id", async (_name, call) => {
    const error = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* call(graph);
      }),
      (url) => (isTokenRequest(url) ? tokenResponse() : json({ displayName: "No id" })),
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphInvalidResponse);
  });

  it("rejects an empty Autopilot id instead of using it in later URLs", async () => {
    const error = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.getAutopilotDevice(tenantId, "expected");
      }),
      (url) => (isTokenRequest(url) ? tokenResponse() : json({ id: "", serialNumber: "ABC123" })),
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphInvalidResponse);
  });

  it("fails a later malformed page instead of returning a partial collection", async () => {
    let graphCalls = 0;

    const error = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.domains(tenantId);
      }),
      (url) => {
        if (isTokenRequest(url)) return tokenResponse();
        graphCalls++;

        return graphCalls === 1
          ? json({
              value: [contosoDomain],
              "@odata.nextLink": "https://graph.microsoft.com/v1.0/domains?$skiptoken=2",
            })
          : json({});
      },
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphInvalidResponse);
    expect(graphCalls).toBe(2);
  });
});

describe("AzureGraph pagination limits", () => {
  const nextLink = (page: number) =>
    "https://graph.microsoft.com/v1.0/domains?$skiptoken=" + String(page);

  it("fails rather than returning partial domains after the page cap", async () => {
    let graphCalls = 0;

    const error = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.domains(tenantId);
      }),
      (url) => {
        if (isTokenRequest(url)) return tokenResponse();
        graphCalls++;

        return json({
          value: [contosoDomain],
          "@odata.nextLink": nextLink(graphCalls + 1),
        });
      },
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphPaginationExhausted);
    expect(error).toMatchObject({
      resource: "domains",
      pages: GRAPH_PAGINATION_LIMIT,
      limit: GRAPH_PAGINATION_LIMIT,
    });
    expect(graphCalls).toBe(GRAPH_PAGINATION_LIMIT);
  });

  it("allows a collection that finishes on the final permitted page", async () => {
    let graphCalls = 0;

    const result = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.domains(tenantId);
      }),
      (url) => {
        if (isTokenRequest(url)) return tokenResponse();
        graphCalls++;

        return json({
          value: [contosoDomain],
          ...(graphCalls < GRAPH_PAGINATION_LIMIT
            ? { "@odata.nextLink": nextLink(graphCalls + 1) }
            : {}),
        });
      },
    );

    expect(result).toHaveLength(GRAPH_PAGINATION_LIMIT);
    expect(graphCalls).toBe(GRAPH_PAGINATION_LIMIT);
  });

  it("fails service-principal pagination exhaustion before grant lookup", async () => {
    let graphCalls = 0;
    const methods: Array<string | undefined> = [];

    const error = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.revokeDelegatedConsent(tenantId);
      }),
      (url, init) => {
        if (isTokenRequest(url)) return tokenResponse();
        graphCalls++;
        methods.push(init?.method);

        return json({
          value: [],
          "@odata.nextLink":
            "https://graph.microsoft.com/v1.0/servicePrincipals?$skiptoken=" +
            String(graphCalls + 1),
        });
      },
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphPaginationExhausted);
    expect(error).toMatchObject({ resource: "servicePrincipals", pages: GRAPH_PAGINATION_LIMIT });
    expect(methods).toEqual(Array(GRAPH_PAGINATION_LIMIT).fill("GET"));
  });

  it("never reports successful consent revocation when grant pagination exhausts", async () => {
    let grantPages = 0;
    const methods: Array<string | undefined> = [];

    const error = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.revokeDelegatedConsent(tenantId);
      }),
      (url, init) => {
        if (isTokenRequest(url)) return tokenResponse();
        methods.push(init?.method);
        const decoded = decodeURIComponent(url);

        if (decoded.includes("/servicePrincipals?")) return json({ value: [{ id: "sp-1" }] });

        grantPages++;

        return json({
          value: [],
          "@odata.nextLink":
            "https://graph.microsoft.com/v1.0/oauth2PermissionGrants?$skiptoken=" +
            String(grantPages + 1),
        });
      },
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphPaginationExhausted);
    expect(error).toMatchObject({
      resource: "oauth2PermissionGrants",
      pages: GRAPH_PAGINATION_LIMIT,
    });
    expect(grantPages).toBe(GRAPH_PAGINATION_LIMIT);
    expect(methods.some((method) => method === "DELETE")).toBe(false);
  });
});

describe("AzureGraph tenant-gone recovery", () => {
  it("does not hide a partial delete failure that contains a deleted-tenant code", async () => {
    let deletes = 0;

    const error = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.revokeDelegatedConsent(tenantId);
      }),
      (url) => {
        if (isTokenRequest(url)) return tokenResponse();
        const decoded = decodeURIComponent(url);

        if (decoded.includes("/servicePrincipals?")) return json({ value: [{ id: "sp-1" }] });
        if (decoded.includes("/oauth2PermissionGrants?")) {
          return json({
            value: [
              { id: "grant-1", clientId: "sp-1" },
              { id: "grant-2", clientId: "sp-1" },
            ],
          });
        }

        deletes++;

        return deletes === 1
          ? new Response(null, { status: 204 })
          : json({ error: "AADSTS700016: Application was not found" }, 400);
      },
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphConsentRevocationFailed);
    expect(error).toMatchObject({
      grantsRemoved: 1,
      phase: "delete",
      resourceId: "grant-2",
      status: 400,
    });
  });

  it("does not treat a Graph lookup failure as token-acquisition tenant-gone recovery", async () => {
    const error = await run(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        return yield* graph.revokeDelegatedConsent(tenantId);
      }),
      (url) =>
        isTokenRequest(url)
          ? tokenResponse()
          : json({ error: "AADSTS90002: Tenant not found" }, 400),
    ).catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(AzureGraphRequestFailed);
  });
});

describe("AzureGraph Effect clock", () => {
  it("expires cached tokens according to TestClock", async () => {
    let tokenCalls = 0;

    await runWithClock(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;

        yield* graph.domains(tenantId);
        yield* TestClock.adjust("58 minutes");
        yield* graph.domains(tenantId);
        yield* TestClock.adjust("61 seconds");
        yield* graph.domains(tenantId);
      }),
      (url) => {
        if (isTokenRequest(url)) {
          tokenCalls++;

          return tokenResponse("token-" + String(tokenCalls));
        }

        return domainsResponse([contosoDomain]);
      },
    );

    expect(tokenCalls).toBe(2);
  });

  it("schedules an HTTP-date Retry-After with TestClock", async () => {
    let graphCalls = 0;
    let tokenCalls = 0;

    const result = await runWithClock(
      Effect.gen(function* () {
        const graph = yield* AzureGraph;
        const request = yield* graph
          .domains(tenantId)
          .pipe(Effect.forkChild({ startImmediately: true }));

        for (let i = 0; i < 20 && graphCalls < 2; i++) {
          yield* TestClock.adjust("1 second");
          yield* Effect.yieldNow;
        }

        return yield* Fiber.join(request);
      }),
      (url) => {
        if (isTokenRequest(url)) {
          tokenCalls++;

          return tokenResponse();
        }

        graphCalls++;

        return graphCalls === 1
          ? new Response(null, {
              status: 429,
              headers: { "retry-after": new Date(10_000).toUTCString() },
            })
          : domainsResponse([contosoDomain]);
      },
    );

    expect(result).toEqual([contosoDomain]);
    expect(tokenCalls).toBe(1);
    expect(graphCalls).toBe(2);
  });
});
