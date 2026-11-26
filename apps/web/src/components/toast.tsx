import { Portal } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from "~/components/ui/icons";
import { cn } from "~/lib/utils";

export type ToastTone = "success" | "warning" | "error" | "info";

export type ToastOptions = {
  /** Secondary sentence, e.g. the error message for a failed save. */
  description?: string;
  tone?: ToastTone;
  /** Extra lines such as `Policy name: no longer exists`. */
  details?: readonly string[];
  /**
   * Auto-dismiss delay in milliseconds. `null` keeps the card until the
   * operator dismisses it.
   */
  duration?: number | null;
};

type Toast = ToastOptions & { readonly id: number; readonly title: string; leaving?: boolean };

/**
 * One polite status region owns every spoken message, exactly like the plain
 * `announce()` used before toasts existed. The visible cards are *not* a live
 * region of their own: a toast speaks through the same region, so a mutation
 * is never announced twice.
 */
const [announcement, setAnnouncement] = createSignal("");

export const announcementText = announcement;

/** Write a sentence to the shell's screen-reader region without a visible card. */
export function announce(message: string) {
  setAnnouncement(message);
}

const MAX_VISIBLE = 4;

const DURATION: Record<ToastTone, number> = {
  success: 5000,
  info: 6000,
  warning: 9000,
  error: 12000,
};

const [toasts, setToasts] = createSignal<ReadonlyArray<Toast>>([]);

const timers = new Map<number, ReturnType<typeof setTimeout>>();

const leaving = new Set<number>();

let nextId = 1;

function clearTimer(id: number) {
  const timer = timers.get(id);

  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
}

function dismiss(id: number) {
  clearTimer(id);

  // Let the card finish its exit before removing it, so a toast never
  // disappears from under the pointer. Repeated dismissals are idempotent.
  if (leaving.has(id)) return;

  leaving.add(id);
  setToasts((current) =>
    current.map((item) => (item.id === id ? { ...item, leaving: true } : item)),
  );

  setTimeout(() => {
    leaving.delete(id);
    setToasts((current) => current.filter((item) => item.id !== id));
  }, 150);
}

function push(title: string, options: ToastOptions = {}): number {
  const tone = options.tone ?? "success";
  const id = nextId++;
  const next: Toast[] = [...toasts(), { ...options, tone, id, title }];
  const overflow = next.splice(0, Math.max(0, next.length - MAX_VISIBLE));

  // The newest cards matter most; a long burst must not fill the viewport.
  for (const dropped of overflow) clearTimer(dropped.id);

  setToasts(next);

  const duration = options.duration === undefined ? DURATION[tone] : options.duration;

  if (duration !== null)
    timers.set(
      id,
      setTimeout(() => dismiss(id), duration),
    );

  announce([title, options.description, ...(options.details ?? [])].filter(Boolean).join(". "));

  return id;
}

/**
 * Show a result for an action the operator just took. Every card also speaks
 * through `announce()`, so mouse and screen-reader users get the same message.
 */
export const toast = {
  success: (title: string, options: Omit<ToastOptions, "tone"> = {}) =>
    push(title, { ...options, tone: "success" }),
  warning: (title: string, options: Omit<ToastOptions, "tone"> = {}) =>
    push(title, { ...options, tone: "warning" }),
  error: (title: string, options: Omit<ToastOptions, "tone"> = {}) =>
    push(title, { ...options, tone: "error" }),
  info: (title: string, options: Omit<ToastOptions, "tone"> = {}) =>
    push(title, { ...options, tone: "info" }),
  dismiss,
};

const tones: Record<
  ToastTone,
  { class: string; icon: (props: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element }
> = {
  success: { class: "border-success/25 text-success-foreground", icon: CheckCircle2 },
  warning: { class: "border-warning/30 text-warning-foreground", icon: TriangleAlert },
  error: { class: "border-destructive/30 text-destructive", icon: CircleAlert },
  info: { class: "border-border text-foreground", icon: Info },
};

function ToastCard(props: { toast: Toast }) {
  // Each card owns one immutable toast, so the tone never changes after mount.
  const tone = tones[props.toast.tone ?? "success"];
  const Icon = tone.icon;

  return (
    <li
      data-leaving={props.toast.leaving ? "" : undefined}
      class={cn(
        "pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg border bg-popover/95 shadow-panel backdrop-blur-xl sm:w-88",
        "animate-in fade-in-0 slide-in-from-top-2 duration-150 ease-swift data-leaving:animate-out data-leaving:fade-out-0 data-leaving:slide-out-to-top-1 data-leaving:duration-150",
        tone.class,
      )}
    >
      <div class="flex items-start gap-2.5 px-3.5 py-3">
        <Icon class="mt-px size-4 shrink-0" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="text-xs font-medium leading-snug text-foreground">{props.toast.title}</p>
          <Show when={props.toast.description}>
            <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {props.toast.description}
            </p>
          </Show>
          <Show when={(props.toast.details?.length ?? 0) > 0}>
            <ul class="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto text-xs leading-relaxed text-muted-foreground">
              <For each={props.toast.details}>
                {(detail) => <li class="break-words">{detail}</li>}
              </For>
            </ul>
          </Show>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          class="-mr-1 -mt-1 shrink-0"
          aria-label={`Dismiss notification: ${props.toast.title}`}
          onClick={() => dismiss(props.toast.id)}
        >
          <X class="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

/**
 * The dashboard's single notification surface. `Portal` renders only on the
 * client, which is exactly right: notifications only ever originate from an
 * interaction, and the empty list must not mark up SSR output.
 */
export function Toaster() {
  return (
    <Portal>
      <div
        role="region"
        aria-label="Notifications"
        class="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:right-4 sm:items-end"
      >
        <ol class="flex w-full max-w-sm flex-col gap-2">
          <For each={toasts()}>{(item) => <ToastCard toast={item} />}</For>
        </ol>
      </div>
    </Portal>
  );
}
