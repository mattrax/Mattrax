import { Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { API_TIMEOUT_MILLIS, ApiClient } from "./api-client";
import { Bindings } from "./bindings";

const clientLayer = (client: HttpClient.HttpClient) =>
  ApiClient.layerHttp.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)));

const responseClient = (response: Response) =>
  HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, response)));

const Payload = Schema.Struct({ value: Schema.String });

describe("ApiClient", () => {
  it("maps malformed successful JSON to a typed decode failure", async () => {
    const program = ApiClient.pipe(
      Effect.flatMap((client) =>
        client.json(HttpClientRequest.get("https://api.test/data"), Payload),
      ),
    ).pipe(Effect.provide(clientLayer(responseClient(Response.json({ value: 42 })))));

    await expect(Effect.runPromise(program)).rejects.toMatchObject({
      _tag: "ApiError",
      reason: "decode",
    });
  });

  it("maps non-2xx responses to status failures and consumes the body", async () => {
    const source = Response.json({ message: "nope" }, { status: 422 });
    const program = ApiClient.pipe(
      Effect.flatMap((client) =>
        client.json(HttpClientRequest.get("https://api.test/data"), Payload),
      ),
    ).pipe(Effect.provide(clientLayer(responseClient(source))));

    await expect(Effect.runPromise(program)).rejects.toMatchObject({
      _tag: "ApiError",
      reason: "status",
      status: 422,
    });
    expect(source.bodyUsed).toBe(true);
  });

  it("cancels oversized bodies before buffering them", async () => {
    let cancelled = false;
    const source = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(8));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    const program = ApiClient.pipe(
      Effect.flatMap((client) =>
        client
          .execute(HttpClientRequest.get("https://api.test/data"))
          .pipe(Effect.flatMap((response) => client.bounded(response, 4))),
      ),
      Effect.flatMap((response) => response.arrayBuffer),
    ).pipe(Effect.provide(clientLayer(responseClient(source))));

    await expect(Effect.runPromise(program)).rejects.toBeDefined();
    expect(cancelled).toBe(true);
  });

  it("times out an injected transport with TestClock", async () => {
    // Gate the clock on the transport actually starting. A fork plus TestClock's
    // internal yield is not a reliable barrier under CPU contention: the 15s
    // deadline might not be installed before virtual time is advanced.
    const started = Deferred.makeUnsafe<void>();
    const client = HttpClient.make(() =>
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
    );
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        ApiClient.pipe(
          Effect.flatMap((api) => api.execute(HttpClientRequest.get("https://api.test/slow"))),
        ),
      );
      yield* Deferred.await(started);
      yield* TestClock.adjust(API_TIMEOUT_MILLIS);
      const exit = yield* Fiber.await(fiber);

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(exit.cause).toBeDefined();
    }).pipe(Effect.provide(clientLayer(client)), Effect.provide(TestClock.layer()));

    await Effect.runPromise(program);
  });

  it("aborts the injected transport when the request fiber is interrupted", async () => {
    let signal: AbortSignal | undefined;
    const client = HttpClient.make((_request, _url, nextSignal) => {
      signal = nextSignal;

      return Effect.never;
    });
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        ApiClient.pipe(
          Effect.flatMap((api) => api.execute(HttpClientRequest.get("https://api.test/slow"))),
        ),
      );
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      yield* Fiber.await(fiber);
      expect(signal?.aborted).toBe(true);
    }).pipe(Effect.provide(clientLayer(client)));

    await Effect.runPromise(program);
  });

  it("owns the Cloudflare service-binding transport and preserves the request", async () => {
    let seen: Request | undefined;
    const bindings = Bindings.of({
      AUTH_SECRET: undefined,
      POSTHOG_KEY: undefined,
      POSTHOG_HOST: undefined,
      SUPPORT_URL: undefined,
      API_URL: undefined,
      API: {
        fetch: async (request) => {
          seen = request;

          return Response.json({ value: "ok" });
        },
      },
    });
    const request = new Request("https://api.mattrax.internal/data?q=1", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test": "yes" },
      body: JSON.stringify({ input: true }),
    });
    const response = await Effect.runPromise(
      ApiClient.pipe(Effect.flatMap((client) => client.web(request))).pipe(
        Effect.provide(ApiClient.layer),
        Effect.provideService(Bindings, bindings),
      ),
    );

    expect(await response.json()).toEqual({ value: "ok" });
    expect(seen?.method).toBe("POST");
    expect(seen?.headers.get("x-test")).toBe("yes");
    expect(await seen?.text()).toBe(JSON.stringify({ input: true }));
  });
});
