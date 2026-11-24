import { Effect, Option } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import { HttpServerResponse } from "effect/http";
import { exchangeSsoCode } from "./ssoIdentity.js";
import {
  BYOD_STATE_COOKIE,
  APPLE_BYOD_STATE_PURPOSE,
  appleByodAuthorize,
  handleAppleByodSsoCallback,
  appleRemotemanagementRedirect,
} from "./appleByod.js";

const claims = (
  overrides: Record<string, string | number | boolean | null | undefined> = {},
) => ({
  email: "student@school.example",
  oid: "entra-object",
  nonce: "nonce-1",
  name: "Student",
  ...overrides,
});

const oidc = (options: {
  readonly discovery?: boolean;
  readonly claims?: Record<string, string | number | boolean | null | undefined> | null;
}) => ({
  discovery: () =>
    options.discovery === false
      ? Effect.fail(new Error("discovery down"))
      : Effect.succeed({ token_endpoint: "https://idp.test/token" }),
  validateJwt: () =>
    options.claims === null
      ? Effect.fail(new Error("invalid token"))
      : Effect.succeed(options.claims ?? claims()),
});

const exchange = (options: {
  readonly oidc: ReturnType<typeof oidc>;
  readonly nonce?: string;
}) =>
  Effect.runPromise(
    exchangeSsoCode({
      code: "code-1",
      azureTenantId: "entra-tenant",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://app.test/api/v1/sso/azure/callback",
      nonce: options.nonce ?? "nonce-1",
      oidc: options.oidc as never,
    }),
  );

describe("BYOD SSO code exchange", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the IdP identity on a valid exchange", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id_token: "id-token" }), { status: 200 })),
    );

    await expect(exchange({ oidc: oidc({}) })).resolves.toMatchObject({
      ok: true,
      email: "student@school.example",
      objectId: "entra-object",
    });
  });

  it("validates the ID token against the tenant and client audience", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id_token: "id-token" }), { status: 200 })),
    );
    let seen: unknown;
    const capturing = {
      discovery: () => Effect.succeed({ token_endpoint: "https://idp.test/token" }),
      validateJwt: (_token: string, options: unknown) => {
        seen = options;

        return Effect.succeed(claims());
      },
    };

    await expect(exchange({ oidc: capturing as never })).resolves.toMatchObject({ ok: true });
    expect(seen).toEqual({ tenantIds: ["entra-tenant"], audience: "client-id" });
  });

  it("reports an unreachable IdP without throwing", async () => {
    await expect(exchange({ oidc: oidc({ discovery: false }) })).resolves.toMatchObject({
      ok: false,
      failure: { code: "idp_unavailable" },
    });
  });

  it("rejects a token endpoint failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 400 })));

    await expect(exchange({ oidc: oidc({}) })).resolves.toMatchObject({
      ok: false,
      failure: { code: "idp_rejected" },
    });
  });

  it("rejects a nonce mismatch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id_token: "id-token" }), { status: 200 })),
    );

    await expect(exchange({ oidc: oidc({}), nonce: "different-nonce" })).resolves.toMatchObject({
      ok: false,
      failure: { code: "idp_rejected" },
    });
  });

  it("rejects a validated token without an email", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id_token: "id-token" }), { status: 200 })),
    );

    await expect(
      exchange({ oidc: oidc({ claims: claims({ email: undefined, preferred_username: undefined, upn: undefined }) }) }),
    ).resolves.toMatchObject({
      ok: false,
      failure: { code: "unknown_account" },
    });
  });
});

describe("Apple callback redirect", () => {
  it("encodes the access token into the Apple callback scheme", () => {
    expect(appleRemotemanagementRedirect("a b+c/d?e&f")).toBe(
      "apple-remotemanagement-user-login://authentication-results?access-token=a%20b%2Bc%2Fd%3Fe%26f",
    );
  });
});

type FakeValue = string | number | boolean | Date | null | undefined;
type FakeRow = Record<string, FakeValue>;

