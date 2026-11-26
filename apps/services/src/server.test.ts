import { describe, expect, it } from "vitest";
import { Context, Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { TestClock } from "effect/testing";
import type { ApnsPushTransport } from "@mattrax/apns";
import { apnsRoutes } from "./apns.ts";
import { relaySignature } from "./relayAuth.ts";
import { makeHttpServerLayer } from "./server.ts";

const servicesToken = "services-token-0123456789abcdef";
const timestamp = "0";
const body = JSON.stringify({
  pushToken: "abcd1234",
  pushMagic: "push-magic",
  topic: "com.apple.mgmt.External.tenant",
  certPem: "certificate",
  privateKeyPem: "private-key",
});

const relayRoutes = (push: ApnsPushTransport["push"] = () => Effect.void) =>
  apnsRoutes({
    token: servicesToken,
    transport: { name: "test", available: true, push },
    analytics: { push: () => {} },
    authorizeLicense: () => Effect.succeed(undefined),
  }).pipe(Layer.provideMerge(TestClock.layer()));

const withServer = <T, A, E, R>(app: Layer.Layer<A, E, R>, run: (origin: string) => Promise<T>) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const serverLayer = makeHttpServerLayer(app, {
          port: 0,
          host: "127.0.0.1",
          gracefulShutdownTimeout: "100 millis",
        });
        const context = yield* Layer.build(serverLayer as Layer.Layer<unknown, unknown>);
        const server = Context.get(context, HttpServer.HttpServer);
        const address = server.address;

        if (address._tag === "UnixPathAddress") throw new Error("expected a TCP server");

        return yield* Effect.promise(() => run(`http://127.0.0.1:${address.port}`));
      }),
    ),
  );

const signedRelayRequest = (origin: string, requestBody: string) =>
  new Request(`${origin}/v1/apns/push`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-apns-timestamp": timestamp,
      "x-apns-signature": relaySignature(servicesToken, timestamp, requestBody),
    },
    body: requestBody,
  });

