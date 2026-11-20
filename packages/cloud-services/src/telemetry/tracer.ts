/**
 * An Effect `Tracer` that records each span's operation and duration.
 *
 * Effect already creates spans for anything wrapped in `Effect.withSpan` and
 * for every SQL statement (`@effect/sql` wraps queries in a `useSpan`), so
 * installing this tracer instruments the service code without changing it.
 * There is no OpenTelemetry SDK: a span is a name, ids, a duration and a
 * status, which is all the log line and the histogram need.
 */

import { Exit, Option, Predicate, Schema, Tracer } from "effect";

export type SpanStatus = "ok" | "error";

/** One completed span, detached from Effect's context. */
export type FinishedSpan = {
  /** Sanitised operation name; safe to use as a metric label. */
  readonly operation: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly kind: Tracer.SpanKind;
  readonly status: SpanStatus;
  readonly durationMs: number;
  /**
   * Set on `@effect/sql` spans (`effect.sql.method`). The query text and
   * parameters are never copied: they can contain tenant data.
   */
  readonly sqlMethod?: string;
};

const MAX_OPERATION_LENGTH = 64;

const OPERATION_ALLOWED = /[^A-Za-z0-9_.:/-]/g;

/**
 * Normalise a span name into a bounded, label-safe operation name.
 *
 * `Effect.withSpan` names are static in this codebase, but a name built from
 * data (a user id, a path) must not become a metric label.
 */
export const spanOperation = (name: string): string => {
  const sanitised = name.replaceAll(OPERATION_ALLOWED, "_").slice(0, MAX_OPERATION_LENGTH);

  return sanitised.length > 0 ? sanitised : "unknown";
};

/** `effect.sql.method` is a bounded set of client operations. */
const SQL_METHOD_ATTRIBUTE = "effect.sql.method";

type NativeSpanOptions = ConstructorParameters<typeof Tracer.NativeSpan>[0];

class RecordingSpan extends Tracer.NativeSpan {
  constructor(
    options: NativeSpanOptions,
    private readonly onEnd: (span: FinishedSpan) => void,
  ) {
    super(options);
  }

  override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    // Effect guarantees `end` is idempotent on `NativeSpan`; check before
    // reading so a double end cannot record a span twice.
    if (Predicate.isTagged(this.status, "Ended")) return;

    super.end(endTime, exit);

    const { startTime } = this.status;
    const elapsedNanos = endTime > startTime ? endTime - startTime : 0n;
    const sqlMethod = this.attributes.get(SQL_METHOD_ATTRIBUTE);

    this.onEnd({
      operation: spanOperation(this.name),
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: Option.getOrUndefined(this.parent)?.spanId,
      kind: this.kind,
      status: Exit.isFailure(exit) ? "error" : "ok",
      durationMs: Number(elapsedNanos) / 1_000_000,
      sqlMethod: Schema.is(Schema.String)(sqlMethod) ? sqlMethod : undefined,
    });
  }
}

export const recordingTracer = (onEnd: (span: FinishedSpan) => void): Tracer.Tracer =>
  Tracer.make({
    span: (options) => new RecordingSpan(options, onEnd),
  });

/**
 * The value a disabled deployment installs. The default tracer already
 * allocates spans for Effect's own use; it exports them nowhere, so passing it
 * through is the cheapest possible no-op.
 */
export const noopTracer = Tracer.nativeTracer;

/** Freeze the current time the same way Effect's clock does. */
export const currentTimeNanos = (): bigint => {
  const clock = globalThis.performance;

  return clock === undefined
    ? BigInt(Date.now()) * 1_000_000n
    : BigInt(Math.round(clock.now() * 1_000_000));
};
