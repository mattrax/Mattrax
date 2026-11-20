import { For, Show } from "solid-js";
import type { PolicyProgressSegment } from "~/lib/policy-delivery";
import { cn } from "~/lib/utils";

/**
 * A segmented delivery bar. Widths are proportional to the segment values, so
 * a zero-total set renders nothing instead of an empty track that looks like a
 * failed deploy.
 */
export function PolicyProgressBar(props: {
  segments: ReadonlyArray<PolicyProgressSegment>;
  class?: string;
}) {
  const total = () => props.segments.reduce((sum, segment) => sum + segment.value, 0);
  const visible = () => props.segments.filter((segment) => segment.value > 0);

  const summary = () =>
    props.segments
      .filter((segment) => segment.value > 0)
      .map((segment) => `${segment.value} ${segment.label.toLowerCase()}`)
      .join(", ");

  return (
    <Show when={total() > 0}>
      <div
        role="img"
        aria-label={summary()}
        class={cn("flex h-2 w-full gap-px overflow-hidden rounded-full bg-hover", props.class)}
      >
        <For each={visible()}>
          {(segment) => (
            <span
              class={cn("h-full first:rounded-l-full last:rounded-r-full", segment.class)}
              style={{ width: `${(segment.value / total()) * 100}%` }}
            />
          )}
        </For>
      </div>
    </Show>
  );
}