const rows = (initial: Record<string, FakeRow[]>) => {
  const store = { ...initial };

  return {
    store,
    db: {
      query: Object.fromEntries(
        Object.keys(store).map((table) => [
          table,
          {
            findFirst: ({ where }: { where?: FakeRow } = {}) =>
              Effect.succeed(
                store[table]?.find((row) =>
                  Object.entries(where ?? {}).every(([key, value]) => row[key] === value),
                ),
              ),
          },
        ]),
      ),
    },
  };
};

const runAuthorize = (
  db: ReturnType<typeof rows>["db"],
  url: string,
  host: string,
) =>
  Effect.runPromise(
    appleByodAuthorize(
      // SAFETY: the authorize path only reads the URL and headers.
      { url, headers: { host } } as never,
      {
        origin: "https://app.test",
        clientId: "client-id",
        clientSecret: "client-secret",
        authSecret: "byod-secret",
      },
    ).pipe(Effect.provideService(Db, db as never)),
  );

const authorizeRows = () => {
  const config = rows({
    appleByodEnrollment: [
      {
        id: "challenge-1",
        organizationId: "org-1",
        challengeExpiresAt: new Date(Date.now() + 60_000),
        authorizedAt: null,
        tokenHash: null,
      },
    ],
    appleByodConfig: [
      {
        organizationId: "org-1",
        enabled: true,
        domain: "school.example",
        hardwareValidationRequired: false,
        hardwareValidatedAt: null,
      },
    ],
    ssoDomain: [{ domain: "school.example", organizationId: "org-1", isVerified: true }],
    ssoConfig: [{ organizationId: "org-1", enabled: true, azureTenantId: "entra-tenant" }],
  });

  return config;
};

