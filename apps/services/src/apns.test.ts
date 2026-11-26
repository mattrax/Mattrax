import { describe, expect, it } from "vitest";
import { Clock, Deferred, Effect, Fiber, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { TestClock } from "effect/testing";
import type { ApnsPushTransport } from "@mattrax/apns";
import { apnsRoutes } from "./apns.ts";
import { relaySignature } from "./relayAuth.ts";

const servicesToken = "services-token-0123456789abcdef";
const now = 1_700_000_000_000;
const timestamp = String(Math.floor(now / 1000));
const body = JSON.stringify({
  pushToken: "abcd1234",
  pushMagic: "push-magic",
  topic: "com.apple.mgmt.External.tenant",
  certPem: "certificate",
  privateKeyPem: "private-key",
});

const transport = (push: ApnsPushTransport["push"] = () => Effect.void): ApnsPushTransport => ({
  name: "test",
  available: true,
  push,
});

const routes = (pushTransport: ApnsPushTransport) =>
  apnsRoutes({
    token: servicesToken,
    transport: pushTransport,
    analytics: { push: () => {} },
    authorizeLicense: () => Effect.succeed(undefined),
  });

const signedRequest = (
  requestBody: string,
  requestTimestamp = timestamp,
  path = "/v1/apns/push",
  signal?: AbortSignal,
) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-apns-timestamp": requestTimestamp,
      "x-apns-signature": relaySignature(servicesToken, requestTimestamp, requestBody),
    },
    body: requestBody,
    signal,
  });

const withHandler = <A, E>(
  pushTransport: ApnsPushTransport,
  use: (
    handler: (request: Request) => Promise<Response>,
    clock: TestClock.TestClock,
  ) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* TestClock.make();
        yield* clock.setTime(now);
        const { handler } = yield* Effect.acquireRelease(
          Effect.sync(() =>
            HttpRouter.toWebHandler(
              routes(pushTransport).pipe(Layer.provideMerge(Layer.succeed(Clock.Clock, clock))),
              { disableLogger: true },
            ),
          ),
          (webHandler) => Effect.promise(webHandler.dispose),
        );

        return yield* use(handler, clock);
      }),
    ),
  );

