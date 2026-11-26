import { describe, expect, it } from "vitest";
import { Deferred, Effect, Fiber, Logger, Ref } from "effect";
import { TestClock } from "effect/testing";
import {
  BackgroundDelivery,
  BackgroundDeliveryKeepAlive,
  BackgroundDeliveryLive,
  SharedBackgroundDeliveryLive,
  resetSharedBackgroundDelivery,
} from "./backgroundDelivery.js";

describe("background delivery", () => {
  it("enqueues without waiting and drops new work when the bounded queue is full", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const delivery = yield* BackgroundDelivery;

        try {
          const first = yield* delivery.enqueue(
            "blocked",
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
          );
          if (!first) throw new Error("first job was not accepted");
          yield* Deferred.await(started).pipe(
            Effect.timeoutOrElse({
              duration: "100 millis",
              orElse: () => Effect.fail(new Error("worker did not start")),
            }),
          );

          const second = yield* delivery.enqueue("queued", Effect.void).pipe(
            Effect.timeoutOrElse({
              duration: "100 millis",
              orElse: () => Effect.fail(new Error("enqueue waited for a busy worker")),
            }),
          );
          const third = yield* delivery.enqueue("dropped", Effect.void);

          expect([first, second, third]).toEqual([true, true, false]);
        } finally {
          yield* Deferred.succeed(release, undefined);
        }
      }).pipe(
        Effect.provide(BackgroundDeliveryLive({ capacity: 1, concurrency: 1 })),
        Effect.provide(TestClock.layer()),
      ),
    );
  });

  it("retries failed jobs with bounded exponential backoff", async () => {
    const attempts = await Effect.runPromise(
      Effect.gen(function* () {
        const attempts = yield* Ref.make(0);
        const done = yield* Deferred.make<void>();
        const delivery = yield* BackgroundDelivery;

        const fiber = yield* Effect.forkChild(
          Effect.gen(function* () {
            yield* delivery.enqueue(
              "retry",
              Effect.gen(function* () {
                const attempt = yield* Ref.updateAndGet(attempts, (value) => value + 1);

                if (attempt < 3) return yield* Effect.fail(new Error("try again"));
                yield* Deferred.succeed(done, undefined);
              }),
            );
            yield* Deferred.await(done);
          }),
          { startImmediately: true },
        );

        // The worker schedules its exponential backoff on the Effect clock.
        // Advance virtual time until the third attempt completes; no real
        // millisecond is spent waiting for a timer.
        for (let i = 0; i < 5 && !(yield* Deferred.isDone(done)); i++) {
          yield* TestClock.adjust("10 millis");
          yield* Effect.yieldNow;
        }
        yield* Fiber.join(fiber);

        return yield* Ref.get(attempts);
      }).pipe(
        Effect.provide(BackgroundDeliveryLive({ concurrency: 1, maxAttempts: 3, retryDelayMs: 1 })),
        Effect.provide(TestClock.layer()),
      ),
    );

    expect(attempts).toBe(3);
  });

  it("drains queued jobs when its scope closes", async () => {
    const completed = await Effect.runPromise(
      Effect.gen(function* () {
        const count = yield* Ref.make(0);
        const started = yield* Deferred.make<void>();

        const fiber = yield* Effect.forkChild(
          Effect.scoped(
            Effect.gen(function* () {
              const delivery = yield* BackgroundDelivery;
              yield* delivery.enqueue(
                "drain",
                Effect.gen(function* () {
                  yield* Deferred.succeed(started, undefined);
                  yield* Effect.sleep("10 millis");
                  yield* Ref.update(count, (value) => value + 1);
                }),
              );
            }).pipe(Effect.provide(BackgroundDeliveryLive({ concurrency: 1 }))),
          ),
          { startImmediately: true },
        );

        yield* Deferred.await(started);
        yield* TestClock.adjust("10 millis");
        yield* Fiber.join(fiber);

        return yield* Ref.get(count);
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(completed).toBe(1);
  });

  it("interrupts stuck workers after the shutdown grace period", async () => {
    const interrupted = await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();

        const fiber = yield* Effect.forkChild(
          Effect.scoped(
            Effect.gen(function* () {
              const delivery = yield* BackgroundDelivery;
              yield* delivery.enqueue(
                "stuck",
                Effect.gen(function* () {
                  yield* Deferred.succeed(started, undefined);
                  return yield* Effect.never;
                }).pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
              );
            }).pipe(
              Effect.provide(BackgroundDeliveryLive({ concurrency: 1, shutdownTimeoutMs: 20 })),
            ),
          ),
          { startImmediately: true },
        );

        yield* Deferred.await(started);
        // The grace period is a virtual 20ms timer: advancing it must trigger
        // the interrupt and let the scope close, with no elapsed-time check.
        yield* TestClock.adjust("20 millis");
        yield* Fiber.join(fiber);
        yield* Deferred.await(interrupted);

        return true;
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(interrupted).toBe(true);
  });

  it("starts no worker fibers until the first accepted job", async () => {
    const counts = await Effect.runPromise(
      Effect.gen(function* () {
        const delivery = yield* BackgroundDelivery;
        const before = yield* delivery.workerCount;

        yield* delivery.enqueue("wake", Effect.void);
        // Let the worker take the job before reading the fiber count.
        yield* Effect.yieldNow;
        const after = yield* delivery.workerCount;

        return { before, after };
      }).pipe(
        Effect.provide(BackgroundDeliveryLive({ concurrency: 1 })),
        Effect.provide(TestClock.layer()),
      ),
    );

    expect(counts.before).toBe(0);
    expect(counts.after).toBe(1);
  });

  it("tracks each accepted job with the request keep-alive until it settles", async () => {
    const delivered = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tasks: Array<Promise<unknown>> = [];
          const delivery = yield* BackgroundDelivery;
          const release = yield* Deferred.make<void>();
          const count = yield* Ref.make(0);
          const keepAlive = BackgroundDeliveryKeepAlive.of({
            track: (work) => {
              tasks.push(work);
            },
          });

          yield* delivery
            .enqueue(
              "held",
              Deferred.await(release).pipe(Effect.andThen(Ref.update(count, (n) => n + 1))),
            )
            .pipe(Effect.provideService(BackgroundDeliveryKeepAlive, keepAlive));

          if (tasks.length !== 1) throw new Error("job was not tracked");

          let settled = false;
          void tasks[0]!.finally(() => {
            settled = true;
          });
          yield* Effect.promise(() => Promise.resolve());

          if (settled) throw new Error("job settled before it was released");

          yield* Deferred.succeed(release, undefined);
          yield* Effect.promise(() => tasks[0]!);

          return yield* Ref.get(count);
        }).pipe(
          Effect.provide(BackgroundDeliveryLive({ concurrency: 1 })),
          Effect.provide(TestClock.layer()),
        ),
      ),
    );

    expect(delivered).toBe(1);
  });

  it("pins shared-queue drop behavior across tenants and names the dropped tenant", async () => {
    const messages: string[] = [];
    const logger = Logger.make<unknown, void>((options) => {
      messages.push(String(options.message));
    });

    const accepted = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const delivery = yield* BackgroundDelivery;
          const started = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();

          yield* delivery.enqueue(
            "tenant-a",
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
            { organizationId: "org-a" },
          );
          yield* Deferred.await(started);

          const queued = yield* delivery.enqueue("tenant-b", Effect.void, {
            organizationId: "org-b",
          });
          const rejected = yield* delivery.enqueue("tenant-c", Effect.void, {
            organizationId: "org-c",
          });

          yield* Deferred.succeed(release, undefined);

          return { queued, rejected };
        }).pipe(Effect.provide(BackgroundDeliveryLive({ capacity: 1, concurrency: 1 }))),
      ).pipe(Effect.provide(Logger.layer([logger])), Effect.provide(TestClock.layer())),
    );

    // One tenant's slow job occupies the single worker; another tenant's job
    // fits in the buffer, and the next tenant is dropped. This is the intended
    // bounded best-effort policy, not per-tenant isolation.
    expect(accepted).toEqual({ queued: true, rejected: false });
    expect(messages.some((message) => message.includes("tenant-c"))).toBe(true);
    expect(messages.some((message) => message.includes("org-c"))).toBe(true);
  });

  it("runs a queued job after the enqueuing layer scope has closed", async () => {
    const gate = await Effect.runPromise(Deferred.make<void>());
    const done = await Effect.runPromise(Deferred.make<void>());
    const count = await Effect.runPromise(Ref.make(0));

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const delivery = yield* BackgroundDelivery;

            yield* delivery.enqueue(
              "after-close",
              Effect.gen(function* () {
                yield* Deferred.await(gate);
                yield* Ref.update(count, (value) => value + 1);
                yield* Deferred.succeed(done, undefined);
              }),
            );
          }).pipe(
            Effect.provide(SharedBackgroundDeliveryLive({ concurrency: 1 })),
            Effect.provide(TestClock.layer()),
          ),
        ),
      );

      expect(await Effect.runPromise(Deferred.isDone(done))).toBe(false);

      await Effect.runPromise(Deferred.succeed(gate, undefined));
      await Effect.runPromise(Deferred.await(done));

      expect(await Effect.runPromise(Ref.get(count))).toBe(1);
    } finally {
      await resetSharedBackgroundDelivery();
    }
  });

  it("shares one isolate-scoped queue across rebuilt request layers", async () => {
    try {
      const first = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* BackgroundDelivery;
        }).pipe(
          Effect.provide(SharedBackgroundDeliveryLive({ concurrency: 1 })),
          Effect.provide(TestClock.layer()),
        ),
      );
      const second = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* BackgroundDelivery;
        }).pipe(
          Effect.provide(SharedBackgroundDeliveryLive({ concurrency: 1 })),
          Effect.provide(TestClock.layer()),
        ),
      );

      expect(second).toBe(first);
      expect(await Effect.runPromise(first.workerCount)).toBe(0);
    } finally {
      await resetSharedBackgroundDelivery();
    }
  });
});
