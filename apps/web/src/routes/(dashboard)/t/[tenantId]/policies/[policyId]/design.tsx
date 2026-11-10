import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, onSettled, Show } from "solid-js";
import { QueryError } from "~/components/mdm/common";
import { PolicyDesigner } from "~/components/mdm/policy-designer";
import { Button } from "~/components/ui/button";
import { ArrowLeft } from "~/components/ui/icons";
import { enterprise, enterpriseKeys, type PolicyRow } from "~/lib/enterprise";
import { artifactToConfigurations, type Draft } from "~/lib/policy-designer/build";
import type { PlatformId } from "~/lib/policy-designer/catalog";

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

const platformForKind = (kind: string): PlatformId | undefined => {
  if (kind === "mttx.apple.custom.designer" || kind.startsWith("mttx.apple.declaration."))
    return "apple";
  if (kind === "mttx.windows.custom.designer") return "windows";
  if (kind === "mttx.android.policy.designer") return "android";
  return undefined;
};

const platformLabel = (platform: PlatformId) =>
  platform.charAt(0).toUpperCase() + platform.slice(1);

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
  const [replaceOtherPlatforms, setReplaceOtherPlatforms] = createSignal(false);
  const [activePlatform, setActivePlatform] = createSignal<PlatformId>("apple");

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
  const localStorageDraft = () =>
    typeof localStorage === "undefined"
      ? undefined
      : parseDraft(localStorage.getItem(storageKey()));

  /**
   * Prefer whichever draft is actually newer. The autosave effect does not
   * rewrite the browser copy on mount, so a stale local draft can no longer
   * pose as newer than the policy and silently overwrite it.
   */
  const designerDraft = () => {
    const local = localStorageDraft();
    const saved = configurationDraft();
    if (!local) return saved;
    if (!saved) return local;
    return (local.savedAt ?? 0) > (saved.savedAt ?? 0) ? local : saved;
  };

  /** Rehydrate the saved draft for a platform when switching back to it. */
  const platformDrafts = () => {
    const drafts: Partial<Record<PlatformId, Draft>> = {};
    for (const [kind, value] of Object.entries(configurations())) {
      if (!isDesignerConfiguration(kind, value)) continue;
      const draft = parseDraft(isRecord(value) ? value.draft : undefined);
      if (!draft) continue;
      const platform = draft.platform ?? platformForKind(kind);
      if (!platform) continue;
      const existing = drafts[platform];
      if (!existing || (draft.savedAt ?? 0) > (existing.savedAt ?? 0)) drafts[platform] = draft;
    }
    return drafts;
  };

  const foreignConfigurations = () =>
    Object.entries(configurations())
      .filter(([kind, value]) => !isDesignerConfiguration(kind, value))
      .map(([kind]) => kind);
  const blocked = () => foreignConfigurations().length > 0 && !replaceExisting();

  /** Platforms with a designer configuration stored on the policy. */
  const savedDesignerPlatforms = () => {
    const platforms = new Set<PlatformId>();
    for (const [kind, value] of Object.entries(configurations())) {
      if (!isDesignerConfiguration(kind, value)) continue;
      const draft = parseDraft(isRecord(value) ? value.draft : undefined);
      const platform = draft?.platform ?? platformForKind(kind);
      if (platform) platforms.add(platform);
    }
    return [...platforms];
  };
  const otherPlatforms = () =>
    savedDesignerPlatforms().filter((platform) => platform !== activePlatform());

  createEffect(
    () => designerDraft(),
    (draft) => {
      if (draft) setActivePlatform(draft.platform);
    },
  );

  onSettled(() => {
    setReady(true);
  });

  const save = useMutation(() => ({
    mutationFn: (draft: Draft) => {
      const next = artifactToConfigurations(draft);
      // Designer declaration configurations are replaced as a set; delete the
      // ones that disappeared. Advanced-editor configurations are only deleted
      // after the explicit replacement confirmation. Designer configurations
      // saved for another platform are kept unless the user explicitly opts in
      // to replacing them, so a platform switch cannot silently delete them.
      for (const [kind, value] of Object.entries(configurations())) {
        if (kind in next) continue;
        if (isDesignerDeclaration(kind, value) || CUSTOM_DESIGNER_KINDS.has(kind)) {
          const platform = platformForKind(kind);
          if (platform && platform !== draft.platform && !replaceOtherPlatforms()) continue;
          next[kind] = null;
        } else if (replaceExisting() && !isDesignerConfiguration(kind, value)) {
          next[kind] = null;
        }
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

  const pageActions = () => (
    <>
      <Button
        as="a"
        size="icon-sm"
        variant="outline"
        href={`/t/${params.tenantId}/policies/${params.policyId}`}
        aria-label="Back to policy"
        title="Back to policy"
      >
        <ArrowLeft class="size-3.5" />
      </Button>
      <Button
        as="a"
        size="sm"
        variant="outline"
        href={`/t/${params.tenantId}/policies/${params.policyId}/editor`}
      >
        Advanced editor
      </Button>
    </>
  );

  return (
    <div data-policy-designer class="flex min-h-0 flex-1 flex-col overflow-hidden bg-stone-50">
      <Show
        when={ready() && policy.data}
        fallback={
          <Show
            when={policy.isError}
            fallback={
              <div class="m-6 rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-600">
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
        <Show when={foreignConfigurations().length > 0}>
          <div class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 sm:px-4">
            <div class="min-w-0 flex-1">
              <p class="font-semibold">This policy already has settings</p>
              <p class="mt-0.5 text-[11px] leading-relaxed">
                Saving from the designer replaces configurations created in the advanced editor.
                Export your artifact first, or confirm the replacement.
              </p>
            </div>
            <label class="flex w-full cursor-pointer items-start gap-2 text-[12px] sm:w-auto sm:items-center">
              <input
                type="checkbox"
                class="mt-0.5 size-3.5 shrink-0 accent-amber-700 sm:mt-0"
                checked={replaceExisting()}
                onChange={(event) => setReplaceExisting(event.currentTarget.checked)}
              />
              Replace the existing configurations when I save
            </label>
          </div>
        </Show>

        <Show when={otherPlatforms().length > 0}>
          <div class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-sky-200 bg-sky-50 px-3 py-2 text-[12px] text-sky-900 sm:px-4">
            <div class="min-w-0 flex-1">
              <p class="font-semibold">This policy has a saved designer configuration</p>
              <p class="mt-0.5 text-[11px] leading-relaxed">
                {otherPlatforms().map(platformLabel).join(" and ")} settings are stored on this
                policy. Saving this {platformLabel(activePlatform())} draft keeps them unless you
                choose to replace them.
              </p>
            </div>
            <label class="flex w-full cursor-pointer items-start gap-2 text-[12px] sm:w-auto sm:items-center">
              <input
                type="checkbox"
                class="mt-0.5 size-3.5 shrink-0 accent-sky-700 sm:mt-0"
                checked={replaceOtherPlatforms()}
                onChange={(event) => setReplaceOtherPlatforms(event.currentTarget.checked)}
              />
              Replace saved designer settings from other platforms when I save
            </label>
          </div>
        </Show>

        <PolicyDesigner
          mode="dashboard"
          pageActions={pageActions()}
          initialDraft={
            designerDraft() ?? {
              version: 1,
              platform: "apple",
              name: row()?.name ?? "My MDM policy",
              selections: [],
            }
          }
          persistedDraft={configurationDraft()}
          platformDrafts={platformDrafts()}
          storageKey={storageKey()}
          saving={save.isPending}
          saveDisabled={blocked()}
          error={save.error}
          onPlatformChange={setActivePlatform}
          onSave={(draft) => {
            void save.mutate(draft);
          }}
        />
      </Show>
    </div>
  );
}
