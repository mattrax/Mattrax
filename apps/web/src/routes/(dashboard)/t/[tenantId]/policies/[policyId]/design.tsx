import { useParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { PolicyRow } from "@mattrax/enterprise-domain/client";
import { Option, Schema } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, Errored, onSettled, Show } from "solid-js";
import { ErrorPanel } from "~/components/error-boundary";
import { QueryError } from "~/components/mdm/common";
import { PolicyDesigner } from "~/components/mdm/policy-designer";
import { Button } from "~/components/ui/button";
import { ArrowLeft } from "~/components/ui/icons";
import { toast } from "~/components/toast";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { isPolicyEnabled } from "~/lib/policy-delivery";
import { ReadOnlyNotice, useCan } from "~/lib/permissions";
import {
  emptyPolicyDraft,
  parsePolicyDraft,
  policyToConfigurations,
  type PolicyDraft,
} from "~/lib/policy-designer/build";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { enterpriseQueries } from "~/lib/enterprise";

const CUSTOM_DESIGNER_KINDS = new Set([
  "mttx.apple.custom.designer",
  "mttx.windows.custom.designer",
  "mttx.android.policy.designer",
]);

const isRecord = (value: Schema.Json | undefined): value is Schema.JsonObject =>
  value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);

const isDesignerDeclaration = (kind: string, value: Schema.Json | undefined) =>
  kind.startsWith("mttx.apple.declaration.") && isRecord(value) && value.designer === true;

const isDesignerConfiguration = (kind: string, value: Schema.Json | undefined) =>
  CUSTOM_DESIGNER_KINDS.has(kind) || isDesignerDeclaration(kind, value);

const decodePolicyRow = Schema.decodeUnknownOption(PolicyRow);

const decodeConfigurations = Schema.decodeUnknownOption(Schema.JsonObject);

export const route = {
  preload: ({
    params,
    intent,
  }: {
    params: { tenantId?: string; policyId?: string };
    intent: string;
  }) => {
    const tenantId = params.tenantId;
    const policyId = params.policyId;

    if (intent === "initial" || !tenantId || !policyId) return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.item(tenantId, "policy", policyId)),
    ]);
  },
};

