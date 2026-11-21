import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { AzureOidc } from "@mattrax/azure-oidc";
import { Db, schema } from "@mattrax/enterprise-core";
import { signToken, verifyToken } from "@mattrax/enterprise-tokens";
import { ssoRoutes } from "./sso.js";
import type { SsoRoutesOptions } from "./sso.js";

const origin = "https://app.test";

const secret = "sso-test-secret";

const tenantId = "tenant-1";

const options = {
  origin,
  clientId: "client-id",
  clientSecret: "client-secret",
  authSecret: secret,
};

type RowValue = string | number | boolean | Date | null | undefined | RowValue[] | Row;

type Row = { [column: string]: RowValue };

type Table =
  | "account"
  | "member"
  | "ssoConfig"
  | "ssoDomain"
  | "ssoIdentity"
  | "organization"
  | "loginAttempt"
  | "authCredentials";

type Store = Record<Table, Row[]>;

const tableName = (table: any): string => {
  const symbol = Object.getOwnPropertySymbols(table).find(
    (candidate) => candidate.description === "drizzle:Name",
  );

  return symbol ? table[symbol] : "";
};

const tableNames: Table[] = [
  "account",
  "member",
  "ssoConfig",
  "ssoDomain",
  "ssoIdentity",
  "organization",
  "loginAttempt",
  "authCredentials",
];

const tableKeys = new Map(tableNames.map((key) => [tableName(schema[key]), key]));

/** The fake stores rows under the schema's camelCase key, not the SQL name. */
const storeKey = (table: any): Table => tableKeys.get(tableName(table)) ?? "account";

const equality = Schema.Struct({ eq: Schema.Unknown });

const matches = (row: Row, where: any): boolean =>
  where == null ||
  Object.entries(where).every(([key, expected]) => {
    if (Schema.is(equality)(expected)) return row[key] === expected.eq;

    return row[key] === expected;
  });

const makeDb = (initial: Partial<Store> = {}) => {
  const store: Store = {
    account: [...(initial.account ?? [])],
    member: [...(initial.member ?? [])],
    ssoConfig: [...(initial.ssoConfig ?? [])],
    ssoDomain: [...(initial.ssoDomain ?? [])],
    ssoIdentity: [...(initial.ssoIdentity ?? [])],
    organization: [...(initial.organization ?? [])],
    loginAttempt: [...(initial.loginAttempt ?? [])],
    authCredentials: [...(initial.authCredentials ?? [])],
  };

  const query = Object.fromEntries(
    Object.entries(store).map(([name, rows]) => [
      name,
      {
        findFirst: ({ where }: { where?: unknown } = {}) =>
          Effect.sync(() => rows.find((row) => matches(row, where))),
        findMany: ({ where }: { where?: unknown } = {}) =>
          Effect.sync(() => rows.filter((row) => matches(row, where))),
      },
    ]),
  );

  const db: any = {
    store,
    query,
    insert: (table: any) => {
      const builder: any = {
        values: (rows: Row | Row[]) =>
          Effect.sync(() => {
            const list = Array.isArray(rows) ? rows : [rows];
            store[storeKey(table)].push(...list);
          }),
        ignore: () => builder,
        onConflictDoNothing: () => builder,
      };

      return builder;
    },
    update: () => ({
      set: () => ({
        where: () => Effect.void,
      }),
    }),
    delete: () => ({
      where: () => Effect.void,
    }),
    select: () => ({
      from: (table: any) => ({
        // `ensureCredential` is the only select the callback makes. The tests
        // seed or inspect the credential table directly.
        where: () => ({
          limit: () => Effect.succeed(store[storeKey(table)]),
        }),
      }),
    }),
  };

  return db;
};

