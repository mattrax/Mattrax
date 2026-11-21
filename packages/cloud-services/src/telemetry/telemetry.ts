/**
 * Request-scoped tracing and the metric registry for the API Worker.
 *
 * The tracer is installed as Effect's `Tracer` service, so a service can add
 * a span with `Effect.withSpan("name")` and every SQL statement is recorded
 * automatically. The web handler owns the root span because it runs outside
 * Effect: it parses `traceparent`, puts the root span in the request context,
 * then closes the span and hands the collected child spans to the request log.
 *
 * Disabled deployments get `Tracer.nativeTracer`: Effect still runs, nothing
 * is recorded, and `beginRequest` returns `undefined` so the handler does no
 * extra work beyond one env check.
 */

import { Context, Exit, Option, Predicate, Tracer } from "effect";
import {
  DB_DURATION_BUCKETS,
  HTTP_DURATION_BUCKETS,
  MetricRegistry,
  SPAN_DURATION_BUCKETS,
} from "./metrics.js";
import type { Counter, Histogram } from "./metrics.js";
import { mdmEventFor, statusClass } from "./route.js";
import type { MdmEvent, RouteClass, StatusClass } from "./route.js";
import { currentTimeNanos, noopTracer, recordingTracer } from "./tracer.js";
import type { FinishedSpan, SpanStatus } from "./tracer.js";
import { parseTraceparent } from "./traceContext.js";

const DEFAULT_MAX_TRACES = 128;

const DEFAULT_MAX_SPANS_PER_TRACE = 96;

const DEFAULT_MAX_SUMMARISED_SPANS = 16;

export type TelemetryOptions = {
  /** `false` installs a no-op tracer and records nothing. */
  readonly enabled?: boolean;
  /** Traces held in memory at once; a safety net, requests finish immediately. */
  readonly maxTraces?: number;
  readonly maxSpansPerTrace?: number;
  readonly maxSummarisedSpans?: number;
};

/** The root span of one HTTP request, owned by the web handler. */
export type RequestTrace = {
  readonly traceId: string;
  readonly spanId: string;
  readonly method: string;
  readonly route: RouteClass;
  readonly span: Tracer.Span;
};

export type FinishRequestInput = {
  readonly status: number;
  readonly durationMs: number;
  readonly errorTag?: string;
};

/** A child span as it appears in a request log line. */
export type SpanSummary = {
  readonly name: string;
  readonly durationMs: number;
  readonly status: SpanStatus;
};

type Metrics = {
  readonly httpRequests: Counter;
  readonly httpDuration: Histogram;
  readonly mdmCheckin: Counter;
  readonly mdmEnrollment: Counter;
  readonly spans: Counter;
  readonly spanDuration: Histogram;
  readonly dbQueries: Counter;
  readonly dbDuration: Histogram;
};

export class Telemetry {
  readonly enabled: boolean;
  readonly registry: MetricRegistry;
  readonly tracer: Tracer.Tracer;

  private readonly maxTraces: number;
  private readonly maxSpansPerTrace: number;
  private readonly maxSummarisedSpans: number;
  private readonly traces = new Map<string, FinishedSpan[]>();
  private readonly metrics: Metrics;

  constructor(options: TelemetryOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.maxTraces = options.maxTraces ?? DEFAULT_MAX_TRACES;
    this.maxSpansPerTrace = options.maxSpansPerTrace ?? DEFAULT_MAX_SPANS_PER_TRACE;
    this.maxSummarisedSpans = options.maxSummarisedSpans ?? DEFAULT_MAX_SUMMARISED_SPANS;
    this.registry = new MetricRegistry();

    this.metrics = {
      httpRequests: this.registry.counter("mattrax_http_requests_total", {
        help: "HTTP requests handled by the API Worker, by route class and status class",
        labels: ["route", "method", "status_class"],
      }),
      httpDuration: this.registry.histogram("mattrax_http_request_duration_seconds", {
        help: "End-to-end API Worker request duration in seconds",
        labels: ["route", "method", "status_class"],
        buckets: HTTP_DURATION_BUCKETS,
      }),
      mdmCheckin: this.registry.counter("mattrax_mdm_checkin_total", {
        help: "MDM device check-in outcomes, by platform",
        labels: ["platform", "outcome"],
      }),
      mdmEnrollment: this.registry.counter("mattrax_mdm_enrollment_total", {
        help: "MDM enrollment outcomes, by platform",
        labels: ["platform", "outcome"],
      }),
      spans: this.registry.counter("mattrax_spans_total", {
        help: "Recorded spans, by operation, kind and status",
        labels: ["operation", "kind", "status"],
      }),
      spanDuration: this.registry.histogram("mattrax_span_duration_seconds", {
        help: "Span duration in seconds, by operation, kind and status",
        labels: ["operation", "kind", "status"],
        buckets: SPAN_DURATION_BUCKETS,
      }),
      dbQueries: this.registry.counter("mattrax_db_queries_total", {
        help: "SQL statements executed, by client operation and status",
        labels: ["operation", "status"],
      }),
      dbDuration: this.registry.histogram("mattrax_db_query_duration_seconds", {
        help: "SQL statement duration in seconds, by client operation and status",
        labels: ["operation", "status"],
        buckets: DB_DURATION_BUCKETS,
      }),
    };

    this.tracer = this.enabled ? recordingTracer((span) => this.recordSpan(span)) : noopTracer;
  }

