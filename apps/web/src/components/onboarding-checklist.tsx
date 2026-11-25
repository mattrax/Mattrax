import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import type { TenantOnboardingState } from "@mattrax/enterprise-domain/client";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { authClient } from "~/lib/auth";
import { BookOpen, Check, ChevronDown, ChevronRight, X } from "~/components/ui/icons";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import {
  deriveOnboardingSteps,
  markOnboardingDismissed,
  onboardingProgress,
  shouldShowOnboarding,
} from "~/lib/onboarding";
import {
  ONBOARDING_STALE_MILLIS,
  ONBOARDING_WRITE_PERMISSIONS,
  onboardingIsDismissed,
  onboardingQueryEnabled,
  readOnboardingDismissal,
  writeOnboardingDismissal,
} from "~/lib/onboarding-query";
import { useTenantPermissions } from "~/lib/permissions";
import { supportUrl } from "~/lib/support-config-store";
import { cn } from "~/lib/utils";
import { resolveTenantId } from "~/lib/tenant";

/**
 * The in-product onboarding path for a new tenant.
 *
 * The server returns aggregate counts, not completed flags, so every step is
 * derived from the tenant's live resources. Dismissal is stored on the member
 * row: it follows the account across browsers and does not hide the checklist
 * for another administrator. The card disappears on completion, and an empty
 * step list (a member with no relevant write permissions) renders nothing. The
 * aggregate query stays disabled until membership permissions are known and
 * remains disabled for a dismissed checklist.
 */
/** Read secondary query data only after success so pending async values never throw or suspend during render. */
function settledQueryData<T>(query: {
  readonly isSuccess: boolean;
  readonly data: T | undefined;
}): T | undefined {
  return query.isSuccess ? query.data : undefined;
}

/** A circular readout beside the title; the arc grows as steps are completed. */
function ProgressRing(props: { done: number; total: number }) {
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const offset = () => circumference * (1 - (props.total ? props.done / props.total : 0));

  return (
    <svg
      viewBox="0 0 36 36"
      class="size-9 shrink-0 -rotate-90"
      role="img"
      aria-label={`${props.done} of ${props.total} steps complete`}
    >
      <circle cx="18" cy="18" r={radius} fill="none" stroke="var(--border)" stroke-width="3" />
      <circle
        cx="18"
        cy="18"
        r={radius}
        fill="none"
        stroke="var(--success)"
        stroke-width="3"
        stroke-linecap="round"
        stroke-dasharray={String(circumference)}
        stroke-dashoffset={String(offset())}
        class="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
      />
    </svg>
  );
}