const account = (overrides: Row = {}) => ({
  id: "account-1",
  name: "Owner",
  email: "owner@example.com",
  emailVerified: true,
  disabled: false,
  authRevision: "revision-1",
  image: null,
  stripeCustomerId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const config = (overrides: Row = {}) => ({
  organizationId: tenantId,
  enabled: true,
  azureTenantId: "entra-tenant",
  autoProvision: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const identity = (overrides: Row = {}) => ({
  organizationId: tenantId,
  objectId: "entra-object",
  accountId: "account-1",
  createdAt: new Date(),
  ...overrides,
});

type OidcOverrides = {
  readonly discovery?: () => Effect.Effect<unknown, unknown>;
  readonly validateJwt?: () => Effect.Effect<unknown, unknown>;
};

// SAFETY: the double implements only the two AzureOidc reads the callback
// makes; the service's remaining members are never called on these paths.
const oidc = (overrides: OidcOverrides = {}) =>
  ({
    discovery: () =>
      Effect.succeed({
        issuer: "https://login.microsoftonline.com/entra-tenant/v2.0",
        jwks_uri: "https://login.microsoftonline.com/entra-tenant/discovery/v2.0/keys",
        token_endpoint: "https://login.microsoftonline.com/entra-tenant/oauth2/v2.0/token",
      }),
    validateJwt: () =>
      Effect.succeed({
        iss: "https://login.microsoftonline.com/entra-tenant/v2.0",
        aud: "client-id",
        sub: "subject",
        oid: "entra-object",
        email: "owner@example.com",
        nonce: "nonce-1",
        name: "Owner",
        exp: Math.floor(Date.now() / 1000) + 600,
        iat: Math.floor(Date.now() / 1000),
      }),
    jwks: () => Effect.die("not used"),
    ...overrides,
  }) as never;

const stateToken = (overrides: Row = {}) =>
  Effect.runPromise(
    // SAFETY: the payload is exactly the fields the SSO state token carries;
    // test overrides only replace values the callback reads.
    signToken(secret, {
      sub: tenantId,
      email: "sso-state",
      exp: Date.now() + 10 * 60 * 1000,
      purpose: "sso-state",
      nonce: "nonce-1",
      ...overrides,
    }),
  );

const cookie = (state: string) => `__Host-sso_state=${state}`;

const callbackRequest = (search: string, stateCookie?: string) =>
  new Request(`${origin}/api/v1/sso/azure/callback?${search}`, {
    headers: stateCookie ? { cookie: stateCookie } : {},
  });

const serve = async (input: {
  db: any;
  request: Request;
  oidc?: any;
  routeOptions?: SsoRoutesOptions;
}) => {
  const app = ssoRoutes(input.routeOptions ?? options).pipe(
    Layer.provide(HttpServer.layerServices),
    // SAFETY: the fake provides only the Db chains the callback uses; the
    // layer type names the production service surface.
    Layer.provideMerge(Layer.succeed(Db, input.db as never)),
    Layer.provideMerge(Layer.succeed(AzureOidc, input.oidc ?? oidc())),
  );

  // SAFETY: the fake provides only the Db chains the callback uses; the
  // handler type needs the full service surface.
  const { handler, dispose } = HttpRouter.toWebHandler(app as never, {
    disableLogger: true,
  });

  try {
    return await handler(input.request);
  } finally {
    await dispose();
  }
};

const failureCode = (response: Response) => {
  expect(response.status).toBe(302);
  const location = response.headers.get("location");

  expect(location).toBeTruthy();

  const url = new URL(location!);

  expect(url.origin).toBe(origin);
  expect(url.pathname).toBe("/sso/complete");

  return { url, location: location!, code: url.searchParams.get("error") };
};

const expectFailure = (
  response: Response,
  code: string,
  forbidden: ReadonlyArray<string> = [],
  options: { clearsCookie?: boolean } = {},
) => {
  const { url, location, code: actual } = failureCode(response);

  expect(actual).toBe(code);
  expect(url.searchParams.has("token")).toBe(false);

  for (const value of forbidden) expect(location).not.toContain(value);
  // Only the stable code and the safe internal return path may travel in the
  // URL. Anything else would risk echoing an IdP message or account data.
  expect([...url.searchParams.keys()].every((key) => key === "error" || key === "returnTo")).toBe(
    true,
  );

  if (options.clearsCookie === false) {
    // A callback that did not present this browser's state must leave the
    // cookie for the tab that did.
    expect(response.headers.get("set-cookie")).toBeNull();

    return;
  }

  // The browser must not keep a state token that a replay could reuse.
  expect(response.headers.get("set-cookie")).toContain("__Host-sso_state=;");
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
};

const signedState = async (overrides: Row = {}) => {
  const state = await stateToken(overrides);

  return { state, cookie: cookie(state) };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Entra SSO callback failures", () => {
  it("redirects a misconfigured deployment to the completion page", async () => {
    const response = await serve({
      db: makeDb(),
      request: callbackRequest("code=code&state=state"),
      routeOptions: { origin, authSecret: secret },
    });

    expectFailure(response, "sso_unavailable", [secret]);
  });

  it("redirects a missing code or state", async () => {
    const response = await serve({
      db: makeDb(),
      request: callbackRequest(""),
    });

    expectFailure(response, "invalid_request", [], { clearsCookie: false });
  });

  it("maps an IdP error to a stable code without the provider description", async () => {
    const response = await serve({
      db: makeDb(),
      request: callbackRequest(
        "error=access_denied&error_description=user+denied+tenant+secret-detail",
      ),
    });

    expectFailure(response, "idp_rejected", ["denied", "secret-detail", "access_denied"], {
      clearsCookie: false,
    });
  });

  it("redirects a state that belongs to another browser", async () => {
    const { state } = await signedState();

    const response = await serve({
      db: makeDb({ ssoConfig: [config()] }),
      request: callbackRequest(`code=code&state=${state}`, cookie("other-state")),
    });

    expectFailure(response, "state_mismatch", [state], { clearsCookie: false });
  });

  it("redirects a forged state without trusting its payload", async () => {
    const forged = "not-a-signed-state";

    const response = await serve({
      db: makeDb({ ssoConfig: [config()] }),
      request: callbackRequest(`code=code&state=${forged}`, cookie(forged)),
    });

    expectFailure(response, "state_mismatch", [forged]);
  });

  it("redirects an expired state", async () => {
    const { state, cookie: stateCookie } = await signedState({ exp: Date.now() - 1 });

    const response = await serve({
      db: makeDb({ ssoConfig: [config()] }),
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
    });

    expectFailure(response, "state_expired", [state]);
  });

  it("keeps the state's tenant instead of resolving another tenant's SSO", async () => {
    const { state, cookie: stateCookie } = await signedState();

    const response = await serve({
      // Only another tenant has SSO enabled and a matching identity.
      db: makeDb({
        ssoConfig: [config({ organizationId: "tenant-2" })],
        ssoIdentity: [identity({ organizationId: "tenant-2" })],
      }),
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
    });

    expectFailure(response, "sso_disabled");
  });

  it("redirects when the identity provider cannot be reached", async () => {
    const { state, cookie: stateCookie } = await signedState();

    const response = await serve({
      db: makeDb({ ssoConfig: [config()] }),
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
      oidc: oidc({ discovery: () => Effect.fail(new Error("graph offline")) }),
    });

    expectFailure(response, "idp_unavailable", ["graph offline"]);
  });

  it("redirects when discovery has no token endpoint", async () => {
    const { state, cookie: stateCookie } = await signedState();

    const response = await serve({
      db: makeDb({ ssoConfig: [config()] }),
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
      oidc: oidc({
        discovery: () =>
          Effect.succeed({
            issuer: "issuer",
            jwks_uri: "jwks",
          }),
      }),
    });

    expectFailure(response, "idp_unavailable");
  });

  it("redirects a rejected token exchange", async () => {
    const { state, cookie: stateCookie } = await signedState();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "invalid_grant", error_description: "token exchange secret-detail" },
          { status: 400 },
        ),
      ),
    );

    const response = await serve({
      db: makeDb({ ssoConfig: [config()] }),
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
    });

    expectFailure(response, "idp_rejected", ["invalid_grant", "secret-detail", "token exchange"]);
  });

  it("redirects a token response without an ID token", async () => {
    const { state, cookie: stateCookie } = await signedState();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ access_token: "secret-token" })),
    );

    const response = await serve({
      db: makeDb({ ssoConfig: [config()] }),
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
    });

    expectFailure(response, "idp_rejected", ["secret-token", "access_token"]);
  });

  it("redirects an ID token that fails validation", async () => {
    const { state, cookie: stateCookie } = await signedState();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id_token: "id-token-value" })),
    );

    const response = await serve({
      db: makeDb({ ssoConfig: [config()] }),
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
      oidc: oidc({ validateJwt: () => Effect.fail(new Error("signature failure")) }),
    });

    expectFailure(response, "idp_rejected", ["signature failure", "id-token-value"]);
  });

  it("redirects a nonce mismatch", async () => {
    const { state, cookie: stateCookie } = await signedState();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id_token: "id-token-value" })),
    );

    const response = await serve({
      db: makeDb({ ssoConfig: [config()] }),
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
      oidc: oidc({
        validateJwt: () =>
          Effect.succeed({
            iss: "issuer",
            aud: "client-id",
            sub: "subject",
            oid: "entra-object",
            email: "owner@example.com",
            nonce: "other-nonce",
            name: "Owner",
            exp: Math.floor(Date.now() / 1000) + 600,
            iat: Math.floor(Date.now() / 1000),
          }),
      }),
    });

    expectFailure(response, "idp_rejected", ["other-nonce"]);
  });

  it("redirects when the identity provider returns no email", async () => {
    const { state, cookie: stateCookie } = await signedState();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id_token: "id-token-value" })),
    );

    const response = await serve({
      db: makeDb({ ssoConfig: [config()] }),
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
      oidc: oidc({
        validateJwt: () =>
          Effect.succeed({
            iss: "issuer",
            aud: "client-id",
            sub: "subject",
            oid: "entra-object",
            nonce: "nonce-1",
            name: "Owner",
            exp: Math.floor(Date.now() / 1000) + 600,
            iat: Math.floor(Date.now() / 1000),
          }),
      }),
    });

    expectFailure(response, "unknown_account");
  });

  it("redirects a disabled account and records the attempt", async () => {
    const { state, cookie: stateCookie } = await signedState();

    const db = makeDb({
      account: [account({ disabled: true })],
      ssoConfig: [config()],
      ssoIdentity: [identity()],
      member: [{ id: "member-1", organizationId: tenantId, accountId: "account-1" }],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id_token: "id-token-value" })),
    );

    const response = await serve({
      db,
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
    });

    expectFailure(response, "account_disabled", ["owner@example.com", "account-1"]);
    expect(db.store.loginAttempt).toMatchObject([
      {
        accountId: "account-1",
        success: false,
        method: "sso",
        failureReason: "disabled",
      },
    ]);
  });

  it("redirects a linked identity that is not a member", async () => {
    const { state, cookie: stateCookie } = await signedState();

    const db = makeDb({
      account: [account()],
      ssoConfig: [config()],
      ssoIdentity: [identity()],
      member: [{ id: "member-2", organizationId: "tenant-2", accountId: "account-1" }],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id_token: "id-token-value" })),
    );

    const response = await serve({
      db,
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
    });

    expectFailure(response, "not_a_member", ["owner@example.com", "account-1"]);
    expect(db.store.loginAttempt).toMatchObject([
      { accountId: "account-1", failureReason: "not_member" },
    ]);
  });

  it("redirects a multi-tenant account to the explicit-link path", async () => {
    const { state, cookie: stateCookie } = await signedState();

    const db = makeDb({
      account: [account()],
      ssoConfig: [config()],
      member: [
        { id: "member-1", organizationId: tenantId, accountId: "account-1" },
        { id: "member-2", organizationId: "tenant-2", accountId: "account-1" },
      ],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id_token: "id-token-value" })),
    );

    const response = await serve({
      db,
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
    });

    expectFailure(response, "sso_link_required", ["owner@example.com", "account-1", "multiple"]);
    expect(db.store.loginAttempt).toMatchObject([
      { accountId: "account-1", failureReason: "sso_rejected" },
    ]);
  });

  it("redirects an unverified email domain", async () => {
    const { state, cookie: stateCookie } = await signedState();

    const db = makeDb({
      account: [account()],
      ssoConfig: [config()],
      member: [{ id: "member-1", organizationId: tenantId, accountId: "account-1" }],
      ssoDomain: [
        {
          domain: "example.com",
          organizationId: tenantId,
          isVerified: false,
          source: "entra",
        },
      ],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id_token: "id-token-value" })),
    );

    const response = await serve({
      db,
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
    });

    expectFailure(response, "domain_not_verified", ["example.com", "owner@example.com"]);
  });

  it("redirects when auto-provisioning is disabled and no account exists", async () => {
    const { state, cookie: stateCookie } = await signedState();
    const db = makeDb({ ssoConfig: [config({ autoProvision: false })] });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id_token: "id-token-value" })),
    );

    const response = await serve({
      db,
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
    });

    expectFailure(response, "provisioning_disabled", ["owner@example.com"]);
    expect(db.store.account).toEqual([]);
  });

  it("redirects an unhandled failure without leaking its cause", async () => {
    const { state, cookie: stateCookie } = await signedState();
    const db = makeDb({ ssoConfig: [config()] });

    // A defect after the state is verified still lands on the styled page.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket secret-detail");
      }),
    );

    const response = await serve({
      db,
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
    });

    expectFailure(response, "idp_unavailable", ["socket secret-detail"]);
  });

  it("redirects a real defect after state verification to sign_in_failed", async () => {
    const { state, cookie: stateCookie } = await signedState();

    const db = makeDb({ ssoConfig: [config()] });

    // The state verified, so this is not a rejected sign-in: something in the
    // deployment died. The styled page gets the catch-all code, the cause stays
    // in the server log, and the browser still drops its state token.
    db.query.ssoConfig.findFirst = () => Effect.die(new Error("database offline secret-detail"));

    const response = await serve({
      db,
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
    });

    expectFailure(response, "sign_in_failed", ["database offline", "secret-detail"]);
  });
});