  /**
   * Open the root span for a request.
   *
   * A valid inbound `traceparent` is continued; anything else starts a new
   * trace. Returns `undefined` when telemetry is off.
   */
  beginRequest(input: {
    readonly method: string;
    readonly route: RouteClass;
    readonly traceparent?: string | null;
  }): RequestTrace | undefined {
    if (!this.enabled) return undefined;

    const parent = parseTraceparent(input.traceparent);

    const span = this.tracer.span({
      name: "http.request",
      parent: parent
        ? Option.some(
            Tracer.externalSpan({
              traceId: parent.traceId,
              spanId: parent.spanId,
              sampled: parent.sampled,
            }),
          )
        : Option.none(),
      annotations: Context.empty(),
      links: [],
      startTime: currentTimeNanos(),
      kind: "server",
      sampled: parent?.sampled ?? true,
      root: parent === undefined,
    });

    const traceId = span.traceId;

    // Registered before the handler runs, so child spans always have a bucket
    // and a trace that never finishes cannot create one by itself.
    this.traces.set(traceId, []);

    // The store is bounded; evict the oldest trace rather than growing.
    while (this.traces.size > this.maxTraces) {
      const oldest = this.traces.keys().next();

      if (oldest.done) break;

      this.traces.delete(oldest.value);
    }

    return {
      traceId,
      spanId: span.spanId,
      method: input.method,
      route: input.route,
      span,
    };
  }

  /**
   * Close the root span, record the request metrics and return the child spans
   * that finished while it was open.
   */
  finishRequest(trace: RequestTrace, input: FinishRequestInput): ReadonlyArray<FinishedSpan> {
    // A handler that is retried or re-entered must not count the request twice.
    if (Predicate.isTagged(trace.span.status, "Ended")) return [];

    const statusClassValue = statusClass(input.status);

    trace.span.attribute("http.request.method", trace.method);
    trace.span.attribute("http.response.status_code", input.status);
    trace.span.attribute("mattrax.route", trace.route);

    if (input.errorTag) trace.span.attribute("mattrax.error_tag", input.errorTag);

    trace.span.end(
      currentTimeNanos(),
      input.status >= 500 ? Exit.fail(input.errorTag ?? "http_error") : Exit.succeed(undefined),
    );

    const labels = {
      route: trace.route,
      method: trace.method,
      status_class: statusClassValue satisfies StatusClass,
    };

    this.metrics.httpRequests.increment(labels);
    this.metrics.httpDuration.observe(input.durationMs / 1_000, labels);

    const mdm = mdmEventFor(trace.route, input.status);

    if (mdm) this.recordMdm(mdm);

    return this.finishTrace(trace.traceId).filter((span) => span.spanId !== trace.spanId);
  }

  /** Collect and forget the spans recorded for a trace. */
  finishTrace(traceId: string): ReadonlyArray<FinishedSpan> {
    const spans = this.traces.get(traceId);

    if (!spans) return [];

    this.traces.delete(traceId);

    return spans;
  }

  recordMdm(event: MdmEvent): void {
    const labels = { platform: event.platform, outcome: event.outcome };

    if (event.kind === "checkin") this.metrics.mdmCheckin.increment(labels);
    else this.metrics.mdmEnrollment.increment(labels);
  }

  /** Prometheus text exposition; aggregate only, no per-tenant series. */
  renderMetrics(): string {
    return this.registry.render();
  }

  /**
   * At most `limit` slowest child spans, for the request log line. Sorting by
   * duration keeps a request that issued a hundred queries readable.
   */
  summariseSpans(spans: ReadonlyArray<FinishedSpan>, limit = this.maxSummarisedSpans) {
    const summaries = [...spans]
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, Math.max(0, limit))
      .map((span) => ({
        name: span.operation,
        // One decimal is enough to compare a sub-millisecond query.
        durationMs: Math.round(span.durationMs * 10) / 10,
        status: span.status,
      }));

    return { spans: summaries, spanCount: spans.length };
  }

  private recordSpan(span: FinishedSpan): void {
    const labels = { operation: span.operation, kind: span.kind, status: span.status };

    this.metrics.spans.increment(labels);
    this.metrics.spanDuration.observe(span.durationMs / 1_000, labels);

    if (span.sqlMethod) {
      const queryLabels = { operation: span.sqlMethod, status: span.status };

      this.metrics.dbQueries.increment(queryLabels);
      this.metrics.dbDuration.observe(span.durationMs / 1_000, queryLabels);
    }

    const trace = this.traces.get(span.traceId);

    // Spans outside a request (cron, one-off work) still count in the metrics
    // but are not buffered for a log line nobody will read.
    if (!trace || trace.length >= this.maxSpansPerTrace) return;

    trace.push(span);
  }
}

export const makeTelemetry = (options: TelemetryOptions = {}): Telemetry => new Telemetry(options);