export default function PolicyDesignerPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const storageKey = () => `mattrax:designer:${params.policyId}`;
  const { can } = useCan();
  const writable = () => can("policies.write");

  const policy = useQuery(() => ({
    queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId),
    queryFn: () => enterprise.get(params.tenantId, "policy", params.policyId),
  }));

  const row = () => Option.getOrUndefined(decodePolicyRow(policy.data));

  // A disabled policy delivers nothing, so saving the designer into one would
  // look successful while changing nothing on devices. Block the save and
  // offer the explicit enable action instead.
  const enabled = () => isPolicyEnabled(row() ?? {});

  const configurations = () =>
    Option.getOrUndefined(decodeConfigurations(row()?.configurations)) ?? {};

  const [ready, setReady] = createSignal(false);
  const [replaceExisting, setReplaceExisting] = createSignal(false);

  /**
   * The designer keeps its source draft in the policy configuration alongside
   * the generated artifact, so edits survive a different browser or a cleared
   * localStorage. Older policies saved by the public handoff only have the
   * localStorage copy, so fall back to that first.
   */
  const configurationDraft = () => {
    let latest: PolicyDraft | undefined;

    for (const [kind, value] of Object.entries(configurations())) {
      if (!isDesignerConfiguration(kind, value)) continue;
      const draft = parsePolicyDraft(isRecord(value) ? value.draft : undefined);

      if (!draft) continue;

      if (!latest || (draft.savedAt ?? 0) > (latest.savedAt ?? 0)) latest = draft;
    }

    return latest;
  };

  const localStorageDraft = () =>
    typeof localStorage === "undefined"
      ? undefined
      : parsePolicyDraft(localStorage.getItem(storageKey()));

  /** Prefer whichever saved copy is actually newer. */
  const designerDraft = () => {
    const local = localStorageDraft();
    const saved = configurationDraft();

    if (!local) return saved;

    if (!saved) return local;

    return (local.savedAt ?? 0) > (saved.savedAt ?? 0) ? local : saved;
  };

  const foreignConfigurations = () =>
    Object.entries(configurations())
      .filter(([kind, value]) => !isDesignerConfiguration(kind, value))
      .map(([kind]) => kind);

  onSettled(() => {
    setReady(true);
  });

  const save = useMutation(() => ({
    mutationFn: (draft: PolicyDraft) => {
      const next = policyToConfigurations(draft);

      // Designer configurations are replaced as a set. Advanced-editor
      // configurations are only deleted after the explicit replacement
      // confirmation, so saving the designer cannot silently drop them.
      for (const [kind, value] of Object.entries(configurations())) {
        if (kind in next) continue;

        if (isDesignerConfiguration(kind, value)) next[kind] = null;
        else if (replaceExisting()) next[kind] = null;
      }

      return enterprise.patchPolicy(params.tenantId, params.policyId, {
        name: row()?.name,
        configurations: next,
      });
    },
    onSuccess: (_result, draft) => {
      localStorage.setItem(storageKey(), JSON.stringify(draft));

      // Navigate before the refreshes settle: awaiting them keeps the mutation
      // pending (and can reject on a suspended read) so the route never
      // changes, while the policy page re-reads the cached item itself.
      void qc.invalidateQueries({
        queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId),
      });
      void qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "policy") });
      navigate(`/t/${params.tenantId}/policies/${params.policyId}`);
    },
  }));

  const enable = useMutation(() => ({
    mutationFn: () => enterprise.patchPolicy(params.tenantId, params.policyId, { enabled: true }),
    onSuccess: () => {
      toast.success("Policy enabled", {
        description: "Its saved configuration is being delivered to scoped devices again.",
      });
      void qc.invalidateQueries({
        queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId),
      });
      void qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "policy") });
    },
    onError: (error) =>
      toast.error("Could not enable the policy", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      }),
  }));

  const pageActions = () => (
    <Button
      as="a"
      size="sm"
      variant="ghost"
      href={`/t/${params.tenantId}/policies/${params.policyId}`}
      class="-ml-2 gap-1.5 text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft class="size-3.5" />
      Back to policy
    </Button>
  );

  return (
    <Errored
      fallback={(error, reset) => (
        <div class="p-4">
          <ErrorPanel
            boundary="policy-editor"
            error={error()}
            reset={reset}
            label="Policy editor"
          />
        </div>
      )}
    >
      <div
        data-policy-designer
        class="flex h-[calc(100svh-92px)] max-h-[calc(100svh-92px)] min-h-0 shrink-0 flex-col overflow-hidden bg-background"
      >
        <Show
          when={ready() && policy.data}
          fallback={
            <Show
              when={policy.isError}
              fallback={
                <div class="m-6 rounded-lg border border-border bg-card p-6 text-[13px] text-muted-foreground">
                  Loading the policy…
                </div>
              }
            >
              <div class="m-6">
                <QueryError error={policy.error} onRetry={() => void policy.refetch()} />
              </div>
            </Show>
          }
        >
          <Show when={row() && !enabled()}>
            <div class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-warning/25 bg-warning/[0.07] px-3 py-2 text-[12px] text-foreground sm:px-4">
              <div class="min-w-0 flex-1">
                <p class="font-semibold">This policy is disabled</p>
                <p class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  Saving here is blocked because a disabled policy delivers nothing. Its
                  configuration and assignments are kept; enable it to deploy designer changes.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!writable() || enable.isPending}
                onClick={() => enable.mutate()}
              >
                {enable.isPending ? "Enabling…" : "Enable policy"}
              </Button>
            </div>
          </Show>

          <Show when={foreignConfigurations().length > 0}>
            <div class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-3 py-2 text-[12px] text-foreground sm:px-4">
              <div class="min-w-0 flex-1">
                <p class="font-semibold">This policy also has settings from the policy editor</p>
                <p class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  Saving here updates the designer configurations and keeps them. Settings generated
                  by the designer are device-scoped; add user-scoped settings in the policy editor.
                </p>
              </div>
              <label class="flex w-full cursor-pointer items-start gap-2 text-[12px] sm:w-auto sm:items-center">
                <input
                  type="checkbox"
                  class="mt-0.5 size-3.5 shrink-0 accent-[var(--warning)] sm:mt-0"
                  checked={replaceExisting()}
                  onChange={(event) => setReplaceExisting(event.currentTarget.checked)}
                />
                Also replace the policy editor configurations
              </label>
            </div>
          </Show>

          <Show when={!writable()}>
            <div class="shrink-0 border-b border-border px-3 py-2 sm:px-4">
              <ReadOnlyNotice>
                Your role can view this policy designer but not save changes.
              </ReadOnlyNotice>
            </div>
          </Show>

          {/* Remount per policy: the designer holds its draft in local state,
              so a reused route would otherwise keep the previous policy's
              selections when both policies are already cached. */}
          <Show keyed when={params.policyId}>
            {(_policyId) => (
              <PolicyDesigner
                mode="dashboard"
                pageActions={pageActions()}
                initialDraft={designerDraft() ?? emptyPolicyDraft(row()?.name ?? "My MDM policy")}
                persistedDraft={
                  configurationDraft() ?? emptyPolicyDraft(row()?.name ?? "My MDM policy")
                }
                storageKey={storageKey()}
                saving={save.isPending}
                saveDisabled={!writable() || !enabled()}
                disabledHint={
                  !enabled()
                    ? "Enable the policy to save designer changes."
                    : !writable()
                      ? "Your role cannot save policies."
                      : undefined
                }
                canDeploy={writable() && enabled()}
                error={save.error}
                onSave={
                  writable() && enabled()
                    ? (draft) => {
                        void save.mutate(draft);
                      }
                    : undefined
                }
              />
            )}
          </Show>
        </Show>
      </div>
    </Errored>
  );
}
