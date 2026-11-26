import { For, Show } from "solid-js";
import { cn } from "./lib/cn";
import { splitProps } from "./lib/solid";

export type ProgressTone = "brand" | "success" | "warning" | "destructive" | "info" | "muted";

const toneClass: Record<ProgressTone, string> = {
  brand: "bg-brand-solid",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
  muted: "bg-muted-foreground/40",
};

export type ProgressProps = {
  /** Current value; clamped to `max`. */
  value: number;
  max?: number;
  /** Accessible name for the bar. */
  label: string;
  tone?: ProgressTone;
  /** Render the name and percentage above the bar. */
  showValue?: boolean;
  valueLabel?: string;
  class?: string;
};

/**
 * One determinate progress bar for asynchronous work with a known extent.
 * The percentage is announced, not just painted, so screen-reader users get
 * the same sense of movement.
 */
function Progress(props: ProgressProps) {
  const [local] = splitProps(props, [
    "value",
    "max",
    "label",
    "tone",
    "showValue",
    "valueLabel",
    "class",
  ]);

  const max = () => local.max ?? 100;
  const value = () => Math.min(max(), Math.max(0, local.value));
  const percent = () => (max() > 0 ? (value() / max()) * 100 : 0);

  return (
    <div class={cn("w-full", local.class)}>
      <Show when={local.showValue}>
        <div class="mb-1 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span class="truncate">{local.label}</span>
          <span class="shrink-0 font-mono tabular-nums">
            {local.valueLabel ?? `${Math.round(percent())}%`}
          </span>
        </div>
      </Show>
      <div
        role="progressbar"
        aria-label={local.label}
        aria-valuemin={0}
        aria-valuemax={max()}
        aria-valuenow={value()}
        aria-valuetext={local.valueLabel}
        data-slot="progress"
        class="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          class={cn(
            "h-full rounded-full w-(--progress-width) transition-all duration-200 ease-out",
            toneClass[local.tone ?? "brand"],
          )}
          style={{ "--progress-width": `${percent()}%` }}
        />
      </div>
    </div>
  );
}

export type ProgressSegment = {
  readonly label: string;
  readonly value: number;
  /** Tailwind background class for the segment. */
  readonly class: string;
};

export type SegmentedProgressProps = {
  segments: ReadonlyArray<ProgressSegment>;
  /** Accessible name; the segment counts are appended to it. */
  label: string;
  class?: string;
};

/**
 * A delivery bar made of proportional slices (delivered, pending, failed …).
 * Zero-valued slices are dropped, and a zero total renders nothing rather than
 * an empty track that looks like a failed deploy.
 */
function SegmentedProgress(props: SegmentedProgressProps) {
  const [local] = splitProps(props, ["segments", "label", "class"]);

  const total = () => local.segments.reduce((sum, segment) => sum + segment.value, 0);
  const visible = () => local.segments.filter((segment) => segment.value > 0);
  const summary = () => {
    const counts = visible()
      .map((segment) => `${segment.value} ${segment.label.toLowerCase()}`)
      .join(", ");

    return counts ? `${local.label}: ${counts}` : local.label;
  };

  return (
    <Show when={total() > 0}>
      <div
        role="img"
        aria-label={summary()}
        data-slot="segmented-progress"
        class={cn("flex h-2 w-full gap-px overflow-hidden rounded-full bg-hover", local.class)}
      >
        <For each={visible()}>
          {(segment) => (
            <span
              class={cn("h-full w-(--segment-width) first:rounded-l-full last:rounded-r-full", segment.class)}
              style={{ "--segment-width": `${(segment.value / total()) * 100}%` }}
            />
          )}
        </For>
      </div>
    </Show>
  );
}

export type IndeterminateBarProps = {
  /** Omit for a purely decorative sweep (route changes, page loads). */
  label?: string;
  class?: string;
};

/** A quiet sweep for work with no known extent. */
function IndeterminateBar(props: IndeterminateBarProps) {
  const [local] = splitProps(props, ["label", "class"]);

  return (
    <div
      role={local.label ? "progressbar" : undefined}
      aria-label={local.label}
      aria-hidden={local.label ? undefined : "true"}
      data-slot="indeterminate-bar"
      class={cn("h-0.5 w-full overflow-hidden rounded-full bg-border", local.class)}
    >
      <div class="animate-pulse h-full w-2/5 bg-gradient-to-r from-brand/0 via-brand to-brand/0" />
    </div>
  );
}

export { IndeterminateBar, Progress, SegmentedProgress };
