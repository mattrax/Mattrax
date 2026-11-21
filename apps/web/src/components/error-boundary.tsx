import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button } from "~/components/ui/button";
import { CircleAlert } from "~/components/ui/icons";
import { newErrorReference } from "~/lib/error-reference";
import type { ErrorReference } from "~/lib/error-reference";
import { errorPresentation, raisedFailure } from "~/lib/errors";
import type { RaisedFailure } from "~/lib/errors";
import { capturePostHogException } from "~/lib/posthog";
import { cn } from "~/lib/utils";
import type { Schema } from "effect";

/**
 * The dashboard's error surfaces.
 *
 * Solid's `Errored` boundary swallows the error from the window `error` event,
 * so PostHog's automatic exception capture never sees it. Every boundary
 * therefore reports explicitly with a reference id the user can quote to
 * support, and the same id is attached to the PostHog event.
 */
export type ErrorBoundaryName = "app" | "dashboard" | "landing" | "docs" | "policy-editor";

const report = (boundary: ErrorBoundaryName, reference: ErrorReference, failure: RaisedFailure) => {
  // The boundary renders once per error, so this logs once rather than per frame.
  console.error(`Mattrax ${boundary} error ${reference}`, failure);

  const path = globalThis.location?.pathname;

  const properties = { error_id: reference, error_boundary: boundary } satisfies Record<
    string,
    Schema.Json
  >;

  capturePostHogException(failure, path ? { ...properties, path } : properties);
};

export type ErrorPanelProps = {
  boundary: ErrorBoundaryName;
  error: unknown;
  reset?: () => void;
  /** Copy for the heading eyebrow, e.g. "Policy editor". */
  label?: string;
  class?: string;
  /** Page variants centre themselves in the viewport. */
  variant?: "page" | "section" | "editor";
  children?: JSX.Element;
};

/**
 * Shared visual treatment for a caught render error. Kept presentational: the
 * boundary decides whether it can retry (reset) or must reload.
 */
export function ErrorPanel(props: ErrorPanelProps) {
  const reference = newErrorReference();

  const failure =
    raisedFailure(props.error) ?? `Unrecognised render failure: ${String(props.error)}`;

  report(props.boundary, reference, failure);

  const presentation = errorPresentation(failure);
  const variant = () => props.variant ?? "section";

  return (
    <div
      class={cn(
        "flex w-full items-center justify-center",
        variant() === "page" ? "min-h-svh p-6" : "py-10",
        props.class,
      )}
      role="alert"
    >
      <div
        class={cn(
          "w-full rounded-xl border border-border bg-card p-5 text-left shadow-[var(--shadow-dialog)]",
          variant() === "page" ? "max-w-md" : "max-w-xl",
        )}
      >
        <div class="flex items-start gap-3">
          <span
            aria-hidden="true"
            class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-destructive/25 bg-destructive/10 text-destructive"
          >
            <CircleAlert class="size-3.5" />
          </span>
          <div class="min-w-0 flex-1">
            <Show when={props.label}>
              {(label) => (
                <p class="text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {label()}
                </p>
              )}
            </Show>
            <h2 class="text-[14px] font-semibold text-foreground">{presentation.title}</h2>
            <p class="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              {presentation.message}
            </p>
            {props.children}
            <div class="mt-4 flex flex-wrap items-center gap-2">
              {props.reset ? (
                <Button size="sm" onClick={() => props.reset?.()}>
                  Try again
                </Button>
              ) : undefined}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (typeof location !== "undefined") location.reload();
                }}
              >
                Reload page
              </Button>
              <span class="ml-auto text-[11px] tabular-nums text-muted-foreground">
                Error ID <code class="font-mono text-[11px] text-foreground">{reference}</code>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Full-page boundary for the application root and the public shell: there is no
 * surrounding chrome to fall back to, so it owns the viewport.
 */
export function PageErrorFallback(props: {
  boundary: ErrorBoundaryName;
  error: unknown;
  reset: () => void;
}) {
  return (
    <div class="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 text-foreground">
      <div class="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          class="flex size-6 items-center justify-center rounded-[6px] bg-primary text-[11px] font-bold text-primary-foreground"
        >
          M
        </span>
        <span class="text-[12.5px] font-medium text-muted-foreground">Mattrax</span>
      </div>
      <ErrorPanel
        boundary={props.boundary}
        error={props.error}
        reset={props.reset}
        variant="section"
        class="max-w-md"
      />
    </div>
  );
}
