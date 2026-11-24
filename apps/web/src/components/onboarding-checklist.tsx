import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import type { TenantOnboardingState } from "@mattrax/enterprise-domain/client";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
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
    queryClient.getQueryData<TenantOnboardingState>(queryKey())?.dismissedAt != null,
  );
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (
      event.query.queryKey.length !== queryKey().length ||
      !event.query.queryKey.every((part: unknown, index: number) => part === queryKey()[index])
    )
      return;

    const data = event.query.state.data as TenantOnboardingState | undefined;
    setDismissed(data?.dismissedAt != null);
  });
  onCleanup(unsubscribe);

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

  const steps = createMemo(() =>
    state.data ? deriveOnboardingSteps(props.tenantId, state.data, can) : [],
  );

  const visible = createMemo(
    () =>
      state.data !== undefined && !locallyDismissed() && shouldShowOnboarding(state.data, steps()),
  );

  const progress = createMemo(() => onboardingProgress(steps()));

  const dismiss = useMutation(() => ({
    mutationFn: () => enterprise.patchTenantOnboarding(props.tenantId, true),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKey() });
      const previous = queryClient.getQueryData<TenantOnboardingState>(queryKey());
      const identity = dismissalIdentity();
      writeOnboardingDismissal(browserStorage(), identity.userId, identity.tenantId, true);

      if (previous)
        queryClient.setQueryData(
          queryKey(),
          markOnboardingDismissed(previous, new Date().toISOString()),
        );

      return { previous, identity };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey(), context.previous);
      if (context)
        writeOnboardingDismissal(
          browserStorage(),
          context.identity.userId,
          context.identity.tenantId,
          false,
        );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKey(), refetchType: "none" }),
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