describe("BYOD authorize host routing", () => {
  it("bounces a tenant-host authorize request to ORIGIN without setting a cookie", async () => {
    const response = await runAuthorize(
      rows({}).db,
      "https://school.example/mdm/apple/byod/authorize?challenge=challenge-1&user-identifier=student%40school.example",
      "school.example",
    );
    const web = HttpServerResponse.toWeb(response);
    const location = new URL(web.headers.get("location") ?? "");

    expect(web.status).toBe(302);
    expect(location.origin).toBe("https://app.test");
    expect(location.pathname).toBe("/mdm/apple/byod/authorize");
    expect(location.searchParams.get("challenge")).toBe("challenge-1");
    expect(location.searchParams.get("user-identifier")).toBe("student@school.example");
    expect(web.headers.get("set-cookie")).toBeNull();
  });

  it("sets only the dedicated BYOD state cookie on ORIGIN", async () => {
    const { db } = authorizeRows();
    const response = await runAuthorize(
      db,
      "https://app.test/mdm/apple/byod/authorize?challenge=challenge-1&user-identifier=student%40school.example",
      "app.test",
    );
    const web = HttpServerResponse.toWeb(response);
    const cookie = web.headers.get("set-cookie") ?? "";

    expect(web.status).toBe(302);
    expect(web.headers.get("location")).toContain("login.microsoftonline.com");
    expect(cookie).toContain(BYOD_STATE_COOKIE + "=");
    expect(cookie).not.toContain("__Host-sso_state=");
  });

  it("refuses to authorise a challenge that was already redeemed", async () => {
    const { db, store } = authorizeRows();

    store.appleByodEnrollment![0]!.authorizedAt = new Date();

    const response = HttpServerResponse.toWeb(
      await Effect.runPromise(
        appleByodAuthorize(
          {
            url: "https://app.test/mdm/apple/byod/authorize?challenge=challenge-1&user-identifier=student%40school.example",
            headers: { host: "app.test" },
          } as never,
          {
            origin: "https://app.test",
            clientId: "client-id",
            clientSecret: "client-secret",
            authSecret: "byod-secret",
          },
        ).pipe(Effect.provideService(Db, db as never)),
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("already been used");
  });
});

const callbackDb = (rows: Record<string, FakeRow[]>) => {
  const defaults: Array<[string, FakeRow[]]> = [
    ["appleByodEnrollment", []],
    ["appleByodConfig", []],
    ["ssoConfig", []],
    ["user", []],
    ["account", []],
    ["member", []],
    ["ssoIdentity", []],
    ["ssoDomain", []],
    ["authCredentials", []],
    ["loginAttempt", []],
  ];
  const store = Object.fromEntries([...defaults, ...Object.entries(rows)]);
  const matches = (row: FakeRow, where: FakeRow = {}) =>
    Object.entries(where).every(([key, value]) => row[key] === value);

  return {
    store,
    db: {
      query: Object.fromEntries(
        Object.keys(store).map((table) => [
          table,
          {
            findFirst: ({ where }: { where?: FakeRow } = {}) =>
              Effect.succeed(store[table]?.find((row) => matches(row, where))),
            findMany: ({ where }: { where?: FakeRow } = {}) =>
              Effect.succeed(store[table]?.filter((row) => matches(row, where)) ?? []),
          },
        ]),
      ),
      insert: (table: { [key: symbol]: string }) => ({
        values: (value: FakeRow) => {
          store[String(table[Symbol.for("drizzle:Name")])]?.push(value);

          return Effect.void;
        },
        ignore: () => ({
          values: (value: FakeRow) => {
            store[String(table[Symbol.for("drizzle:Name")])]?.push(value);

            return Effect.void;
          },
        }),
      }),
      update: () => ({
        set: (value: FakeRow) => ({
          where: () => {
            const row = store.appleByodEnrollment?.[0];

            if (row) Object.assign(row, value);

            return Effect.succeed({ affectedRows: row ? 1 : 0 });
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Effect.succeed(store.authCredentials ?? []) }),
        }),
      }),
    },
  };
};

const callbackInput = (rows: Record<string, FakeRow[]>) => {
  const { db } = callbackDb(rows);
  const payload = {
    sub: "org-1",
    email: "student@school.example",
    exp: Date.now() + 60_000,
    purpose: APPLE_BYOD_STATE_PURPOSE,
    tenantId: "org-1",
    nonce: "nonce-1",
    challengeId: "challenge-1",
  };

  return {
    db,
    input: {
      request: { headers: {}, remoteAddress: Option.none() } as never,
      code: "code-1",
      payload: payload as never,
      db: db as never,
      oidc: {
        discovery: () => Effect.succeed({ token_endpoint: "https://idp.test/token" }),
        validateJwt: () =>
          Effect.succeed({
            email: "student@school.example",
            oid: "entra-object",
            nonce: "nonce-1",
          }),
      },
      options: {
        origin: "https://app.test",
        clientId: "client-id",
        clientSecret: "client-secret",
        authSecret: "byod-secret",
      },
    },
  };
};

const byodCallbackRows = () => ({
  appleByodEnrollment: [
    {
      id: "challenge-1",
      organizationId: "org-1",
      challengeExpiresAt: new Date(Date.now() + 60_000),
      authorizedAt: null,
      tokenHash: null,
    },
  ],
  appleByodConfig: [
    {
      organizationId: "org-1",
      enabled: true,
      domain: "school.example",
      hardwareValidationRequired: false,
      hardwareValidatedAt: null,
    },
  ],
  ssoConfig: [{ organizationId: "org-1", enabled: true, azureTenantId: "entra-tenant" }],
});

describe("BYOD callback security", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuses a directory person that directory sync has not imported", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id_token: "id-token" }), { status: 200 })),
    );
    const { input } = callbackInput(byodCallbackRows());
    const response = HttpServerResponse.toWeb(
      await Effect.runPromise(handleAppleByodSsoCallback(input as never)),
    );
    const body = await response.text();

    expect(response.status).toBe(403);
    expect(body).toContain("directory person");
  });

  it("refuses an IdP address that is not the Managed Apple Account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id_token: "id-token" }), { status: 200 })),
    );
    const { db, input } = callbackInput(byodCallbackRows());
    input.oidc.validateJwt = () =>
      Effect.succeed({
        email: "other@school.example",
        oid: "entra-object",
        nonce: "nonce-1",
      });
    const response = HttpServerResponse.toWeb(
      await Effect.runPromise(handleAppleByodSsoCallback({ ...input, db: db as never } as never)),
    );
    const body = await response.text();

    expect(response.status).toBe(403);
    expect(body).toContain("Managed Apple Account");
  });
});