describe("services Node HTTP server", () => {
  it("rejects an unauthenticated chunked body once it crosses 64 KiB without waiting for EOF", async () => {
    let pushes = 0;
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const requestBody = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(new Uint8Array(64 * 1024 + 1));
      },
    });

    await withServer(
      relayRoutes(() =>
        Effect.sync(() => {
          pushes++;
        }),
      ),
      async (origin) => {
        try {
          const response = await fetch(`${origin}/v1/apns/push`, {
            method: "POST",
            body: requestBody,
            duplex: "half",
            signal: AbortSignal.timeout(2_000),
          } as RequestInit);

          expect(response.status).toBe(413);
          await response.arrayBuffer();
        } finally {
          try {
            streamController?.close();
          } catch {
            // The server may already have closed the request stream.
          }
        }
      },
    );

    expect(pushes).toBe(0);
  });

  it("accepts a body at the 64 KiB cap through authentication and then rejects it", async () => {
    let pushes = 0;

    await withServer(
      relayRoutes(() =>
        Effect.sync(() => {
          pushes++;
        }),
      ),
      async (origin) => {
        const response = await fetch(`${origin}/apns`, {
          method: "POST",
          body: "x".repeat(64 * 1024),
        });

        expect(response.status).toBe(401);
        await response.arrayBuffer();
      },
    );

    expect(pushes).toBe(0);
  });

  it("delivers a signed request through the Node transport", async () => {
    let pushes = 0;

    await withServer(
      relayRoutes(() =>
        Effect.sync(() => {
          pushes++;
        }),
      ),
      async (origin) => {
        const response = await fetch(signedRelayRequest(origin, body));

        expect(response.status).toBe(204);
        await response.arrayBuffer();
      },
    );

    expect(pushes).toBe(1);
  });

  it("closes the listener and disposes application Layers when shutdown interrupts the scope", async () => {
    const events: Array<string> = [];
    const resource = Layer.effectDiscard(
      Effect.acquireRelease(
        Effect.sync(() => {
          events.push("acquired");
        }),
        () =>
          Effect.sync(() => {
            events.push("disposed");
          }),
      ),
    );
    const app = Layer.mergeAll(
      resource,
      HttpRouter.add("GET", "/", Effect.succeed(HttpServerResponse.text("ok"))),
    );

    const origin = await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<number>();
        const serverLayer = makeHttpServerLayer(app, {
          port: 0,
          host: "127.0.0.1",
          gracefulShutdownTimeout: "100 millis",
        });
        const serverFiber = yield* Effect.forkChild(
          Effect.scoped(
            Effect.gen(function* () {
              const context = yield* Layer.build(serverLayer as Layer.Layer<unknown, unknown>);
              const server = Context.get(context, HttpServer.HttpServer);
              const address = server.address;

              if (address._tag === "UnixPathAddress") throw new Error("expected a TCP server");
              yield* Deferred.succeed(started, address.port);
              return yield* Effect.never;
            }),
          ),
        );
        const port = yield* Deferred.await(started);
        const response = yield* Effect.promise(() => fetch(`http://127.0.0.1:${port}/`));
        expect(response.status).toBe(200);
        expect(yield* Effect.promise(() => response.text())).toBe("ok");

        yield* Fiber.interrupt(serverFiber);
        return `http://127.0.0.1:${port}`;
      }),
    );

    expect(events).toEqual(["acquired", "disposed"]);
    await expect(fetch(origin)).rejects.toThrow();
  });

  it("bounds graceful shutdown and interrupts an in-flight request", async () => {
    const handlerStarted = await Effect.runPromise(Deferred.make<void>());
    let handlerInterrupted = false;
    const app = HttpRouter.add(
      "POST",
      "/hang",
      Effect.gen(function* () {
        yield* Deferred.succeed(handlerStarted, undefined);
        return yield* Effect.never;
      }).pipe(
        Effect.as(HttpServerResponse.empty({ status: 204 })),
        Effect.ensuring(
          Effect.sync(() => {
            handlerInterrupted = true;
          }),
        ),
      ),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const serverStarted = yield* Deferred.make<number>();
        const serverLayer = makeHttpServerLayer(app, {
          port: 0,
          host: "127.0.0.1",
          gracefulShutdownTimeout: "50 millis",
        });
        const serverFiber = yield* Effect.forkChild(
          Effect.scoped(
            Effect.gen(function* () {
              const context = yield* Layer.build(serverLayer as Layer.Layer<unknown, unknown>);
              const server = Context.get(context, HttpServer.HttpServer);
              const address = server.address;

              if (address._tag === "UnixPathAddress") throw new Error("expected a TCP server");
              yield* Deferred.succeed(serverStarted, address.port);
              return yield* Effect.never;
            }),
          ),
        );
        const port = yield* Deferred.await(serverStarted);
        const requestFiber = yield* Effect.forkChild(
          Effect.scoped(
            Effect.gen(function* () {
              const signal = yield* Effect.abortSignal;
              return yield* Effect.promise(() =>
                fetch(`http://127.0.0.1:${port}/hang`, {
                  method: "POST",
                  body: "request",
                  signal,
                }),
              );
            }),
          ),
        );
        yield* Deferred.await(handlerStarted);

        const shutdownStarted = Date.now();
        yield* Fiber.interrupt(serverFiber);
        expect(Date.now() - shutdownStarted).toBeLessThan(2_000);
        expect(handlerInterrupted).toBe(true);

        yield* Fiber.interrupt(requestFiber);
      }),
    );
  });

  it("aborts a failed streamed response without appending an error body", async () => {
    const app = Layer.mergeAll(
      HttpRouter.add(
        "GET",
        "/stream",
        Effect.succeed(
          HttpServerResponse.stream(
            Stream.make(new TextEncoder().encode("partial")).pipe(
              Stream.concat(Stream.fromEffect(Effect.sleep("5 millis")).pipe(Stream.drain)),
              Stream.concat(Stream.fail(new Error("stream failed"))),
            ),
          ),
        ),
      ),
      HttpRouter.add("GET", "/ok", Effect.succeed(HttpServerResponse.text("ok"))),
    );

    await withServer(app, async (origin) => {
      let received = "";
      let readFailed = false;
      let status = 0;

      try {
        const response = await fetch(`${origin}/stream`);
        status = response.status;
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += decoder.decode(value, { stream: true });
        }
      } catch {
        readFailed = true;
      }

      expect(readFailed).toBe(true);
      expect(status).toBe(200);
      expect(received).toBe("partial");
      expect(received).not.toContain("Internal Server Error");

      const healthy = await fetch(`${origin}/ok`);
      expect(healthy.status).toBe(200);
      expect(await healthy.text()).toBe("ok");
    });
  });
});
