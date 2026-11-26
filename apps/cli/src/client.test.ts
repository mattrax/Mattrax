import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { createHttpApi } from "./client.ts";

const origin = "https://mattrax.test";
const token = "mtx_test_token_123456";

describe("Mattrax HttpClient", () => {
  it("sends authenticated requests and decodes responses", async () => {
    let authorization: string | undefined;
    let accept: string | undefined;
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        authorization = request.headers.authorization;
        accept = request.headers.accept;

        return HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify({ tenants: [] }), {
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );

    expect(await Effect.runPromise(createHttpApi(client, origin, token).listTenants())).toEqual({
      tenants: [],
    });
    expect(authorization).toBe(`Bearer ${token}`);
    expect(accept).toBe("application/json");
  });

  it("preserves API error details and request ids", async () => {
    const client = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify({ _tag: "Unauthorized", message: "Token rejected" }), {
            status: 401,
            headers: { "x-request-id": "request-1" },
          }),
        ),
      ),
    );

    const error = await Effect.runPromise(
      Effect.flip(createHttpApi(client, origin, token).listTenants()),
    );

    expect(error.message).toContain("HTTP 401 (Unauthorized): Token rejected");
    expect(error.message).toContain("[request request-1]");
  });

  it("encodes query parameters through HttpClientRequest", async () => {
    let requestedUrl: URL | undefined;
    const client = HttpClient.make((_request, url) =>
      Effect.sync(() => {
        requestedUrl = url;

        return HttpClientResponse.fromWeb(
          _request,
          new Response(JSON.stringify({ devices: [], total: 0 }), {
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );

    await Effect.runPromise(
      createHttpApi(client, origin, token).searchDevices("tenant/a", {
        q: "hello world",
        limit: 5,
        offset: 0,
      }),
    );

    expect(requestedUrl?.pathname).toBe("/api/v1/tenants/tenant%2Fa/devices/search");
    expect(requestedUrl?.searchParams.get("q")).toBe("hello world");
    expect(requestedUrl?.searchParams.get("limit")).toBe("5");
    expect(requestedUrl?.searchParams.has("status")).toBe(false);
  });

  it("aborts an in-flight request when the fiber is interrupted", async () => {
    const started = await Effect.runPromise(Deferred.make<void>());
    let signal: AbortSignal | undefined;
    const client = HttpClient.make((_request, _url, abortSignal) =>
      Effect.sync(() => {
        signal = abortSignal;
      }).pipe(Effect.andThen(Deferred.succeed(started, undefined)), Effect.andThen(Effect.never)),
    );
    const fiber = Effect.runFork(createHttpApi(client, origin, token).listTenants());

    await Effect.runPromise(Deferred.await(started));
    await Effect.runPromise(Fiber.interrupt(fiber));
    await Effect.runPromise(Fiber.await(fiber));

    expect(signal?.aborted).toBe(true);
  });

  it("cancels response body reads on interruption", async () => {
    let cancelled = false;
    let bodyStarted!: () => void;
    const bodyRead = new Promise<void>((resolve) => {
      bodyStarted = resolve;
    });
    const client = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(
            new ReadableStream({
              start() {
                bodyStarted();
              },
              cancel() {
                cancelled = true;
              },
            }),
          ),
        ),
      ),
    );
    const fiber = Effect.runFork(createHttpApi(client, origin, token).listTenants());

    await bodyRead;
    await Effect.runPromise(Fiber.interrupt(fiber));
    await Effect.runPromise(Fiber.await(fiber));

    expect(cancelled).toBe(true);
  });

  it("times out requests that never receive a response", async () => {
    // Gate the clock on the transport actually starting: under CPU contention a
    // fork plus TestClock's own yield is not a reliable scheduling barrier, so
    // the 30s deadline may not be installed before virtual time is advanced.
    const started = Deferred.makeUnsafe<void>();
    const client = HttpClient.make(() =>
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
    );
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(createHttpApi(client, origin, token).listTenants());
        yield* Deferred.await(started);
        yield* TestClock.adjust("31 seconds");

        const exit = yield* Fiber.await(fiber);

        return Exit.isFailure(exit)
          ? Cause.squash(exit.cause)
          : yield* Effect.die("Expected timeout");
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(error).toMatchObject({ message: expect.stringContaining("timed out after 30 seconds") });
  });
});
