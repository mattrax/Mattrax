import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import type { TenantOnboardingState } from "@mattrax/enterprise-domain/client";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { authClient } from "~/lib/auth";
import { Badge } from "@mattrax/ui";
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
import type { TenantPermissionsApi } from "~/lib/permissions";
import { supportUrl } from "~/lib/support-config-store";
import { cn } from "~/lib/utils";
import { resolveTenantId } from "~/lib/tenant";
import { Button } from "@mattrax/ui";

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

/**
 * Test seam for the account, permissions and enterprise calls. Production
 * callers omit it; tests inject fakes instead of replacing modules.
 */
export type OnboardingChecklistDeps = {
  readonly session?: () => { readonly data?: { readonly user?: { readonly id?: string } } };
  readonly permissions?: () => TenantPermissionsApi;
  readonly onboardingQuery?: (tenantId: string) => ReturnType<typeof enterpriseQueries.onboarding>;
  readonly patchTenantOnboarding?: typeof enterprise.patchTenantOnboarding;
};

export default function OnboardingChecklist(props: {
  tenantId: string;
  readonly deps?: OnboardingChecklistDeps;
}) {
  const deps = props.deps ?? {};
  const { can, canAny, known, tenant } = (deps.permissions ?? useTenantPermissions)();
  const session = deps.session ?? authClient.useSession();
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
    const options = deps.onboardingQuery
      ? deps.onboardingQuery(props.tenantId)
      : enterpriseQueries.onboarding(props.tenantId);

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
    mutationFn: () =>
      (deps.patchTenantOnboarding ?? enterprise.patchTenantOnboarding)(props.tenantId, true),
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
        class="rounded-xl border border-border bg-card px-3.5 py-3.5 shadow-card"
      >
        <div class="flex items-start gap-3">
          <span class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-hover text-foreground">
            <Sparkles class="size-3.5" aria-hidden="true" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h2 id="onboarding-title" class="text-xs font-semibold text-foreground">
                Get started
              </h2>
              <span class="tabular-nums">
                <Badge variant="secondary">
                  {progress().done} of {progress().total} done
                </Badge>
              </span>
            </div>
            <p class="mt-0.5 text-xs leading-5 text-muted-foreground">
              The short path from an empty tenant to a managed fleet.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss the Get started checklist"
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate()}
          >
            <X class="size-3.5" />
          </Button>
        </div>

        <ol class="mt-3 grid gap-1.5 sm:grid-cols-2">
          <For each={steps()}>
            {(step, index) => (
              <li>
                <a
                  href={step.href}
                  class={cn(
                    "group flex items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors duration-150 ease-swift",
                    step.done
                      ? "border-transparent bg-surface hover:bg-hover"
                      : "border-border hover:border-border-strong hover:bg-hover",
                  )}
                >
                  <span
                    class={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
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
                        "block truncate text-xs font-medium",
                        step.done ? "text-muted-foreground line-through" : "text-foreground",
                      )}
                    >
                      {step.title}
                    </span>
                    <span class="mt-0.5 block text-xs leading-4 text-muted-foreground">
                      {step.description}
                    </span>
                  </span>
                  <ChevronRight class="mt-1 size-3 shrink-0 group-hover:translate-x-0.5" />
                </a>
              </li>
            )}
          </For>
        </ol>

        <p class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-2.5 text-xs text-muted-foreground">
          <span>Stuck, or want a walkthrough?</span>
          <a
            href={supportUrl()}
            target={externalSupport() ? "_blank" : undefined}
            rel={externalSupport() ? "noopener" : undefined}
            class="font-medium text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground"
          >
            Talk to us
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="/docs/"
            target="_self"
            class="inline-flex items-center gap-1 font-medium text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground"
          >
            <BookOpen class="size-3" aria-hidden="true" />
            Documentation
          </a>
        </p>
      </section>
    </Show>
  );
}