describe("Entra SSO callback success and replay", () => {
  const successfulRequest = async (db: any, returnTo?: string) => {
    const { state, cookie: stateCookie } = await signedState(returnTo ? { returnTo } : undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id_token: "id-token-value" })),
    );

    const response = await serve({
      db,
      request: callbackRequest(`code=code&state=${state}`, stateCookie),
    });

    return { response, state };
  };

  it("redirects a linked member to the completion page and clears the state cookie", async () => {
    const db = makeDb({
      account: [account()],
      ssoConfig: [config()],
      ssoIdentity: [identity()],
      member: [{ id: "member-1", organizationId: tenantId, accountId: "account-1" }],
      authCredentials: [
        {
          credentialId: "credential-1",
          subjectId: "account-1",
          revision: "revision-1",
          active: true,
        },
      ],
    });

    const { response } = await successfulRequest(db, "/devices");

    expect(response.status).toBe(302);
    const location = response.headers.get("location")!;
    const url = new URL(location);

    expect(url.pathname).toBe("/sso/complete");
    expect(url.searchParams.get("returnTo")).toBe("/devices");
    expect(url.searchParams.get("error")).toBeNull();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");

    // The assertion is short-lived and carries the tenant; the callback must
    // not put the account id or IdP details in the redirect.
    const payload = await Effect.runPromise(verifyToken(secret, url.searchParams.get("token")!));

    expect(payload.sub).toBe("account-1");
    expect(payload.tenantId).toBe(tenantId);
    expect(payload.purpose).toBe("sso-assertion");
    expect(location).not.toContain("entra-object");
    expect(location).not.toContain("id-token-value");
  });

  it("drops a return path that is not a plain internal path", async () => {
    const db = makeDb({
      account: [account()],
      ssoConfig: [config()],
      ssoIdentity: [identity()],
      member: [{ id: "member-1", organizationId: tenantId, accountId: "account-1" }],
      authCredentials: [
        {
          credentialId: "credential-1",
          subjectId: "account-1",
          revision: "revision-1",
          active: true,
        },
      ],
    });

    for (const unsafe of [String.raw`/\evil.example`, "//evil.example"]) {
      const { response } = await successfulRequest(db, unsafe);
      const url = new URL(response.headers.get("location")!);

      expect(url.searchParams.get("returnTo"), unsafe).toBeNull();
    }
  });

  it("rejects a replayed callback after the browser drops the state cookie", async () => {
    const db = makeDb({
      account: [account()],
      ssoConfig: [config()],
      ssoIdentity: [identity()],
      member: [{ id: "member-1", organizationId: tenantId, accountId: "account-1" }],
      authCredentials: [
        {
          credentialId: "credential-1",
          subjectId: "account-1",
          revision: "revision-1",
          active: true,
        },
      ],
    });

    const { state } = await successfulRequest(db);

    // The first response expires __Host-sso_state, so a replay arrives without
    // it. The signed state alone must not be enough.
    const replay = await serve({
      db,
      request: callbackRequest(`code=code&state=${state}`),
    });

    expectFailure(replay, "state_mismatch", [state], { clearsCookie: false });
  });

  it("keeps another tab's state cookie when this tab presents a different state", async () => {
    const db = makeDb({
      account: [account()],
      ssoConfig: [config()],
      ssoIdentity: [identity()],
      member: [{ id: "member-1", organizationId: tenantId, accountId: "account-1" }],
    });

    // Tab A is mid sign-in and owns the cookie. Tab B's callback presents its
    // own signed state, which does not match the cookie. Rejecting B must not
    // expire A's state.
    const { state: tabA } = await signedState();
    const { state: tabB } = await signedState({ nonce: "nonce-2" });

    const response = await serve({
      db,
      request: callbackRequest(`code=code&state=${tabB}`, cookie(tabA)),
    });

    expectFailure(response, "state_mismatch", [tabA, tabB], { clearsCookie: false });

    // Tab A can still complete with the cookie it started with.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id_token: "id-token-value" })),
    );

    const completed = await serve({
      db,
      request: callbackRequest(`code=code&state=${tabA}`, cookie(tabA)),
    });

    expect(completed.status).toBe(302);
    expect(new URL(completed.headers.get("location")!).searchParams.get("error")).toBeNull();
    expect(completed.headers.get("set-cookie")).toContain("__Host-sso_state=;");
  });
});
