import { useLocation, useParams } from "@solidjs/router";
import { createEffect, createSignal, For, onSettled } from "solid-js";
import type { ParentProps } from "solid-js";
import { useCan } from "~/lib/permissions";
import { cn } from "~/lib/utils";

const tabs = [
  { id: "", label: "Overview" },
  { id: "directory", label: "Directory sync" },
  { id: "domains", label: "Domains" },
];

export default function IdentitySettingsLayout(props: ParentProps) {
  const params = useParams();
  const location = useLocation();
  const { can } = useCan();
  const base = () => `/t/${params.tenantId}/settings/identity`;
  const visibleTabs = () => tabs.filter(() => can("identity.read"));

  const active = () => {
    const rest = location.pathname.slice(base().length).replace(/^\//, "");

    return rest.split("/")[0] ?? "";
  };

  let nav: HTMLElement | undefined;
  const anchors = new Map<string, HTMLAnchorElement>();
  const [indicator, setIndicator] = createSignal({ left: 0, width: 0 });
  const [measured, setMeasured] = createSignal(false);

  // Measure the active label rather than animating a border on each tab: one
  // underline then slides between options and keeps the bar's edge straight.
  const measure = () => {
    const current = anchors.get(active());

    if (!current) return;
    setIndicator({ left: current.offsetLeft, width: current.offsetWidth });
  };

  createEffect(
    () => [active(), visibleTabs().length] as const,
    () => queueMicrotask(measure),
  );

  onSettled(() => {
    measure();
    requestAnimationFrame(() => setMeasured(true));

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    if (nav) observer.observe(nav);
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  });

  return (
    <div class="flex flex-col">
      {/* The tab band cancels the pane gutter so it reads as part of the body
          above the sections, then re-adds the same gutter to align its labels. */}
      <nav
        ref={(element) => {
          nav = element;
        }}
        class="no-scrollbar relative -mx-4 -mt-5 flex gap-5 overflow-x-auto border-b border-border px-4 sm:-mx-6 sm:-mt-6 sm:px-6 xl:-mx-8 xl:-mt-7 xl:px-8"
        aria-label="Identity sections"
      >
        <For each={visibleTabs()}>
          {(tab) => {
            const href = tab.id ? `${base()}/${tab.id}` : base();
            const isActive = () => active() === tab.id;

            return (
              <a
                ref={(element) => {
                  anchors.set(tab.id, element);
                }}
                href={href}
                class={cn(
                  "inline-flex h-10 shrink-0 items-center px-0.5 text-[12.5px] font-[500] whitespace-nowrap outline-none transition-colors duration-[var(--duration-hover)] ease-swift focus-visible:ring-2 focus-visible:ring-ring/40",
                  isActive() ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={isActive() ? "page" : undefined}
              >
                {tab.label}
              </a>
            );
          }}
        </For>
        <span
          aria-hidden="true"
          data-measured={measured() ? "true" : "false"}
          class="pointer-events-none absolute -bottom-px left-0 h-0.5 bg-foreground transition-[left,width] duration-[var(--duration-popover)] ease-swift data-[measured=false]:transition-none motion-reduce:transition-none"
          style={{ left: `${indicator().left}px`, width: `${indicator().width}px` }}
        />
      </nav>
      <div class="flex min-w-0 flex-col pt-5">{props.children}</div>
    </div>
  );
}
