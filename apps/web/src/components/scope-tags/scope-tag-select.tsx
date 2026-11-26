import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import { useCan } from "~/lib/permissions";
import { cn } from "~/lib/utils";
import { Input } from "~/components/ui/input";

export type ScopeTagResourceType =
  | "device"
  | "group"
  | "policy"
  | "application"
  | "script"
  | "dashboard";

const resourceNoun: Record<ScopeTagResourceType, string> = {
  device: "device",
  group: "group",
  policy: "policy",
  application: "application",
  script: "script",
  dashboard: "dashboard",
};

/**
 * Checkbox list of the tenant's scope tags.
 *
 * A resource with no tags is tenant-wide, so the empty state says that plainly
 * rather than looking like an unfinished field. The component is used by the
 * create forms (where the selection is applied after the resource exists) and
 * by the bulk tagging dialog.
 */
export function ScopeTagSelect(props: {
  tenantId: string;
  value: ReadonlyArray<string>;
  onChange: (tagIds: Array<string>) => void;
  disabled?: boolean;
  legend?: string;
  hint?: string;
  class?: string;
}) {
  const tags = useQuery(() => enterpriseQueries.scopeTags(props.tenantId));

  const toggle = (tagId: string) => {
    const next = new Set(props.value);

    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);

    props.onChange([...next]);
  };

  return (
    <fieldset
      class={cn("min-w-0 space-y-2", props.class)}
      disabled={props.disabled}
      aria-describedby={props.hint ? "scope-tag-select-hint" : undefined}
    >
      <legend class="text-xs font-medium text-foreground">
        {props.legend ?? "Scope tags"}
      </legend>
      <Show
        when={(tags.data?.tags.length ?? 0) > 0}
        fallback={
          <p class="rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <Show
              when={!tags.isPending}
              fallback={<>Loading scope tags…</>}
            >
              No scope tags exist yet. Create one in Settings → Scope tags, or leave this resource
              untagged so every administrator can see it.
            </Show>
          </p>
        }
      >
        <div class="grid gap-1.5 sm:grid-cols-2">
          <For each={tags.data?.tags ?? []}>
            {(tag) => {
              const checked = createMemo(() => props.value.includes(tag.id));

              return (
                <label
                  class={cn(
                    "flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs transition-colors duration-150 ease-swift",
                    checked()
                      ? "border-ring/50 bg-active text-foreground"
                      : "border-border bg-surface text-muted-foreground hover:bg-hover",
                  )}
                >
                  <Input
                    type="checkbox"
                    class="mt-0.5 size-3.5"
                    checked={checked()}
                    onChange={() => toggle(tag.id)}
                  />
                  <span class="min-w-0">
                    <span class="block truncate font-medium text-foreground">{tag.name}</span>
                    <Show when={tag.description}>
                      <span class="mt-0.5 block text-xs leading-snug text-muted-foreground">
                        {tag.description}
                      </span>
                    </Show>
                  </span>
                </label>
              );
            }}
          </For>
        </div>
      </Show>
      <p id="scope-tag-select-hint" class="text-xs leading-relaxed text-muted-foreground">
        {props.hint ??
          "Only administrators whose role covers these tags can see the resource. An untagged resource is visible to every administrator in the tenant."}
      </p>
    </fieldset>
  );
}

/** Read-only tag chips for a resource row or header. */
export function ScopeTagBadges(props: {
  tenantId: string;
  tagIds: ReadonlyArray<string>;
  class?: string;
}) {
  const tags = useQuery(() => enterpriseQueries.scopeTags(props.tenantId));

  const names = createMemo(() => {
    const byId = new Map((tags.data?.tags ?? []).map((tag) => [tag.id, tag.name]));

    return props.tagIds.map((id) => byId.get(id)).filter((name): name is string => Boolean(name));
  });

  return (
    <Show when={props.tagIds.length > 0} fallback={<span class="text-muted-foreground">—</span>}>
      <div class={cn("flex flex-wrap items-center gap-1", props.class)}>
        <For each={names()}>
          {(name) => (
            <Badge variant="secondary" class="max-w-40">
              {name}
            </Badge>
          )}
        </For>
      </div>
    </Show>
  );
}

