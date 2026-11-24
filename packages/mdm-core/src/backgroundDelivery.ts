import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Metric,
  Option,
  Queue,
  Ref,
  Schedule,
  Scope,
} from "effect";

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
  /** Resolves once the job has finished, failed, or been interrupted. */
  readonly done: Deferred.Deferred<void>;
};

export type BackgroundDeliveryService = {
  /** Returns false immediately when the bounded queue is full or closing. */
  readonly enqueue: (name: string, effect: Effect.Effect<void, unknown>) => Effect.Effect<boolean>;
  /**
   * Worker fibers currently started. Zero until the first accepted job, which
   * is what lets an ordinary API request avoid creating unused fibers.
   */
  readonly workerCount: Effect.Effect<number>;
};

export class BackgroundDelivery extends Context.Service<
  BackgroundDelivery,
  BackgroundDeliveryService
>()("@mattrax/mdm-core/BackgroundDelivery") {}

/**
 * Request-scoped keep-alive supplied by a host that can extend the invocation
 * after the response (Cloudflare's `ctx.waitUntil`). The queue uses it so a
 * delivery job enqueued during a request is not frozen when the response
 * returns.
 */
export type BackgroundDeliveryKeepAliveService = {
  readonly track: (work: Promise<unknown>) => void;
};

export class BackgroundDeliveryKeepAlive extends Context.Service<
  BackgroundDeliveryKeepAlive,
  BackgroundDeliveryKeepAliveService
>()("@mattrax/mdm-core/BackgroundDeliveryKeepAlive") {}

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
 * Enqueue never waits for network I/O. Workers start on the first accepted job
 * rather than during layer construction, so a request that enqueues nothing
 * creates no fibers. Jobs are retried with bounded exponential backoff, and
 * shutdown first closes the queue, then gives workers a grace period to drain
 * before interrupting them.
 *
 * When the caller supplies {@link BackgroundDeliveryKeepAlive}, every accepted
 * job is registered with the host invocation until it settles. That keeps the
 * queue alive after the response without making the response wait for the full
 * shutdown grace period.
 *
 * This queue is process-local. Webhook callers persist attempt-0
 * `webhook_delivery` rows before enqueueing, so a crash or full queue does not
 * lose the event: maintenance retries recover those rows. APNs wake-up pushes
 * are intentionally non-durable and may be dropped on crash or queue pressure;
 * devices still poll for commands.
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
      const workerFibers = yield* Ref.make<ReadonlyArray<Fiber.Fiber<void, unknown>>>([]);

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
            // A job that is interrupted during shutdown still resolves its
            // keep-alive promise; otherwise the host would hold the invocation
            // open until its own deadline.
            Effect.ensuring(Deferred.succeed(job.done, undefined)),
          );
        }
      });

      // `Effect.cached` makes the first accepted job start the workers exactly
      // once. Detached fibers are not interrupted when the enqueueing request
      // (or scope close) begins; the finalizer owns their bounded drain.
      const startWorkers = yield* Effect.cached(
        Effect.gen(function* () {
          const fibers = yield* Effect.forEach(
            Array.from({ length: concurrency }, () => worker()),
            (effect) => Effect.forkDetach(effect, { startImmediately: true }),
          );

          yield* Ref.set(workerFibers, fibers);

          return fibers;
        }),
      );

      const workerCount = Effect.map(Ref.get(workerFibers), (fibers) => fibers.length);

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* Queue.end(queue);
          const workers = yield* Ref.get(workerFibers);

          if (workers.length === 0) return;

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
            const job: DeliveryJob = { name, effect, done: yield* Deferred.make<void>() };
            const accepted = yield* Queue.offer(queue, job);

            if (accepted) {
              yield* Metric.update(enqueued, 1);
              yield* startWorkers;

              const keepAlive = yield* Effect.serviceOption(BackgroundDeliveryKeepAlive);

              if (Option.isSome(keepAlive))
                keepAlive.value.track(Effect.runPromise(Deferred.await(job.done)));
            } else {
              yield* Metric.update(dropped, 1);
              yield* Effect.logWarning(`Background delivery queue is full; dropped ${name}`);
            }

            return accepted;
          }),
        workerCount,
      });
    }),
  );

const normalizedOptions = (options: BackgroundDeliveryOptions) => ({
  capacity: positive(options.capacity, 100),
  concurrency: positive(options.concurrency, 4),
  maxAttempts: positive(options.maxAttempts, 3),
  retryDelayMs: positive(options.retryDelayMs, 100),
  shutdownTimeoutMs: positive(options.shutdownTimeoutMs, 15_000),
});

let sharedScope = Scope.makeUnsafe();
const sharedDeliveries = new Map<string, Promise<BackgroundDeliveryService>>();

/**
 * One delivery queue per isolate/process for a given configuration.
 *
 * The hosted Worker rebuilds its request service graph but must not create a
 * fresh four-worker queue for every request. This layer builds the queue once
 * in a module scope and returns the same service for every later graph with
 * the same options. Jobs still start workers lazily, and request keep-alives
 * are resolved when each job settles.
 */
export const SharedBackgroundDeliveryLive = (
  options: BackgroundDeliveryOptions = {},
): Layer.Layer<BackgroundDelivery> =>
  Layer.effect(
    BackgroundDelivery,
    Effect.promise(() => {
      const key = JSON.stringify(normalizedOptions(options));
      let pending = sharedDeliveries.get(key);

      if (!pending) {
        pending = Effect.runPromise(
          Layer.buildWithScope(BackgroundDeliveryLive(options), sharedScope).pipe(
            Effect.map((context) => Context.get(context, BackgroundDelivery)),
          ),
        );
        sharedDeliveries.set(key, pending);
      }

      return pending;
    }),
  );

/** Test hook: dispose the module-scoped queue and forget its cached service. */
export const resetSharedBackgroundDelivery = async (): Promise<void> => {
  sharedDeliveries.clear();
  const scope = sharedScope;

  sharedScope = Scope.makeUnsafe();
  await Effect.runPromise(Scope.close(scope, Exit.void));
};
