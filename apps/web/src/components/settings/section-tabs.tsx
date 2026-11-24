import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { sectionTabTarget } from "./section-tabs-nav";

export type SectionTab = {
  readonly id: string;
  readonly label: string;
  /** Navigation tabs link; a tab without href calls `onSelect`. */
  readonly href?: string;
  /** The panel a button tab controls, for the tablist relationship. */
  readonly panelId?: string;
  /** Stable DOM id, so a panel's `aria-labelledby` can point at this tab. */
  readonly elementId?: string;
};

/**
 * The flush tab band shared by Identity, Migration and Integrations.
 *
 * It cancels the settings pane's gutter so the band reads as part of the body
 * above the sections, then re-adds the same gutter to align its labels. The
 * underline is measured from the active label instead of animating a border on
 * each tab, so it slides between options and keeps the bar's edge straight.
 */
export function SectionTabs(props: {
  label: string;
  tabs: ReadonlyArray<SectionTab>;
  active: string;
  onSelect?: (id: string) => void;
  /** Panels are mounted on demand; only link aria-controls when one exists. */
  panelMounted?: (id: string) => boolean;
  class?: string;
}) {
  const isTablist = () => props.onSelect !== undefined;
  const activeId = () =>
    props.tabs.some((tab) => tab.id === props.active)
      ? props.active
      : (props.tabs[0]?.id ?? "");
  const anchors = new Map<string, HTMLElement>();
  const [indicator, setIndicator] = createSignal({ left: 0, width: 0 });
  const [measured, setMeasured] = createSignal(false);

  const measure = () => {
    const current = anchors.get(activeId());

    if (!current) return;

    setIndicator({ left: current.offsetLeft, width: current.offsetWidth });
  };

  createEffect(
    () => [activeId(), props.tabs.length] as const,
    () => queueMicrotask(measure),
  );

  onSettled(() => {
    measure();
    requestAnimationFrame(() => setMeasured(true));

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    const first = anchors.values().next().value;

    if (first?.parentElement) observer.observe(first.parentElement);
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  });

  const itemClass = (id: string) =>
    cn(
      "inline-flex h-10 shrink-0 items-center px-0.5 text-[12.5px] font-[500] whitespace-nowrap outline-none transition-colors duration-[var(--duration-hover)] ease-swift focus-visible:ring-2 focus-visible:ring-ring/40",
      activeId() === id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
    );

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isTablist()) return;

    const next = sectionTabTarget(
      props.tabs.map((tab) => tab.id),
      activeId(),
      event.key,
      event,
    );

    if (!next) return;

    event.preventDefault();
    props.onSelect?.(next);
    queueMicrotask(() => anchors.get(next)?.focus());
  };

  return (
    <nav
      class={cn(
        "no-scrollbar relative -mx-4 -mt-5 flex gap-5 overflow-x-auto border-b border-border px-4 sm:-mx-6 sm:-mt-6 sm:px-6 xl:-mx-8 xl:-mt-7 xl:px-8",
        props.class,
      )}
      aria-label={props.label}
      aria-orientation={isTablist() ? "horizontal" : undefined}
      role={isTablist() ? "tablist" : undefined}
    >
      <For each={props.tabs}>
        {(tab) => (
          <Show
            when={tab.href}
            fallback={
              <button
                type="button"
                ref={(element) => {
                  anchors.set(tab.id, element);
                }}
                id={tab.elementId}
                onKeyDown={onKeyDown}
                role="tab"
                tabindex={activeId() === tab.id ? 0 : -1}
                aria-selected={activeId() === tab.id ? "true" : "false"}
                aria-controls={
                  tab.panelId && props.panelMounted?.(tab.id) ? tab.panelId : undefined
                }
                onClick={() => props.onSelect?.(tab.id)}
                class={itemClass(tab.id)}
              >
                {tab.label}
              </button>
            }
          >
            {(href) => (
              <a
                ref={(element) => {
                  anchors.set(tab.id, element);
                }}
                href={href()}
                class={itemClass(tab.id)}
                aria-current={activeId() === tab.id ? "page" : undefined}
              >
                {tab.label}
              </a>
            )}
          </Show>
        )}
      </For>
      <span
        aria-hidden="true"
        data-measured={measured() ? "true" : "false"}
        class="pointer-events-none absolute -bottom-px left-0 h-0.5 bg-foreground transition-[left,width] duration-[var(--duration-popover)] ease-swift data-[measured=false]:transition-none motion-reduce:transition-none"
        style={{ left: `${indicator().left}px`, width: `${indicator().width}px` }}
      />
    </nav>
  );
}