/**
 * Edit the tags on an existing set of resources.
 *
 * Saving replaces the tags atomically. A scoped administrator cannot remove
 * every tag (the API refuses it) because an untagged resource would become
 * tenant-wide.
 */
export function ScopeTagAssignmentEditor(props: {
  tenantId: string;
  resourceType: ScopeTagResourceType;
  resourceIds: ReadonlyArray<string>;
  onSaved?: () => void;
  saveLabel?: string;
  class?: string;
}) {
  const qc = useQueryClient();
  const { can } = useCan();
  // The assignment read needs scope_tags.read. A role without it still has to
  // open the resource, so skip the request rather than failing the page with a
  // forbidden error from a card the operator cannot use.
  const readable = () => can("scope_tags.read");
  const current = useQuery(() => ({
    ...enterpriseQueries.scopeTagAssignments(props.tenantId, props.resourceType, props.resourceIds),
    enabled: readable(),
  }));
  const [selected, setSelected] = createSignal<Array<string> | null>(null);
  const [saveError, setSaveError] = createSignal<unknown>();
  const ids = createMemo(() => [...new Set(props.resourceIds)]);

  // A different selection is a different edit; discard the previous local
  // choice instead of applying it to the new rows.
  createEffect(
    () => ids().join(","),
    () => {
      setSelected(null);
      setSaveError(undefined);
    },
  );

  const value = createMemo(() => {
    const chosen = selected();

    if (chosen) return chosen;

    const assignments = current.data?.assignments ?? [];
    const common = assignments.length > 0 ? new Set(assignments[0].tagIds) : new Set<string>();

    for (const assignment of assignments)
      for (const tagId of common)
        if (!assignment.tagIds.includes(tagId)) common.delete(tagId);

    return [...common];
  });

  const noun = () => resourceNoun[props.resourceType];

  if (!readable())
    return (
      <p class={cn("rounded-lg border border-border bg-surface p-3 text-xs text-muted-foreground", props.class)}>
        Your role cannot view this resource's scope tags.
      </p>
    );

  return (
    <div class={cn("space-y-3", props.class)}>
      <ScopeTagSelect
        tenantId={props.tenantId}
        value={value()}
        onChange={setSelected}
        disabled={current.isPending || current.isError || !can("scope_tags.write")}
        legend={`Scope tags for ${props.resourceIds.length === 1 ? "this" : "the selected"} ${noun()}${props.resourceIds.length === 1 ? "" : "s"}`}
      />
      <div class="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={current.isPending || current.isError || !can("scope_tags.write")}
          onClick={async () => {
            setSaveError(undefined);

            try {
              // The API bounds one request at 200 resources so a bulk paste
              // cannot lock a tenant table. Chunk a select-all-matching set.
              for (let index = 0; index < ids().length; index += 200)
                await enterprise.setScopeTagAssignments(props.tenantId, {
                  resourceType: props.resourceType,
                  resourceIds: ids().slice(index, index + 200),
                  tagIds: value(),
                });

              setSelected(null);
              await qc.invalidateQueries({
                queryKey: enterpriseKeys.scopeTagAssignmentsPrefix(props.tenantId),
              });
              await qc.invalidateQueries({ queryKey: enterpriseKeys.scopeTags(props.tenantId) });
              props.onSaved?.();
            } catch (error) {
              setSaveError(error);
            }
          }}
        >
          {props.saveLabel ?? "Save tags"}
        </Button>
        <Show when={current.isError}>
          <span class="text-xs text-destructive">
            Could not load the current tags. Reload before saving.
          </span>
        </Show>
        <Show when={saveError()}>
          <span role="alert" class="text-xs text-destructive">
            Could not save the tags. Try again.
          </span>
        </Show>
        <Show when={current.data?.assignments.length === 0}>
          <span class="text-xs text-muted-foreground">
            {props.resourceIds.length === 1 ? "This" : "These"} {noun()}
            {props.resourceIds.length === 1 ? " is" : "s are"} currently untagged and tenant-wide.
          </span>
        </Show>
      </div>
    </div>
  );
}
