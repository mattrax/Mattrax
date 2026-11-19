import { describe, expect, it } from "vitest";
import { Effect, Layer, type Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { Db } from "@mattrax/enterprise-core";
import { loginAttemptObserver } from "./loginAttempts.js";

const chrome =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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
  };

  const route = HttpRouter.add(
    "POST",
    "/api/v1/completePasskeySignIn",
    HttpServerResponse.json(body),
  );

  const other = HttpRouter.add("POST", "/api/v1/getSession", HttpServerResponse.json({}));

  const app = Layer.mergeAll(loginAttemptObserver, route, other).pipe(
    // SAFETY: the observer only calls `insert(...).values(...)` and the fake
    // implements exactly that surface.
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
    expect(rows).toMatchObject([
      {
        accountId: "account-1",
        email: "owner@example.com",
        success: true,
        method: "passkey",
        ip: "203.0.113.0/24",
      },
    ]);
  });

  it("records a rejection", async () => {
    const rows: Array<Schema.Json> = [];

    await request(
      rows,
      { _tag: "Failure", error: { _tag: "PasskeyRejected" } },
      "/api/v1/completePasskeySignIn",
    );

    expect(rows).toMatchObject([
      { accountId: null, success: false, method: "passkey", failureReason: "passkey_rejected" },
    ]);
  });

  it("ignores routes that are not sign-in completions", async () => {
    const rows: Array<Schema.Json> = [];

    await request(rows, { _tag: "Success" }, "/api/v1/getSession");

    expect(rows).toEqual([]);
  });
});
