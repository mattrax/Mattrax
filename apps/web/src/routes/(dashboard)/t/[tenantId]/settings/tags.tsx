import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import type { ScopeTag } from "@mattrax/enterprise-domain/client";
import { ErrorText, Field, Panel, QueryError } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import { AccessDenied, ReadOnlyNotice, useCan } from "~/lib/permissions";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.scopeTags(params.tenantId)),
    ]);
  },
};

const textareaClass =
  "min-h-20 w-full rounded-lg border border-input bg-transparent p-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

export default function ScopeTagsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [editing, setEditing] = createSignal<ScopeTag | null>(null);
  const [editName, setEditName] = createSignal("");
  const [editDescription, setEditDescription] = createSignal("");
  const [deleting, setDeleting] = createSignal<ScopeTag | null>(null);

  const tags = useQuery(() => enterpriseQueries.scopeTags(params.tenantId));

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: enterpriseKeys.scopeTags(params.tenantId) });
    await qc.invalidateQueries({
      queryKey: enterpriseKeys.scopeTagAssignmentsPrefix(params.tenantId),
    });
    await qc.invalidateQueries({ queryKey: enterpriseKeys.accounts(params.tenantId) });
  };

  const create = useMutation(() => ({
    mutationFn: () =>
      enterprise.createScopeTag(params.tenantId, {
        name: name().trim(),
        description: description().trim() || null,
      }),
    onSuccess: async () => {
      setName("");
      setDescription("");
      await refresh();
    },
  }));

  const update = useMutation(() => ({
    mutationFn: () => {
      const tag = editing();

      if (!tag) throw new Error("No scope tag selected");

      return enterprise.patchScopeTag(params.tenantId, tag.id, {
        name: editName().trim(),
        description: editDescription().trim() || null,
      });
    },
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
  }));

  const remove = useMutation(() => ({
    mutationFn: () => {
      const tag = deleting();

      if (!tag) throw new Error("No scope tag selected");

      return enterprise.deleteScopeTag(params.tenantId, tag.id);
    },
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
    },
  }));

  const openEdit = (tag: ScopeTag) => {
    setEditing(tag);
    setEditName(tag.name);
    setEditDescription(tag.description ?? "");
  };

  return (
    <Show when={can("scope_tags.read")} fallback={<AccessDenied />}>
      <div class="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-6 sm:px-7 lg:px-8">
        <Show when={!can("scope_tags.write")}>
          <ReadOnlyNotice>
            You can see scope tags, but your role cannot create or change them.
          </ReadOnlyNotice>
        </Show>

        <Panel
          title="Create a scope tag"
          description="Name a region or team. Assign it to resources, then give delegated administrators only those tags."
        >
          <form
            class="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <div class="grid gap-4 sm:grid-cols-2">
              <Field label="Name" hint="Unique in this tenant, up to 64 characters.">
                <Input
                  required
                  maxlength={64}
                  disabled={!can("scope_tags.write")}
                  value={name()}
                  onInput={(event) => setName(event.currentTarget.value)}
                  placeholder="Europe"
                />
              </Field>
              <Field label="Description" hint="Optional; shown to administrators choosing a tag.">
                <textarea
                  class={textareaClass}
                  maxlength={500}
                  disabled={!can("scope_tags.write")}
                  value={description()}
                  onInput={(event) => setDescription(event.currentTarget.value)}
                  placeholder="Devices and policies managed by the European IT team."
                />
              </Field>
            </div>
            <ErrorText error={create.error} />
            <Button type="submit" disabled={!can("scope_tags.write") || create.isPending}>
              {create.isPending ? "Creating…" : "Create scope tag"}
            </Button>
          </form>
        </Panel>

        <Panel
          title="Tags in this tenant"
          description="Delete a tag only after removing it from every administrator; tags on resources are removed when the tag is deleted."
          actions={
            <span class="text-[11.5px] tabular-nums text-muted-foreground">
              {tags.data?.tags.length ?? 0} tag{tags.data?.tags.length === 1 ? "" : "s"}
            </span>
          }
          flush
        >
          <Show
            when={!tags.isError}
            fallback={
              <div class="p-4 sm:p-5">
                <QueryError error={tags.error} onRetry={() => void tags.refetch()} />
              </div>
            }
          >
            <Show
              when={(tags.data?.tags.length ?? 0) > 0}
              fallback={
                <div class="px-4 py-10 text-center sm:px-5">
                  <p class="text-[13px] font-medium text-foreground">No scope tags yet</p>
                  <p class="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-muted-foreground">
                    Tags are optional. Without one, every administrator sees every resource. Create
                    a tag to delegate a region or team without splitting the tenant.
                  </p>
                </div>
              }
            >
              <ul class="divide-y divide-border">
                <For each={tags.data?.tags ?? []}>
                  {(tag) => (
                    <li class="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                          <h3 class="truncate text-[13px] font-medium text-foreground">
                            {tag.name}
                          </h3>
                          <span class="rounded-full border border-border px-2 py-0.5 text-[10.5px] tabular-nums text-muted-foreground">
                            {tag.resourceCount} resource{tag.resourceCount === 1 ? "" : "s"}
                          </span>
                          <span class="rounded-full border border-border px-2 py-0.5 text-[10.5px] tabular-nums text-muted-foreground">
                            {tag.memberCount} administrator{tag.memberCount === 1 ? "" : "s"}
                          </span>
                        </div>
                        <Show when={tag.description}>
                          <p class="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
                            {tag.description}
                          </p>
                        </Show>
                      </div>
                      <div class="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!can("scope_tags.write")}
                          onClick={() => openEdit(tag)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          class="text-destructive"
                          disabled={!can("scope_tags.write")}
                          onClick={() => setDeleting(tag)}
                        >
                          Delete
                        </Button>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </Panel>

        <Dialog open={editing() !== null} onOpenChange={(open) => !open && setEditing(null)}>
          <DialogContent class="max-w-md rounded-lg p-6">
            <DialogHeader>
              <DialogTitle>Edit scope tag</DialogTitle>
              <DialogDescription>
                Renaming a tag changes only its label; every resource and administrator keeps it.
              </DialogDescription>
            </DialogHeader>
            <form
              class="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                update.mutate();
              }}
            >
              <Field label="Name">
                <Input
                  required
                  maxlength={64}
                  value={editName()}
                  onInput={(event) => setEditName(event.currentTarget.value)}
                />
              </Field>
              <Field label="Description">
                <textarea
                  class={textareaClass}
                  maxlength={500}
                  value={editDescription()}
                  onInput={(event) => setEditDescription(event.currentTarget.value)}
                />
              </Field>
              <ErrorText error={update.error} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={update.isPending}>
                  {update.isPending ? "Saving…" : "Save changes"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={deleting() !== null}
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Delete "${deleting()?.name ?? ""}"?`}
          description="Resources carrying this tag become untagged and therefore visible to every administrator. Administrators assigned this tag must be moved to another tag first."
          confirmLabel="Delete tag"
          destructive
          pending={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate()}
        />
      </div>
    </Show>
  );
}
