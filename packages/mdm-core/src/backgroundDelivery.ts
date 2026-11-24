import { Cause, Context, Effect, Fiber, Layer, Metric, Queue, Schedule } from "effect";

export type BackgroundDeliveryOptions = {
  /** Maximum buffered jobs. New jobs are dropped when a dropping queue is full. */
  readonly capacity?: number;
  /** Number of supervised workers. Defaults to 4. */
  readonly concurrency?: number;
  /** Total attempts per job, including the first. Defaults to 3. */
  readonly maxAttempts?: number;
  /** Initial retry delay; retries use exponential backoff. Defaults to 100 ms. */
  readonly retryDelayMs?: number;
  /** Grace period for queued work during shutdown. Defaults to 15 seconds. */
  readonly shutdownTimeoutMs?: number;
};

type DeliveryJob = {
  readonly name: string;
  readonly effect: Effect.Effect<void, unknown>;
};

export type BackgroundDeliveryService = {
  /** Returns false immediately when the bounded queue is full or closing. */
  readonly enqueue: (name: string, effect: Effect.Effect<void, unknown>) => Effect.Effect<boolean>;
};

export class BackgroundDelivery extends Context.Service<
  BackgroundDelivery,
  BackgroundDeliveryService
>()("@mattrax/mdm-core/BackgroundDelivery") {}

const positive = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;

const enqueued = Metric.counter("mdm_background_delivery_enqueued_total", { incremental: true });
const dropped = Metric.counter("mdm_background_delivery_dropped_total", { incremental: true });
const completed = Metric.counter("mdm_background_delivery_completed_total", { incremental: true });
const failed = Metric.counter("mdm_background_delivery_failed_total", { incremental: true });

/**
 * A bounded, scoped worker queue for best-effort MDM delivery.
 *
 * Enqueue never waits for network I/O. Jobs are retried with bounded
 * exponential backoff, and shutdown first closes the queue, then gives workers
 * a grace period to drain before interrupting them.
 *
 * This queue is process-local. Webhook attempts still use the existing
 * `webhook_delivery` rows and maintenance retries; a crash before an attempt
 * can lose an unprocessed in-memory job. Durable pre-attempt outbox semantics
 * require a separate schema-backed queue.
 */
export const BackgroundDeliveryLive = (
  options: BackgroundDeliveryOptions = {},
): Layer.Layer<BackgroundDelivery> =>
  Layer.effect(
    BackgroundDelivery,
    Effect.gen(function* () {
      const capacity = positive(options.capacity, 100);
      const concurrency = positive(options.concurrency, 4);
      const maxAttempts = positive(options.maxAttempts, 3);
      const retryDelayMs = positive(options.retryDelayMs, 100);
      const shutdownTimeoutMs = positive(options.shutdownTimeoutMs, 15_000);
      const queue = yield* Queue.make<DeliveryJob, Cause.Done>({
        capacity,
        strategy: "dropping",
      });

      const worker = Effect.fnUntraced(function* (): Effect.fn.Return<void, unknown> {
        while (true) {
          const job = yield* Queue.take(queue).pipe(
            Effect.catchTag("Done", () => Effect.succeed(null)),
          );

          if (!job) return;

          yield* job.effect.pipe(
            Effect.retry({
              times: maxAttempts - 1,
              schedule: Schedule.exponential(`${retryDelayMs} millis`),
            }),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterrupts(cause),
              (cause) =>
                Metric.update(failed, 1).pipe(
                  Effect.andThen(
                    Effect.logWarning(`Background delivery ${job.name} failed`, cause),
                  ),
                ),
            ),
            Effect.andThen(Metric.update(completed, 1)),
          );
        }
      });

      const workers = yield* Effect.forEach(
        Array.from({ length: concurrency }, () => worker()),
        (effect) => Effect.forkScoped(effect),
      );

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* Queue.end(queue);
          yield* Effect.exit(
            Fiber.joinAll(workers).pipe(
              Effect.timeoutOrElse({
                duration: `${shutdownTimeoutMs} millis`,
                orElse: () => Fiber.interruptAll(workers),
              }),
            ),
          );
        }),
      );

      return BackgroundDelivery.of({
        enqueue: (name, effect) =>
          Effect.gen(function* () {
            const accepted = yield* Queue.offer(queue, { name, effect });

            if (accepted) {
              yield* Metric.update(enqueued, 1);
            } else {
              yield* Metric.update(dropped, 1);
              yield* Effect.logWarning(`Background delivery queue is full; dropped ${name}`);
            }

            return accepted;
          }),
      });
    }),
  );
