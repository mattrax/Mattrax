import { describe, expect, it } from "vitest";
import { MetricRegistry } from "./metrics.js";

describe("counters", () => {
  it("renders HELP, TYPE and the accumulated value", () => {
    const registry = new MetricRegistry();

    const counter = registry.counter("mattrax_test_total", {
      help: "A test counter",
      labels: ["route"],
    });

    counter.increment({ route: "api" });
    counter.increment({ route: "api" }, 2);

    expect(registry.render()).toContain("# HELP mattrax_test_total A test counter");
    expect(registry.render()).toContain("# TYPE mattrax_test_total counter");
    expect(registry.render()).toContain('mattrax_test_total{route="api"} 3');
  });

  it("emits a header even before the first observation", () => {
    const registry = new MetricRegistry();

    registry.counter("mattrax_empty_total", { help: "Empty" });

    const output = registry.render();

    expect(output).toContain("# TYPE mattrax_empty_total counter");
    expect(output).not.toMatch(/^mattrax_empty_total /m);
  });

  it("ignores non-finite increments", () => {
    const registry = new MetricRegistry();
    const counter = registry.counter("mattrax_test_total", { help: "x" });

    counter.increment({}, Number.NaN);
    counter.increment({}, Number.POSITIVE_INFINITY);

    expect(registry.render()).not.toMatch(/^mattrax_test_total /m);
  });
});

describe("histograms", () => {
  it("renders cumulative buckets, sum and count", () => {
    const registry = new MetricRegistry();

    const histogram = registry.histogram("mattrax_duration_seconds", {
      help: "Duration",
      buckets: [0.1, 1],
    });

    histogram.observe(0.05);
    histogram.observe(0.5);
    histogram.observe(2);

    const output = registry.render();

    expect(output).toContain("# TYPE mattrax_duration_seconds histogram");
    expect(output).toContain('mattrax_duration_seconds_bucket{le="0.1"} 1');
    expect(output).toContain('mattrax_duration_seconds_bucket{le="1"} 2');
    expect(output).toContain('mattrax_duration_seconds_bucket{le="+Inf"} 3');
    expect(output).toContain("mattrax_duration_seconds_count 3");
    expect(output).toContain("mattrax_duration_seconds_sum 2.55");
  });

  it("keeps the declared label order and adds le last", () => {
    const registry = new MetricRegistry();

    const histogram = registry.histogram("mattrax_duration_seconds", {
      help: "Duration",
      labels: ["route", "status_class"],
      buckets: [1],
    });

    histogram.observe(0.5, { status_class: "2xx", route: "api" });

    expect(registry.render()).toContain(
      'mattrax_duration_seconds_bucket{route="api",status_class="2xx",le="1"} 1',
    );
  });

  it("ignores negative and non-finite observations", () => {
    const registry = new MetricRegistry();

    const histogram = registry.histogram("mattrax_duration_seconds", {
      help: "Duration",
      buckets: [1],
    });

    histogram.observe(-1);
    histogram.observe(Number.NaN);

    expect(registry.render()).not.toMatch(/^mattrax_duration_seconds_count /m);
  });

  it("sorts and de-duplicates buckets", () => {
    const registry = new MetricRegistry();

    const histogram = registry.histogram("mattrax_duration_seconds", {
      help: "Duration",
      buckets: [1, 0.1, 1],
    });

    expect(histogram.bucketBounds).toEqual([0.1, 1]);
  });

  it("requires at least one positive bucket", () => {
    const registry = new MetricRegistry();

    expect(() =>
      registry.histogram("mattrax_duration_seconds", { help: "x", buckets: [] }),
    ).toThrow();
    expect(() =>
      registry.histogram("mattrax_duration_seconds", { help: "x", buckets: [0] }),
    ).toThrow();
  });
});

describe("label bounding", () => {
  it("escapes quotes, backslashes and newlines", () => {
    const registry = new MetricRegistry();
    const counter = registry.counter("mattrax_test_total", { help: "x", labels: ["value"] });

    counter.increment({ value: 'a"b\\c\nd' });

    expect(registry.render()).toContain(String.raw`mattrax_test_total{value="a\"b\\c\nd"} 1`);
  });

  it("truncates long values so two ids cannot mint separate series", () => {
    const registry = new MetricRegistry({ maxSeriesPerMetric: 10 });
    const counter = registry.counter("mattrax_test_total", { help: "x", labels: ["device"] });
    const prefix = "a".repeat(64);

    counter.increment({ device: `${prefix}-one` });
    counter.increment({ device: `${prefix}-two` });

    expect(registry.render()).toContain('mattrax_test_total{device="' + prefix + '"} 2');
  });

  it("drops series past the cap and reports it", () => {
    const registry = new MetricRegistry({ maxSeriesPerMetric: 2 });
    const counter = registry.counter("mattrax_test_total", { help: "x", labels: ["route"] });

    counter.increment({ route: "a" });
    counter.increment({ route: "b" });
    counter.increment({ route: "c" });
    counter.increment({ route: "d" });

    const output = registry.render();

    expect(output).toContain('mattrax_test_total{route="a"} 1');
    expect(output).toContain('mattrax_test_total{route="b"} 1');
    expect(output).not.toContain('route="c"');
    expect(output).toContain(
      'mattrax_telemetry_series_dropped_total{metric="mattrax_test_total"} 2',
    );
  });

  it("defaults a missing label to an empty string", () => {
    const registry = new MetricRegistry();
    const counter = registry.counter("mattrax_test_total", { help: "x", labels: ["route"] });

    counter.increment({});

    expect(registry.render()).toContain('mattrax_test_total{route=""} 1');
  });
});

describe("registration", () => {
  it("rejects invalid names, labels and duplicates", () => {
    const registry = new MetricRegistry();

    expect(() => registry.counter("bad name", { help: "x" })).toThrow();
    expect(() =>
      registry.counter("mattrax_test_total", { help: "x", labels: ["bad-label"] }),
    ).toThrow();
    expect(() =>
      registry.counter("mattrax_test_total", { help: "x", labels: ["a", "a"] }),
    ).toThrow();

    registry.counter("mattrax_test_total", { help: "x" });

    expect(() => registry.counter("mattrax_test_total", { help: "x" })).toThrow();
    expect(() => registry.histogram("mattrax_test_total", { help: "x", buckets: [1] })).toThrow();
  });
});
