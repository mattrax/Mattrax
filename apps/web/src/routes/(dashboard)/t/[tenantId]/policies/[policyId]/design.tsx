import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, onSettled, Show } from "solid-js";
import { LinkButton, QueryError } from "~/components/mdm/common";
import { PolicyDesigner } from "~/components/mdm/policy-designer";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { enterprise, enterpriseKeys, type PolicyRow } from "~/lib/enterprise";
import { artifactToConfigurations, type Draft } from "~/lib/policy-designer/build";

const parseDraft = (value: unknown): Draft | undefined => {
  if (!value) return undefined;
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  const draft = parsed as Draft | undefined;
  return draft?.version === 1 && Array.isArray(draft.selections) ? draft : undefined;
};

const CUSTOM_DESIGNER_KINDS = new Set([
  "mttx.apple.custom.designer",
  "mttx.windows.custom.designer",
  "mttx.android.policy.designer",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDesignerDeclaration = (kind: string, value: unknown) =>
  kind.startsWith("mttx.apple.declaration.") && isRecord(value) && value.designer === true;

const isDesignerConfiguration = (kind: string, value: unknown) =>
  CUSTOM_DESIGNER_KINDS.has(kind) || isDesignerDeclaration(kind, value);

export default function PolicyDesignerPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const storageKey = () => `mattrax:designer:${params.policyId}`;
  const policy = useQuery(() => ({
    queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId),
    queryFn: () => enterprise.get(params.tenantId, "policy", params.policyId),
  }));
  const row = () => policy.data as PolicyRow | undefined;
  const configurations = () => row()?.configurations ?? {};
  const [ready, setReady] = createSignal(false);
  const [replaceExisting, setReplaceExisting] = createSignal(false);

  /**
   * The designer keeps its source draft in the policy configuration alongside
   * the generated artifact, so edits survive a different browser or a cleared
   * localStorage. Older policies saved by the public handoff only have the
   * localStorage copy, so fall back to that first.
   */
  const configurationDraft = () => {
    let latest: Draft | undefined;
    for (const [kind, value] of Object.entries(configurations())) {
      if (!isDesignerConfiguration(kind, value)) continue;
      const draft = parseDraft(isRecord(value) ? value.draft : undefined);
      if (!draft) continue;
      if (!latest || (draft.savedAt ?? 0) > (latest.savedAt ?? 0)) latest = draft;
    }
    return latest;
  };
  const designerDraft = () =>
    (typeof localStorage === "undefined"
      ? undefined
      : parseDraft(localStorage.getItem(storageKey()))) ?? configurationDraft();

  const foreignConfigurations = () =>
    Object.entries(configurations())
      .filter(([kind, value]) => !isDesignerConfiguration(kind, value))
      .map(([kind]) => kind);
  const blocked = () => foreignConfigurations().length > 0 && !replaceExisting();

  onSettled(() => {
    setReady(true);
  });

  const save = useMutation(() => ({
    mutationFn: (draft: Draft) => {
      const next = artifactToConfigurations(draft);
      // Designer declaration configurations are replaced as a set; delete the
      // ones that disappeared. Advanced-editor configurations are only deleted
      // after the explicit replacement confirmation.
      for (const [kind, value] of Object.entries(configurations())) {
        if (kind in next) continue;
        if (
          isDesignerDeclaration(kind, value) ||
          CUSTOM_DESIGNER_KINDS.has(kind) ||
          (replaceExisting() && !isDesignerConfiguration(kind, value))
        )
          next[kind] = null;
      }
      return enterprise.patchPolicy(params.tenantId, params.policyId, {
        name: row()?.name,
        configurations: next,
      });
    },
    onSuccess: async (_result, draft) => {
      localStorage.setItem(storageKey(), JSON.stringify(draft));
      await qc.invalidateQueries({
        queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId),
      });
      await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "policy") });
      navigate(`/t/${params.tenantId}/policies/${params.policyId}`);
    },
  }));

  return (
    <div class="flex flex-1 flex-col gap-4 p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs uppercase tracking-[0.16em] text-stone-400">Designer</p>
          <h1 class="text-2xl font-semibold tracking-tight text-stone-900">
            {row()?.name ?? "Policy designer"}
          </h1>
        </div>
        <div class="flex gap-2">
          <LinkButton
            href={`/t/${params.tenantId}/policies/${params.policyId}/editor`}
            variant="outline"
          >
            Advanced editor
          </LinkButton>
          <LinkButton href={`/t/${params.tenantId}/policies/${params.policyId}`} variant="outline">
            Back to policy
          </LinkButton>
        </div>
      </div>

      <Show
        when={ready() && policy.data}
        fallback={
          <Show
            when={policy.isError}
            fallback={
              <div class="rounded-xl border bg-white p-6 text-sm text-stone-500">
                Loading the policy…
              </div>
            }
          >
            <QueryError error={policy.error} onRetry={() => void policy.refetch()} />
          </Show>
        }
      >
        <Show when={foreignConfigurations().length > 0}>
          <Card class="border-amber-200 bg-amber-50">
            <CardHeader>
              <CardTitle class="text-base text-amber-900">
                This policy already has settings
              </CardTitle>
            </CardHeader>
            <CardContent class="space-y-3 text-sm text-amber-900">
              <p>
                Saving from the designer replaces configurations created in the advanced editor.
                Export your artifact first, or confirm the replacement below.
              </p>
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={replaceExisting()}
                  onChange={(event) => setReplaceExisting(event.currentTarget.checked)}
                />
                Replace the existing configurations when I save
              </label>
            </CardContent>
          </Card>
        </Show>

        <PolicyDesigner
          mode="dashboard"
          initialDraft={
            designerDraft() ?? {
              version: 1,
              platform: "apple",
              name: row()?.name ?? "My MDM policy",
              selections: [],
            }
          }
          storageKey={storageKey()}
          saving={save.isPending}
          saveDisabled={blocked()}
          error={save.error}
          onSave={(draft) => {
            void save.mutate(draft);
          }}
        />
      </Show>
    </div>
  );
}
