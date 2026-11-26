import { Show } from "solid-js";
import { cn } from "./lib/cn";
import { splitProps } from "./lib/solid";
import DotMatrix from "./dot-matrix";
import type { DotMatrixPattern, DotMatrixSize, DotMatrixState } from "./dot-matrix";

export type LoadingStateProps = {
  label: string;
  state?: DotMatrixState;
  /** Percentage, 0–100, when the operation reports progress. */
  value?: number;
  /** Extra line under the label, e.g. "214 of 512 devices". */
  detail?: string;
  pattern?: DotMatrixPattern;
  size?: DotMatrixSize;
  class?: string;
};

/**
 * The shared activity line: a dot-matrix mark, what is happening, and an
 * optional monospace progress detail. Use it for cold loads, background jobs
 * and long-running saves instead of a bare "Loading…" string.
 */
export default function LoadingState(props: LoadingStateProps) {
  const [local] = splitProps(props, [
    "label",
    "state",
    "value",
    "detail",
    "pattern",
    "size",
    "class",
  ]);

  const determinate = () => local.state === undefined && local.value !== undefined;
  const percent = () => Math.round(Math.min(100, Math.max(0, local.value ?? 0)));
  const detail = () => local.detail ?? (determinate() ? `${percent()}%` : undefined);

  return (
    <div
      data-slot="loading-state"
      role={determinate() ? "progressbar" : "status"}
      aria-live="polite"
      aria-label={local.label}
      aria-valuemin={determinate() ? 0 : undefined}
      aria-valuemax={determinate() ? 100 : undefined}
      aria-valuenow={determinate() ? percent() : undefined}
      class={cn("flex items-center gap-2.5 text-muted-foreground", local.class)}
    >
      <DotMatrix
        decorative
        pattern={local.pattern}
        state={local.state}
        value={local.value}
        size={local.size ?? 18}
      />
      <span class="min-w-0">
        <span class="block text-xs font-medium leading-4 text-foreground">{local.label}</span>
        <Show when={detail()}>
          {(line) => (
            <span class="block font-mono text-xs leading-4 tabular-nums text-muted-foreground">
              {line()}
            </span>
          )}
        </Show>
      </span>
    </div>
  );
}