export function OnboardingChecklist(props: { tenantId: string }) {
  const { can, canAny, known, tenant } = useTenantPermissions();
  const session = authClient.useSession();
  const queryClient = useQueryClient();
  const browserStorage = () => {
    try {
      return globalThis.localStorage;
    } catch {
      return undefined;
    }
  };
  const dismissalIdentity = () => ({
    userId: session()?.data?.user?.id,
    tenantId: tenant()?.id ?? resolveTenantId(props.tenantId) ?? props.tenantId,
  });
  const locallyDismissed = createMemo(() => {
    const { userId, tenantId } = dismissalIdentity();

    return readOnboardingDismissal(browserStorage(), userId, tenantId);
  });
  const queryKey = () => enterpriseKeys.onboarding(props.tenantId);
  const [dismissed, setDismissed] = createSignal(
    onboardingIsDismissed(queryClient.getQueryData<TenantOnboardingState>(queryKey())),
  );

  const state = useQuery(() => {
    const options = enterpriseQueries.onboarding(props.tenantId);

    return {
      ...options,
      enabled:
        options.enabled &&
        onboardingQueryEnabled(
          known(),
          canAny(ONBOARDING_WRITE_PERMISSIONS),
          dismissed() || locallyDismissed(),
        ),
      staleTime: ONBOARDING_STALE_MILLIS,
      refetchOnMount: true,
    };
  });

  // Dismissal comes from the authoritative query data, not a QueryCache
  // subscription. Cache writes can run inside an owned scope (hydration primes
  // an entry from the component body), and writing a signal from the cache
  // listener there threw REACTIVE_WRITE_IN_OWNED_SCOPE. The effect's imperative
  // phase is the supported place for this synchronisation, and keeping it out
  // of the options getter avoids making `enabled` depend on its own result.
  createEffect(
    () => onboardingIsDismissed(settledQueryData(state)),
    (isDismissed) => {
      setDismissed(isDismissed);
    },
  );

  // One settled read per computation keeps the narrowing local to the memo.
  const steps = createMemo(() => {
    const data = settledQueryData(state);

    return data ? deriveOnboardingSteps(props.tenantId, data, can) : [];
  });

  const visible = createMemo(() => {
    const data = settledQueryData(state);

    return data !== undefined && !locallyDismissed() && shouldShowOnboarding(data, steps());
  });

  const progress = createMemo(() => onboardingProgress(steps()));
  const upcoming = createMemo(() => steps().filter((step) => !step.done));
  const completed = createMemo(() => steps().filter((step) => step.done));
  const [showCompleted, setShowCompleted] = createSignal(false);

  /**
   * The rollback snapshot for the dismissal in flight.
   *
   * `@tanstack/solid-query` calls this component's `onMutate` itself and then
   * invokes `onError` with an `undefined` context, so the value returned from
   * `onMutate` never reaches the handler. Keep the snapshot here instead; the
   * dismiss button is disabled while the mutation is pending, so there is only
   * one in flight.
   */
  let dismissalRollback:
    | {
        previous: TenantOnboardingState | undefined;
        identity: { userId: string | undefined; tenantId: string };
      }
    | undefined;
  let dismissalFailed = false;

  const dismiss = useMutation(() => ({
    mutationFn: () => enterprise.patchTenantOnboarding(props.tenantId, true),
    onMutate: async () => {
      // Solid Query does not await `onMutate`. Capture the rollback snapshot
      // and mark the browser before the cancellation await so a PATCH that
      // rejects immediately still has something to restore and clear.
      const identity = dismissalIdentity();
      const previous = queryClient.getQueryData<TenantOnboardingState>(queryKey());
      const context = { previous, identity };
      dismissalRollback = context;
      dismissalFailed = false;
      writeOnboardingDismissal(browserStorage(), identity.userId, identity.tenantId, true);

      await queryClient.cancelQueries({ queryKey: queryKey() });

      // The mutation may have settled while cancellation was pending. onError
      // has then already restored the cache and cleared the marker, so do not
      // reapply the optimistic dismissal behind its back.
      if (dismissalRollback !== context) return context;

      const latest = queryClient.getQueryData<TenantOnboardingState>(queryKey());

      // Write the optimistic dismissal only after cancellation has settled, so
      // an in-flight GET cannot overwrite it. A failure before this point is
      // handled by the synchronous marker and rollback snapshot above.
      if (latest) {
        context.previous = latest;
        queryClient.setQueryData(
          queryKey(),
          markOnboardingDismissed(latest, new Date().toISOString()),
        );
      }

      return context;
    },
    onSuccess: () => {
      // The server has confirmed the dismissal. If the PATCH settled before
      // `onMutate`'s cancellation continuation, no optimistic write has landed
      // yet; mark the cache here so the card still disappears.
      const current = queryClient.getQueryData<TenantOnboardingState>(queryKey());

      if (current && current.dismissedAt === null)
        queryClient.setQueryData(
          queryKey(),
          markOnboardingDismissed(current, new Date().toISOString()),
        );
    },
    onError: () => {
      const context = dismissalRollback;
      dismissalRollback = undefined;
      dismissalFailed = true;

      if (!context) return;

      if (context.previous) queryClient.setQueryData(queryKey(), context.previous);

      writeOnboardingDismissal(
        browserStorage(),
        context.identity.userId,
        context.identity.tenantId,
        false,
      );
    },
    onSettled: () => {
      dismissalRollback = undefined;

      // A failed dismissal restored the pre-mutation data, so there is nothing
      // newer to invalidate. Invalidating here would immediately mark the
      // restored query stale and refetch it once the query is enabled again.
      if (dismissalFailed) {
        dismissalFailed = false;
        return;
      }

      void queryClient.invalidateQueries({ queryKey: queryKey(), refetchType: "none" });
    },
  }));

  const externalSupport = () => supportUrl().startsWith("http");

  return (
    <Show when={visible()}>
      <section
        aria-labelledby="onboarding-title"
        class="max-w-2xl animate-in rounded-2xl border border-border bg-card p-5 shadow-card fade-in-0 slide-in-from-bottom-2 duration-300 ease-out motion-reduce:animate-none sm:p-6"
      >
        <div class="flex items-start gap-4">
          <div class="min-w-0 flex-1">
            <h2 id="onboarding-title" class="text-[16px] font-[600] tracking-[-0.01em] text-foreground">
              Get started
            </h2>
            <p class="mt-1 text-[13px] text-muted-foreground">
              {progress().done} of {progress().total} complete
            </p>
          </div>
          <ProgressRing done={progress().done} total={progress().total} />
          <button
            type="button"
            aria-label="Dismiss the Get started checklist"
            class="-mr-1 -mt-1 rounded-md p-1 text-subtle-foreground transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-hover hover:text-foreground disabled:opacity-50 motion-reduce:transition-none"
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate()}
          >
            <X class="size-4" />
          </button>
        </div>

        <ol class="mt-5 flex flex-col gap-1">
          <For each={upcoming()}>
            {(step, index) => (
              <li
                data-state={index() === 0 ? "active" : "upcoming"}
                class={cn(
                  "rounded-xl transition-colors duration-[var(--duration-panel)] ease-swift motion-reduce:transition-none",
                  index() === 0 ? "bg-hover" : "hover:bg-hover/60",
                )}
              >
                <a href={step.href} class="group flex items-center gap-3 px-3 py-3">
                  <span
                    class="size-5 shrink-0 rounded-full border border-dashed border-border-strong"
                    aria-hidden="true"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[13px] font-[560] text-foreground">
                      {step.title}
                    </span>
                    <Show when={index() === 0}>
                      <span class="mt-1 block truncate text-[12px] leading-4 text-muted-foreground">
                        {step.description}
                      </span>
                    </Show>
                  </span>
                  <span
                    aria-hidden="true"
                    class={cn(
                      "shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-[500] transition-[transform,background-color] duration-[var(--duration-hover)] ease-swift motion-reduce:transition-none",
                      index() === 0
                        ? "bg-foreground text-background"
                        : "border border-border bg-card text-foreground group-hover:border-border-strong",
                    )}
                  >
                    Start
                  </span>
                </a>
              </li>
            )}
          </For>
        </ol>

        <Show when={completed().length > 0}>
          <div class="mt-3 border-t border-border pt-3">
            <button
              type="button"
              aria-expanded={showCompleted() ? "true" : "false"}
              aria-controls="onboarding-completed"
              class="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[12px] text-muted-foreground transition-colors duration-[var(--duration-hover)] ease-swift hover:text-foreground motion-reduce:transition-none"
              onClick={() => setShowCompleted((open) => !open)}
            >
              <span>Completed ({completed().length})</span>
              <ChevronDown
                class={cn(
                  "size-3.5 transition-transform duration-[var(--duration-hover)] ease-swift motion-reduce:transition-none",
                  showCompleted() && "rotate-180",
                )}
              />
            </button>
            <Show when={showCompleted()}>
              <ul
                id="onboarding-completed"
                class="mt-1 flex animate-in flex-col gap-0.5 fade-in-0 slide-in-from-top-1 duration-200 ease-out motion-reduce:animate-none"
              >
                <For each={completed()}>
                  {(step) => (
                    <li>
                      <a
                        href={step.href}
                        class="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-hover motion-reduce:transition-none"
                      >
                        <span
                          class="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
                          aria-hidden="true"
                        >
                          <Check class="size-3" />
                        </span>
                        <span class="min-w-0 flex-1 truncate text-[13px] text-muted-foreground group-hover:text-foreground">
                          {step.title}
                        </span>
                        <ChevronRight class="size-3 shrink-0 text-subtle-foreground" />
                      </a>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </Show>

        <p class="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-[11px] text-muted-foreground">
          <span>Stuck, or want a walkthrough?</span>
          <a
            href={supportUrl()}
            target={externalSupport() ? "_blank" : undefined}
            rel={externalSupport() ? "noopener" : undefined}
            class="font-[500] text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground"
          >
            Talk to us
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="/docs/"
            target="_self"
            class="inline-flex items-center gap-1 font-[500] text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground"
          >
            <BookOpen class="size-3" aria-hidden="true" />
            Documentation
          </a>
        </p>
      </section>
    </Show>
  );
}
