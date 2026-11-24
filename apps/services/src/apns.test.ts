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
  it("serves both relay paths and passes the decoded body to the transport", async () => {
    const inputs: Array<unknown> = [];
    const pushTransport = transport((input) =>
      Effect.sync(() => {
        inputs.push(input);
      }),
    );

    await withHandler(pushTransport, (handler) =>
      Effect.gen(function* () {
        for (const path of ["/v1/apns/push", "/apns"]) {
          const response = yield* Effect.promise(() =>
            handler(signedRequest(body, timestamp, path)),
          );
          expect(response.status).toBe(204);
        }
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
      {
        pushToken: "abcd1234",
        pushMagic: "push-magic",
        topic: "com.apple.mgmt.External.tenant",
        certPem: "certificate",
        privateKeyPem: "private-key",
      },
    ]);
  });

  it.each(["NaN", "Infinity", "-Infinity", "1700000000.5", "9007199254740992"])(
    "rejects a correctly signed invalid timestamp %s before pushing",
    async (invalidTimestamp) => {
      let pushes = 0;
      const pushTransport = transport(() =>
        Effect.sync(() => {
          pushes++;
        }),
      );

      await withHandler(pushTransport, (handler) =>
        Effect.gen(function* () {
          const response = yield* Effect.promise(() =>
            handler(signedRequest(body, invalidTimestamp)),
          );
          expect(response.status).toBe(401);
        }),
      );

      expect(pushes).toBe(0);
    },
  );

  it("uses TestClock time for deterministic replay-window boundaries", async () => {
    await withHandler(transport(), (handler, clock) =>
      Effect.gen(function* () {
        for (const delta of [-300, 300]) {
          const requestTimestamp = String(Math.floor(now / 1000) + delta);
          yield* clock.setTime(now + 999);
          const response = yield* Effect.promise(() =>
            handler(signedRequest(body, requestTimestamp)),
          );
          expect(response.status).toBe(204);
        }

        for (const delta of [-301, 301]) {
          const requestTimestamp = String(Math.floor(now / 1000) + delta);
          yield* clock.setTime(now + 999);
          const response = yield* Effect.promise(() =>
            handler(signedRequest(body, requestTimestamp)),
          );
          expect(response.status).toBe(401);
        }
      }),
    );
  });

  it.each(["null", "{", JSON.stringify({ pushToken: "abcd1234" })])(
    "rejects signed malformed body %s without crashing or pushing",
    async (malformedBody) => {
      let pushes = 0;
      const pushTransport = transport(() =>
        Effect.sync(() => {
          pushes++;
        }),
      );

      await withHandler(pushTransport, (handler) =>
        Effect.gen(function* () {
          const response = yield* Effect.promise(() => handler(signedRequest(malformedBody)));
          expect(response.status).toBe(400);
          const parsed = yield* Effect.promise(() => response.json());
          expect(parsed).toEqual({
            message: "Invalid APNs request.",
          });
        }),
      );

      expect(pushes).toBe(0);
    },
  );

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
