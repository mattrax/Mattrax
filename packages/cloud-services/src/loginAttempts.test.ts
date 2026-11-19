import { describe, expect, it } from "vitest";
import { Effect, Layer, type Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { Db } from "@mattrax/enterprise-core";
import { signInFactorForPath } from "@mattrax/enterprise-backend";
import { loginAttemptObserver } from "./loginAttempts.js";
import { normalisePath } from "./rateLimit.js";

const chrome =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const delay = (millis: number) => new Promise((resolve) => setTimeout(resolve, millis));

/** The recorder runs detached, so give its fiber a moment to finish. */
const waitForRows = async (rows: Array<Schema.Json>, expected: number) => {
  for (let attempt = 0; attempt < 100 && rows.length < expected; attempt++) await delay(5);
};

/** Serve one request through a router that has the observer and a fake database. */
const request = async (
  rows: Array<Schema.Json>,
  body: Schema.Json,
  path: string,
): Promise<Response> => {
  const db = {
    insert: () => ({
      values: (row: Schema.Json) => Effect.sync(() => void rows.push(row)),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Effect.succeed<Array<Schema.Json>>([]),
        }),
      }),
    }),
  };

  const route = HttpRouter.add(
    "POST",
    "/api/v1/completePasskeySignIn",
    HttpServerResponse.json(body),
  );

  const other = HttpRouter.add("POST", "/api/v1/getSession", HttpServerResponse.json({}));

  const app = Layer.mergeAll(loginAttemptObserver, route, other).pipe(
    // SAFETY: the observer only calls the `insert`/`select` chains the fake
    // implements.
    Layer.provideMerge(Layer.succeed(Db, db as never)),
  );

  return Effect.runPromise(
    Effect.acquireUseRelease(
      // SAFETY: `toWebHandler` accepts the merged router layer; the fake `Db`
      // is the only service it cannot name here.
      Effect.sync(() => HttpRouter.toWebHandler(app as never, { disableLogger: true })),
      ({ handler }) =>
        Effect.promise(() =>
          handler(
            new Request(`http://localhost${path}`, {
              method: "POST",
              headers: { "user-agent": chrome, "cf-connecting-ip": "203.0.113.8" },
            }),
          ),
        ),
      ({ dispose }) => Effect.promise(dispose),
    ),
  );
};

describe("login attempt observer", () => {
  it("records a completed session without changing the response", async () => {
    const rows: Array<Schema.Json> = [];

    const body = {
      _tag: "Success",
      value: {
        _tag: "Authenticated",
        session: {
          subjectId: "account-1",
          claims: { email: "owner@example.com" },
          assurance: { method: "passkey" },
        },
      },
    };

    const response = await request(rows, body, "/api/v1/completePasskeySignIn");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);

    await waitForRows(rows, 1);

    expect(rows).toMatchObject([
      {
        accountId: "account-1",
        email: "owner@example.com",
        success: true,
        method: "passkey",
        factor: "passkey",
        ip: "203.0.113.0/24",
      },
    ]);
  });

  it("matches the route after case, duplicate-slash and trailing-slash normalisation", async () => {
    const rows: Array<Schema.Json> = [];

    const response = await request(
      rows,
      {
        _tag: "Success",
        value: {
          _tag: "Authenticated",
          session: {
            subjectId: "account-1",
            claims: { email: "owner@example.com" },
            assurance: { method: "passkey" },
          },
        },
      },
      "/API/V1//completePasskeySignIn/",
    );

    expect(response.status).toBe(200);

    await waitForRows(rows, 1);

    expect(rows).toHaveLength(1);
    expect(signInFactorForPath(normalisePath("/API/V1//completePasskeySignIn/"))).toBe("passkey");
  });

  it("does not store an unattributable rejection", async () => {
    const rows: Array<Schema.Json> = [];

    await request(
      rows,
      { _tag: "Failure", error: { _tag: "PasskeyRejected" } },
      "/api/v1/completePasskeySignIn",
    );

    await delay(25);

    expect(rows).toEqual([]);
  });

  it("ignores routes that are not sign-in completions", async () => {
    const rows: Array<Schema.Json> = [];

    await request(rows, { _tag: "Success" }, "/api/v1/getSession");

    await delay(25);

    expect(rows).toEqual([]);
  });
});
