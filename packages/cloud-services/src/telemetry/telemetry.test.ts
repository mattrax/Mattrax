import { describe, expect, it } from "vitest";
import { Context, Effect, Exit, Layer, Option, Tracer } from "effect";
import { Telemetry } from "./telemetry.js";
import type { RequestTrace } from "./telemetry.js";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

const PARENT_SPAN_ID = "00f067aa0ba902b7";

const runTraced = (telemetry: Telemetry, trace: RequestTrace, name: string) =>
  Effect.runPromise(
    Effect.succeed(name).pipe(
      Effect.withSpan(name),
      Effect.provideService(Tracer.Tracer, telemetry.tracer),
      Effect.provideService(Tracer.ParentSpan, trace.span),
    ),
  );

describe("request spans", () => {
  it("continues an inbound traceparent and records child spans", async () => {
    const telemetry = new Telemetry();

    const trace = telemetry.beginRequest({
      method: "PUT",
      route: "mdm.apple.checkin",
      traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
    })!;

    expect(trace.traceId).toBe(TRACE_ID);

    await runTraced(telemetry, trace, "mdm.apple.backend.checkin");

    const children = telemetry.finishRequest(trace, { status: 200, durationMs: 12.5 });

    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      operation: "mdm.apple.backend.checkin",
      traceId: TRACE_ID,
      parentSpanId: trace.spanId,
      kind: "internal",
      status: "ok",
    });
    expect(children[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("starts a new trace when there is no header", () => {
    const telemetry = new Telemetry();
    const trace = telemetry.beginRequest({ method: "GET", route: "api" })!;

    expect(trace.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(trace.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(trace.traceId).not.toBe(TRACE_ID);
  });

  it("starts a new trace when the header is invalid", () => {
    const telemetry = new Telemetry();

    const trace = telemetry.beginRequest({
      method: "GET",
      route: "api",
      traceparent: "not-a-traceparent",
    })!;

    expect(trace.traceId).not.toBe(TRACE_ID);
  });

  it("marks a failed child span as an error", async () => {
    const telemetry = new Telemetry();
    const trace = telemetry.beginRequest({ method: "GET", route: "api" })!;

    await Effect.runPromise(
      Effect.fail("boom").pipe(
        Effect.withSpan("db.query"),
        Effect.provideService(Tracer.Tracer, telemetry.tracer),
        Effect.provideService(Tracer.ParentSpan, trace.span),
        Effect.exit,
      ),
    );

    const children = telemetry.finishRequest(trace, { status: 500, durationMs: 1 });

    expect(children[0]).toMatchObject({ operation: "db.query", status: "error" });
  });

  it("records request, MDM and span metrics", async () => {
    const telemetry = new Telemetry();
    const trace = telemetry.beginRequest({ method: "PUT", route: "mdm.apple.checkin" })!;

    await runTraced(telemetry, trace, "mdm.apple.backend.checkin");
    telemetry.finishRequest(trace, { status: 410, durationMs: 25 });

    const output = telemetry.renderMetrics();

    expect(output).toContain(
      'mattrax_http_requests_total{route="mdm.apple.checkin",method="PUT",status_class="4xx"} 1',
    );
    expect(output).toContain(
      'mattrax_http_request_duration_seconds_count{route="mdm.apple.checkin",method="PUT",status_class="4xx"} 1',
    );
    expect(output).toContain('mattrax_mdm_checkin_total{platform="apple",outcome="unenrolled"} 1');
    expect(output).toContain(
      'mattrax_spans_total{operation="http.request",kind="server",status="ok"} 1',
    );
    expect(output).toContain(
      'mattrax_spans_total{operation="mdm.apple.backend.checkin",kind="internal",status="ok"} 1',
    );
  });

  it("does not double count a request that is finished twice", () => {
    const telemetry = new Telemetry();
    const trace = telemetry.beginRequest({ method: "GET", route: "api" })!;

    telemetry.finishRequest(trace, { status: 200, durationMs: 1 });
    telemetry.finishRequest(trace, { status: 200, durationMs: 1 });

    expect(telemetry.renderMetrics()).toContain(
      'mattrax_http_requests_total{route="api",method="GET",status_class="2xx"} 1',
    );
  });
});

describe("database spans", () => {
  it("splits SQL statements into their own histogram by client operation", () => {
    const telemetry = new Telemetry();
    const trace = telemetry.beginRequest({ method: "GET", route: "api" })!;

    // A SQL span carries `effect.sql.method`; the query text must not be used.
    const span = telemetry.tracer.span({
      name: "mysql",
      parent: Option.some(
        Tracer.externalSpan({ traceId: trace.traceId, spanId: trace.spanId, sampled: true }),
      ),
      annotations: Context.empty(),
      links: [],
      startTime: 0n,
      kind: "client",
      sampled: true,
      root: false,
    });

    span.attribute("effect.sql.method", "execute");
    span.attribute("db.query.text", "select * from device where serial = 'secret'");
    span.end(2_000_000n, Exit.succeed(undefined));

    const output = telemetry.renderMetrics();

    expect(output).toContain('mattrax_db_queries_total{operation="execute",status="ok"} 1');
    expect(output).toContain(
      'mattrax_db_query_duration_seconds_count{operation="execute",status="ok"} 1',
    );
    expect(output).not.toContain("secret");
  });
});

describe("Effect layer wiring", () => {
  it("records spans from an Effect layer without passing a tracer around", async () => {
    const telemetry = new Telemetry();

    // Mirrors `app.ts`: provideMerge, so the tracer is part of the layer's
    // output (the request context), not just its construction context.
    const layer = Layer.empty.pipe(
      Layer.provideMerge(Layer.succeed(Tracer.Tracer, telemetry.tracer)),
    );

    // The span must be recorded by our tracer, which is only true when the
    // tracer survived into the layer's output.
    await Effect.runPromise(
      Effect.succeed("ok").pipe(Effect.withSpan("service.work"), Effect.provide(layer)),
    );

    expect(telemetry.renderMetrics()).toContain(
      'mattrax_spans_total{operation="service.work",kind="internal",status="ok"} 1',
    );
  });
});

describe("disabled telemetry", () => {
  it("does no per-request work", async () => {
    const telemetry = new Telemetry({ enabled: false });

    expect(telemetry.beginRequest({ method: "GET", route: "api" })).toBeUndefined();
    expect(telemetry.finishTrace("anything")).toEqual([]);

    // The default tracer still runs Effect normally; nothing is recorded.
    await Effect.runPromise(
      Effect.succeed("ok").pipe(
        Effect.withSpan("child"),
        Effect.provideService(Tracer.Tracer, telemetry.tracer),
      ),
    );

    const output = telemetry.renderMetrics();

    expect(output).not.toContain("mattrax_http_requests_total{");
    expect(output).not.toContain("mattrax_spans_total{");
  });
});

describe("bounded trace buffer", () => {
  it("drops the oldest trace when the buffer is full", async () => {
    const telemetry = new Telemetry({ maxTraces: 2 });
    const first = telemetry.beginRequest({ method: "GET", route: "api" })!;

    await runTraced(telemetry, first, "first.child");

    const second = telemetry.beginRequest({ method: "GET", route: "api" })!;
    const third = telemetry.beginRequest({ method: "GET", route: "api" })!;

    await runTraced(telemetry, third, "third.child");

    // The first trace was evicted, so its buffered span is gone.
    expect(telemetry.finishTrace(first.traceId)).toEqual([]);
    expect(telemetry.finishTrace(third.traceId)).toHaveLength(1);
    expect(second.traceId).not.toBe(first.traceId);
  });

  it("stops buffering past the per-trace cap but still counts the span", async () => {
    const telemetry = new Telemetry({ maxSpansPerTrace: 1 });
    const trace = telemetry.beginRequest({ method: "GET", route: "api" })!;

    await runTraced(telemetry, trace, "one");
    await runTraced(telemetry, trace, "two");

    expect(telemetry.finishTrace(trace.traceId)).toHaveLength(1);
    expect(telemetry.renderMetrics()).toContain(
      'mattrax_spans_total{operation="two",kind="internal",status="ok"} 1',
    );
  });
});

describe("span summaries", () => {
  it("keeps the slowest spans and rounds the duration", () => {
    const telemetry = new Telemetry();
    const trace = telemetry.beginRequest({ method: "GET", route: "api" })!;

    const summary = telemetry.summariseSpans(
      [
        {
          operation: "fast",
          traceId: trace.traceId,
          spanId: "a",
          kind: "internal",
          status: "ok",
          durationMs: 0.04,
        },
        {
          operation: "slow",
          traceId: trace.traceId,
          spanId: "b",
          kind: "internal",
          status: "error",
          durationMs: 12.34,
        },
      ],
      1,
    );

    expect(summary.spanCount).toBe(2);
    expect(summary.spans).toEqual([{ name: "slow", durationMs: 12.3, status: "error" }]);
  });

  it("never returns more summaries than the limit", () => {
    const telemetry = new Telemetry();
    const trace = telemetry.beginRequest({ method: "GET", route: "api" })!;

    const spans = Array.from({ length: 40 }, (_, index) => ({
      operation: `span.${index}`,
      traceId: trace.traceId,
      spanId: String(index),
      kind: "internal" as const,
      status: "ok" as const,
      durationMs: index,
    }));

    expect(telemetry.summariseSpans(spans).spans).toHaveLength(16);
  });
});
