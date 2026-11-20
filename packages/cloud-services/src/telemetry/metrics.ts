/**
 * A tiny Prometheus text-format registry.
 *
 * This is deliberately not a general metrics client: it has no exporter, no
 * background push and no timers. A Worker isolate keeps the counters in memory
 * and a scrape renders them. The two things that matter here are:
 *
 * 1. **Bounded cardinality.** Nothing ever observes a tenant id, device id,
 *    email, path or query string. Label values are truncated and each metric
 *    caps its own series count, so a caller cannot mint unbounded series.
 * 2. **Stable output.** `HELP`/`TYPE` lines are emitted for every registered
 *    metric even before its first observation, so a dashboard does not break
 *    when a counter is still zero.
 */

export type MetricLabels = Readonly<Record<string, string | number | boolean>>;

const NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

const LABEL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Long enough for a status or operation name, short enough to bound a series. */
const MAX_LABEL_VALUE_LENGTH = 64;

const DEFAULT_MAX_SERIES = 200;

/** Prometheus' own default duration buckets, in seconds. */
export const HTTP_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

export const SPAN_DURATION_BUCKETS = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

export const DB_DURATION_BUCKETS = [
  0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
] as const;

export type MetricOptions = {
  readonly help: string;
  readonly labels?: ReadonlyArray<string>;
  /** Series cap for this metric; defaults to the registry's cap. */
  readonly maxSeries?: number;
};

type Series = {
  readonly labels: ReadonlyArray<string>;
  value: number;
  /** Histogram only. */
  buckets?: Array<number>;
  sum?: number;
  count?: number;
};

const boundLabelValue = (value: string | number | boolean | undefined): string => {
  const text = value === undefined ? "" : String(value);

  return text.length > MAX_LABEL_VALUE_LENGTH ? text.slice(0, MAX_LABEL_VALUE_LENGTH) : text;
};

const escapeLabelValue = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return "0";

  // Trim binary floating-point noise (0.30000000000000004) without turning a
  // small duration into "1e-7", which some dashboards handle badly.
  const rounded = Number(value.toFixed(9));

  return Number.isFinite(rounded) ? String(rounded) : "0";
};

const renderLabels = (
  names: ReadonlyArray<string>,
  values: ReadonlyArray<string>,
  extra?: readonly [string, string],
): string => {
  const entries = names.map((name, index) => `${name}="${escapeLabelValue(values[index] ?? "")}"`);

  if (extra) entries.push(`${extra[0]}="${escapeLabelValue(extra[1])}"`);

  return entries.length === 0 ? "" : `{${entries.join(",")}}`;
};

const assertName = (name: string): void => {
  if (!NAME_PATTERN.test(name))
    throw new Error(`Metric name "${name}" is not a valid Prometheus name`);
};

const assertLabelNames = (labels: ReadonlyArray<string>): void => {
  for (const label of labels)
    if (!LABEL_NAME_PATTERN.test(label))
      throw new Error(`Metric label "${label}" is not a valid Prometheus label`);

  if (new Set(labels).size !== labels.length)
    throw new Error(`Metric labels "${labels.join(",")}" are not unique`);
};

abstract class Metric {
  readonly name: string;
  readonly help: string;
  readonly labelNames: ReadonlyArray<string>;
  protected readonly maxSeries: number;
  protected readonly series = new Map<string, Series>();
  private dropped = 0;

  constructor(name: string, options: MetricOptions, defaultMaxSeries: number) {
    assertName(name);

    this.name = name;
    this.help = options.help;
    this.labelNames = options.labels ?? [];
    this.maxSeries = options.maxSeries ?? defaultMaxSeries;
    assertLabelNames(this.labelNames);
  }

  /** Observations dropped because this metric reached its series cap. */
  get droppedSeries(): number {
    return this.dropped;
  }

  abstract readonly type: "counter" | "histogram";

  protected seriesFor(labels: MetricLabels): Series | undefined {
    const values = this.labelNames.map((label) => boundLabelValue(labels[label]));
    const key = values.join("\u0000");
    const existing = this.series.get(key);

    if (existing) return existing;

    // Silently dropping over-cap series is the point: it keeps a hostile or
    // buggy caller from growing the registry without bound, and the drop is
    // itself counted by the registry.
    if (this.series.size >= this.maxSeries) {
      this.dropped += 1;

      return undefined;
    }

    const created = this.createSeries(values);

    this.series.set(key, created);

    return created;
  }

