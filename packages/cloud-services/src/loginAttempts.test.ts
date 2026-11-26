import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import type { Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { Db } from "@mattrax/enterprise-core";
import { signInFactorForPath } from "@mattrax/enterprise-backend";
import { loginAttemptObserver } from "./loginAttempts.js";
import { normalisePath } from "./rateLimit.js";

const chrome =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Let the detached recorder run without a wall-clock sleep. */
const flush = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

/** Serve one request through a router that has the observer and a fake database. */
const requestWith = async (
  rows: Array<Schema.Json>,
  response: Effect.Effect<HttpServerResponse.HttpServerResponse, unknown>,
  path: string,
  onWrite?: (row: Schema.Json) => void,
  headers: Record<string, string> = {
    "user-agent": chrome,
    "x-mattrax-client-address": "203.0.113.8",
  },
): Promise<Response> => {
  const db = {
    insert: () => ({
      values: (row: Schema.Json) =>
        Effect.sync(() => {
          rows.push(row);
          onWrite?.(row);
        }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Effect.succeed<Array<Schema.Json>>([]),
        }),
      }),
    }),
  };

  const endpoint = HttpRouter.add("POST", "/api/v1/completePasskeySignIn", response);

  const other = HttpRouter.add("POST", "/api/v1/getSession", HttpServerResponse.json({}));

  const app = Layer.mergeAll(loginAttemptObserver, endpoint, other).pipe(
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
              headers,
            }),
          ),
        ),
      ({ dispose }) => Effect.promise(dispose),
    ),
  );
};

/** The routes the tests use answer with a fixed JSON body. */
const request = (
  rows: Array<Schema.Json>,
  body: Schema.Json,
  path: string,
  onWrite?: (row: Schema.Json) => void,
) => requestWith(rows, HttpServerResponse.json(body), path, onWrite);

describe("login attempt observer", () => {
  it("stores no address when only spoofable forwarding headers are present", async () => {
    const rows: Array<Schema.Json> = [];
    let signalWrite!: () => void;
    const written = new Promise<void>((resolve) => {
      signalWrite = resolve;
    });
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

    await requestWith(
      rows,
      HttpServerResponse.json(body),
      "/api/v1/completePasskeySignIn",
      signalWrite,
      {
        "user-agent": chrome,
        "cf-connecting-ip": "203.0.113.200",
        "x-forwarded-for": "203.0.113.201",
        "x-real-ip": "203.0.113.202",
      },
    );

    await written;

    expect(rows).toMatchObject([{ accountId: "account-1", ip: null }]);
  });

  it("records a completed session without changing the response", async () => {
    const rows: Array<Schema.Json> = [];
    let signalWrite!: () => void;
    const written = new Promise<void>((resolve) => {
      signalWrite = resolve;
    });

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

    const response = await request(rows, body, "/api/v1/completePasskeySignIn", signalWrite);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);

    await written;

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

  it("leaves a streamed completion body intact", async () => {
    const rows: Array<Schema.Json> = [];
    let signalWrite!: () => void;
    const written = new Promise<void>((resolve) => {
      signalWrite = resolve;
    });

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

    // The auth library answers through `HttpServerResponse.fromWeb`, which wraps
    // a one-shot stream: reading it through `toWeb` would consume the body the
    // client still needs.
    const response = await requestWith(
      rows,
      Effect.succeed(
        HttpServerResponse.fromWeb(
          new Response(JSON.stringify(body), {
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
      "/api/v1/completePasskeySignIn",
      signalWrite,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);

    await written;

    expect(rows).toHaveLength(1);
  });

  it("matches the route after case, duplicate-slash and trailing-slash normalisation", async () => {
    const rows: Array<Schema.Json> = [];
    let signalWrite!: () => void;
    const written = new Promise<void>((resolve) => {
      signalWrite = resolve;
    });

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
      signalWrite,
    );

    expect(response.status).toBe(200);

    await written;

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

    await flush();

    expect(rows).toEqual([]);
  });

  it("ignores routes that are not sign-in completions", async () => {
    const rows: Array<Schema.Json> = [];

    await request(rows, { _tag: "Success" }, "/api/v1/getSession");

    await flush();

    expect(rows).toEqual([]);
  });
});
