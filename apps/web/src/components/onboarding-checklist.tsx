import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import type { TenantOnboardingState } from "@mattrax/enterprise-domain/client";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { authClient } from "~/lib/auth";
import { Badge } from "~/components/ui/badge";
import { BookOpen, Check, ChevronRight, Sparkles, X } from "~/components/ui/icons";
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
    () => onboardingIsDismissed(state.data),
    (isDismissed) => {
      setDismissed(isDismissed);
    },
  );

  const steps = createMemo(() =>
    state.data ? deriveOnboardingSteps(props.tenantId, state.data, can) : [],
  );

  const visible = createMemo(
    () =>
      state.data !== undefined && !locallyDismissed() && shouldShowOnboarding(state.data, steps()),
  );

  const progress = createMemo(() => onboardingProgress(steps()));

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
      await queryClient.cancelQueries({ queryKey: queryKey() });
      const previous = queryClient.getQueryData<TenantOnboardingState>(queryKey());
      const identity = dismissalIdentity();
      const context = { previous, identity };
      dismissalRollback = context;
      dismissalFailed = false;
      writeOnboardingDismissal(browserStorage(), identity.userId, identity.tenantId, true);

      if (previous)
        queryClient.setQueryData(
          queryKey(),
          markOnboardingDismissed(previous, new Date().toISOString()),
        );

      return context;
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
        class="rounded-xl border border-border bg-card px-3.5 py-3.5 shadow-card"
      >
        <div class="flex items-start gap-3">
          <span class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-hover text-foreground">
            <Sparkles class="size-3.5" aria-hidden="true" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h2 id="onboarding-title" class="text-[13px] font-[560] text-foreground">
                Get started
              </h2>
              <Badge variant="secondary" class="tabular-nums">
                {progress().done} of {progress().total} done
              </Badge>
            </div>
            <p class="mt-0.5 text-[12px] leading-5 text-muted-foreground">
              The short path from an empty tenant to a managed fleet.
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss the Get started checklist"
            class="rounded p-1 text-muted-foreground transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-hover hover:text-foreground disabled:opacity-50"
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate()}
          >
            <X class="size-3.5" />
          </button>
        </div>

        <ol class="mt-3 grid gap-1.5 sm:grid-cols-2">
          <For each={steps()}>
            {(step, index) => (
              <li>
                <a
                  href={step.href}
                  class={cn(
                    "group flex items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors duration-[var(--duration-hover)] ease-swift",
                    step.done
                      ? "border-transparent bg-surface hover:bg-hover"
                      : "border-border hover:border-border-strong hover:bg-hover",
                  )}
                >
                  <span
                    class={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-[600] tabular-nums",
                      step.done
                        ? "bg-foreground text-background"
                        : "border border-border-strong text-muted-foreground",
                    )}
                    aria-hidden="true"
                  >
                    <Show when={step.done} fallback={index() + 1}>
                      <Check class="size-2.5" />
                    </Show>
                  </span>
                  <span class="min-w-0 flex-1">
                    <span
                      class={cn(
                        "block truncate text-[12px] font-[500]",
                        step.done ? "text-muted-foreground line-through" : "text-foreground",
                      )}
                    >
                      {step.title}
                    </span>
                    <span class="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                      {step.description}
                    </span>
                  </span>
                  <ChevronRight class="mt-1 size-3 shrink-0 text-subtle-foreground transition-transform duration-[var(--duration-hover)] ease-swift group-hover:translate-x-0.5" />
                </a>
              </li>
            )}
          </For>
        </ol>

        <p class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
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