  protected abstract createSeries(labels: ReadonlyArray<string>): Series;

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} ${this.type}`];

    // Sorting keeps a scrape diff-able; Prometheus does not require an order.
    const series = [...this.series.values()].sort((a, b) =>
      a.labels.join("\u0000").localeCompare(b.labels.join("\u0000")),
    );

    for (const entry of series) lines.push(...this.renderSeries(entry));

    return lines.join("\n");
  }

  protected abstract renderSeries(series: Series): ReadonlyArray<string>;
}

export class Counter extends Metric {
  readonly type = "counter" as const;

  increment(labels: MetricLabels = {}, amount = 1): void {
    // Prometheus counters only ever go up.
    if (!Number.isFinite(amount) || amount <= 0) return;

    const series = this.seriesFor(labels);

    if (series) series.value += amount;
  }

  protected createSeries(labels: ReadonlyArray<string>): Series {
    return { labels, value: 0 };
  }

  protected renderSeries(series: Series): ReadonlyArray<string> {
    return [
      `${this.name}${renderLabels(this.labelNames, series.labels)} ${formatNumber(series.value)}`,
    ];
  }
}

export class Histogram extends Metric {
  readonly type = "histogram" as const;

  /** Ascending, finite upper bounds in the metric's unit. */
  readonly bucketBounds: ReadonlyArray<number>;

  constructor(
    name: string,
    options: MetricOptions & { readonly buckets?: ReadonlyArray<number> },
    defaultMaxSeries: number,
  ) {
    super(name, options, defaultMaxSeries);

    const bounds = options.buckets === undefined ? [] : [...options.buckets];

    if (bounds.length === 0) throw new Error(`Histogram "${name}" needs at least one bucket`);

    if (!bounds.every((bound) => Number.isFinite(bound) && bound > 0))
      throw new Error(`Histogram "${name}" buckets must be positive finite numbers`);

    this.bucketBounds = [...new Set(bounds)].sort((a, b) => a - b);
  }

  /** Record one observation. Negative and non-finite values are ignored. */
  observe(value: number, labels: MetricLabels = {}): void {
    if (!Number.isFinite(value) || value < 0) return;

    const series = this.seriesFor(labels);

    if (!series) return;

    const buckets = series.buckets;

    if (!buckets) return;

    // Non-cumulative counts per bucket; `renderSeries` accumulates them, so
    // one observation must only increment the first bucket it fits.
    for (let index = 0; index < this.bucketBounds.length; index++)
      if (value <= this.bucketBounds[index]!) {
        buckets[index]! += 1;
        break;
      }

    series.count = (series.count ?? 0) + 1;
    series.sum = (series.sum ?? 0) + value;
  }

  protected createSeries(labels: ReadonlyArray<string>): Series {
    return {
      labels,
      value: 0,
      buckets: this.bucketBounds.map(() => 0),
      sum: 0,
      count: 0,
    };
  }

  protected renderSeries(series: Series): ReadonlyArray<string> {
    const lines: Array<string> = [];

    // Buckets are cumulative, matching the Prometheus exposition format.
    let cumulative = 0;

    for (let index = 0; index < this.bucketBounds.length; index++) {
      cumulative += series.buckets?.[index] ?? 0;
      const bound = formatNumber(this.bucketBounds[index]!);

      lines.push(
        `${this.name}_bucket${renderLabels(this.labelNames, series.labels, ["le", bound])} ${cumulative}`,
      );
    }

    lines.push(
      `${this.name}_bucket${renderLabels(this.labelNames, series.labels, ["le", "+Inf"])} ${series.count ?? 0}`,
      `${this.name}_sum${renderLabels(this.labelNames, series.labels)} ${formatNumber(series.sum ?? 0)}`,
      `${this.name}_count${renderLabels(this.labelNames, series.labels)} ${series.count ?? 0}`,
    );

    return lines;
  }
}

export class MetricRegistry {
  private readonly metrics = new Map<string, Metric>();
  private readonly dropped = new Map<string, number>();
  private readonly maxSeries: number;

  constructor(options: { readonly maxSeriesPerMetric?: number } = {}) {
    this.maxSeries = options.maxSeriesPerMetric ?? DEFAULT_MAX_SERIES;
  }

  counter(name: string, options: MetricOptions): Counter {
    return this.register(new Counter(name, options, this.maxSeries));
  }

  histogram(
    name: string,
    options: MetricOptions & { readonly buckets?: ReadonlyArray<number> },
  ): Histogram {
    return this.register(new Histogram(name, options, this.maxSeries));
  }

  /** Observations dropped because a metric reached its cardinality cap. */
  droppedSeries(): ReadonlyMap<string, number> {
    for (const metric of this.metrics.values())
      if (metric.droppedSeries > 0) this.dropped.set(metric.name, metric.droppedSeries);

    return this.dropped;
  }

  render(): string {
    const blocks: Array<string> = [];

    for (const metric of this.metrics.values()) blocks.push(metric.render());

    const dropped = this.droppedSeries();

    if (dropped.size > 0) {
      const header = [
        "# HELP mattrax_telemetry_series_dropped_total Metric series dropped at the cardinality cap",
        "# TYPE mattrax_telemetry_series_dropped_total counter",
      ];

      for (const [metric, count] of [...dropped.entries()].sort(([a], [b]) => a.localeCompare(b)))
        header.push(
          `mattrax_telemetry_series_dropped_total{metric="${escapeLabelValue(metric)}"} ${count}`,
        );

      blocks.push(header.join("\n"));
    }

    return `${blocks.join("\n")}\n`;
  }

  private register<T extends Metric>(metric: T): T {
    if (this.metrics.has(metric.name))
      throw new Error(`Metric "${metric.name}" is already registered`);

    this.metrics.set(metric.name, metric);

    return metric;
  }
}