describe("APNs relay routes", () => {
  it("serves the documented relay path and passes the decoded body to the transport", async () => {
    const inputs: Array<unknown> = [];
    const pushTransport = transport((input) => Effect.sync(() => void inputs.push(input)));

    await withHandler(pushTransport, (handler) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          handler(signedRequest(body, timestamp, "/v1/apns/push")),
        );
        expect(response.status).toBe(204);
      }),
    );

    expect(inputs).toEqual([
      {
        pushToken: "abcd1234",
        pushMagic: "push-magic",
        topic: "com.apple.mgmt.External.tenant",
        certPem: "certificate",
        privateKeyPem: "private-key",
      },
    ]);
  });

  it("serves the compatibility relay path and passes the decoded body to the transport", async () => {
    const inputs: Array<unknown> = [];
    const pushTransport = transport((input) => Effect.sync(() => void inputs.push(input)));

    await withHandler(pushTransport, (handler) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          handler(signedRequest(body, timestamp, "/apns")),
        );
        expect(response.status).toBe(204);
      }),
    );

    expect(inputs).toEqual([
      {
        pushToken: "abcd1234",
        pushMagic: "push-magic",
        topic: "com.apple.mgmt.External.tenant",
        certPem: "certificate",
        privateKeyPem: "private-key",
      },
    ]);
  });

  it("rejects a correctly signed NaN timestamp before pushing", async () => {
    let pushes = 0;
    const pushTransport = transport(() => Effect.sync(() => void pushes++));

    await withHandler(pushTransport, (handler) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => handler(signedRequest(body, "NaN")));
        expect(response.status).toBe(401);
      }),
    );

    expect(pushes).toBe(0);
  });

  it("rejects a correctly signed Infinity timestamp before pushing", async () => {
    let pushes = 0;
    const pushTransport = transport(() => Effect.sync(() => void pushes++));

    await withHandler(pushTransport, (handler) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => handler(signedRequest(body, "Infinity")));
        expect(response.status).toBe(401);
      }),
    );

    expect(pushes).toBe(0);
  });

  it("rejects a correctly signed negative Infinity timestamp before pushing", async () => {
    let pushes = 0;
    const pushTransport = transport(() => Effect.sync(() => void pushes++));

    await withHandler(pushTransport, (handler) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => handler(signedRequest(body, "-Infinity")));
        expect(response.status).toBe(401);
      }),
    );

    expect(pushes).toBe(0);
  });

  it("rejects a correctly signed a fractional timestamp timestamp before pushing", async () => {
    let pushes = 0;
    const pushTransport = transport(() => Effect.sync(() => void pushes++));

    await withHandler(pushTransport, (handler) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => handler(signedRequest(body, "1700000000.5")));
        expect(response.status).toBe(401);
      }),
    );

    expect(pushes).toBe(0);
  });

  it("rejects a correctly signed a timestamp beyond the safe integer range timestamp before pushing", async () => {
    let pushes = 0;
    const pushTransport = transport(() => Effect.sync(() => void pushes++));

    await withHandler(pushTransport, (handler) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          handler(signedRequest(body, "9007199254740992")),
        );
        expect(response.status).toBe(401);
      }),
    );

    expect(pushes).toBe(0);
  });

  it("answers 204 for a signed timestamp 300 seconds before now", async () => {
    const timestamp = String(Math.floor(now / 1000) + -300);

    await withHandler(transport(), (handler, clock) =>
      Effect.gen(function* () {
        yield* clock.setTime(now + 999);
        const response = yield* Effect.promise(() => handler(signedRequest(body, timestamp)));
        expect(response.status).toBe(204);
      }),
    );
  });

  it("answers 204 for a signed timestamp 300 seconds after now", async () => {
    const timestamp = String(Math.floor(now / 1000) + 300);

    await withHandler(transport(), (handler, clock) =>
      Effect.gen(function* () {
        yield* clock.setTime(now + 999);
        const response = yield* Effect.promise(() => handler(signedRequest(body, timestamp)));
        expect(response.status).toBe(204);
      }),
    );
  });

  it("answers 401 for a signed timestamp 301 seconds before now", async () => {
    const timestamp = String(Math.floor(now / 1000) + -301);

    await withHandler(transport(), (handler, clock) =>
      Effect.gen(function* () {
        yield* clock.setTime(now + 999);
        const response = yield* Effect.promise(() => handler(signedRequest(body, timestamp)));
        expect(response.status).toBe(401);
      }),
    );
  });

  it("answers 401 for a signed timestamp 301 seconds after now", async () => {
    const timestamp = String(Math.floor(now / 1000) + 301);

    await withHandler(transport(), (handler, clock) =>
      Effect.gen(function* () {
        yield* clock.setTime(now + 999);
        const response = yield* Effect.promise(() => handler(signedRequest(body, timestamp)));
        expect(response.status).toBe(401);
      }),
    );
  });

  it("rejects signed malformed body the literal null without crashing or pushing", async () => {
    let pushes = 0;
    const pushTransport = transport(() => Effect.sync(() => void pushes++));

    await withHandler(pushTransport, (handler) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => handler(signedRequest("null")));
        expect(response.status).toBe(400);
        const parsed = yield* Effect.promise(() => response.json());
        expect(parsed).toEqual({ message: "Invalid APNs request." });
      }),
    );

    expect(pushes).toBe(0);
  });

  it("rejects signed malformed body a truncated JSON object without crashing or pushing", async () => {
    let pushes = 0;
    const pushTransport = transport(() => Effect.sync(() => void pushes++));

    await withHandler(pushTransport, (handler) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => handler(signedRequest("{")));
        expect(response.status).toBe(400);
        const parsed = yield* Effect.promise(() => response.json());
        expect(parsed).toEqual({ message: "Invalid APNs request." });
      }),
    );

    expect(pushes).toBe(0);
  });

  it("rejects signed malformed body an object missing the signature fields without crashing or pushing", async () => {
    let pushes = 0;
    const pushTransport = transport(() => Effect.sync(() => void pushes++));

    await withHandler(pushTransport, (handler) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          handler(signedRequest('{"pushToken":"abcd1234"}')),
        );
        expect(response.status).toBe(400);
        const parsed = yield* Effect.promise(() => response.json());
        expect(parsed).toEqual({ message: "Invalid APNs request." });
      }),
    );

    expect(pushes).toBe(0);
  });

  it("preserves body-read failures instead of treating them as empty input", async () => {
    await withHandler(transport(), (handler) =>
      Effect.gen(function* () {
        const requestBody = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error("request stream failed"));
          },
        });
        const response = yield* Effect.promise(() =>
          handler(
            new Request("http://localhost/v1/apns/push", {
              method: "POST",
              body: requestBody,
              duplex: "half",
            } as RequestInit),
          ),
        );

        // A swallowed read failure would become an empty body and return 401.
        expect(response.status).toBe(400);
        expect(yield* Effect.promise(() => response.text())).toBe("");
      }),
    );
  });

  it("interrupts APNs delivery and runs its finalizer when the request is aborted", async () => {
    const started = await Effect.runPromise(Deferred.make<void>());
    let finalized = false;
    const pushTransport = transport(() =>
      Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined);
        return yield* Effect.never;
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            finalized = true;
          }),
        ),
      ),
    );
    const controller = new AbortController();

    await withHandler(pushTransport, (handler) =>
      Effect.gen(function* () {
        const request = yield* Effect.forkChild(
          Effect.promise(() =>
            handler(signedRequest(body, timestamp, "/v1/apns/push", controller.signal)),
          ),
        );
        yield* Deferred.await(started);
        controller.abort();
        const response = yield* Fiber.join(request);

        expect(response.status).toBe(499);
        expect(finalized).toBe(true);
      }),
    );
  });
});
