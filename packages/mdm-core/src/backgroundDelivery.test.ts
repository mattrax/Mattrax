import { describe, expect, it } from "vitest";
import { Deferred, Effect, Ref } from "effect";
import { BackgroundDelivery, BackgroundDeliveryLive } from "./backgroundDelivery.js";

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
      }).pipe(Effect.provide(BackgroundDeliveryLive({ capacity: 1, concurrency: 1 }))),
    );
  });

  it("retries failed jobs with bounded exponential backoff", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const attempts = yield* Ref.make(0);
        const done = yield* Deferred.make<void>();
        const delivery = yield* BackgroundDelivery;

        yield* delivery.enqueue(
          "retry",
          Effect.gen(function* () {
            const attempt = yield* Ref.updateAndGet(attempts, (value) => value + 1);

            if (attempt < 3) return yield* Effect.fail(new Error("try again"));
            yield* Deferred.succeed(done, undefined);
          }),
        );
        yield* Deferred.await(done).pipe(
          Effect.timeoutOrElse({
            duration: "1 second",
            orElse: () => Effect.fail(new Error("job was not retried")),
          }),
        );

        expect(yield* Ref.get(attempts)).toBe(3);
      }).pipe(
        Effect.provide(BackgroundDeliveryLive({ concurrency: 1, maxAttempts: 3, retryDelayMs: 1 })),
      ),
    );
  });

  it("drains queued jobs when its scope closes", async () => {
    const completed = await Effect.runPromise(
      Effect.gen(function* () {
        const count = yield* Ref.make(0);

        yield* Effect.scoped(
          Effect.gen(function* () {
            const delivery = yield* BackgroundDelivery;
            yield* delivery.enqueue(
              "drain",
              Effect.sleep("10 millis").pipe(
                Effect.andThen(Ref.update(count, (value) => value + 1)),
              ),
            );
          }).pipe(Effect.provide(BackgroundDeliveryLive({ concurrency: 1 }))),
        );

        return yield* Ref.get(count);
      }),
    );

    expect(completed).toBe(1);
  });

  it("interrupts stuck workers after the shutdown grace period", async () => {
    const started = Date.now();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const delivery = yield* BackgroundDelivery;
          yield* delivery.enqueue("stuck", Effect.never);
        }).pipe(Effect.provide(BackgroundDeliveryLive({ concurrency: 1, shutdownTimeoutMs: 20 }))),
      ),
    );

    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
