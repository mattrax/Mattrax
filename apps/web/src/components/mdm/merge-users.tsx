import { Checkbox } from "@mattrax/ui";
import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show, createMemo, createSignal, createUniqueId } from "solid-js";
import { isServer } from "@solidjs/web";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { GitMerge, Search } from "~/components/ui/icons";
import { toast } from "~/components/toast";
import { EmptyState, ErrorText } from "./common";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type {
  DirectoryUserMergeCandidate,
  DirectoryUserMergePreview,
  DirectoryUserRef,
  UserDetail,
  UserMergeCounts,
} from "~/lib/enterprise";

const SOURCE_LABELS: Record<DirectoryUserRef["source"], string> = {
  entra: "Entra ID",
  google: "Google Workspace",
  scim: "SCIM",
  manual: "Manual",
};

const REASON_LABELS: Record<DirectoryUserMergeCandidate["reasons"][number], string> = {
  "previously-merged": "Previously merged",
  "same-email": "Same email",
};

const COUNT_LABELS: Array<[keyof UserMergeCounts, string, string]> = [
  ["deviceLinks", "device link", "device links"],
  ["groupMemberships", "group membership", "group memberships"],
  ["directPolicies", "direct policy", "direct policies"],
  ["groupExclusions", "group exclusion", "group exclusions"],
  ["appleUserChannels", "Apple user channel", "Apple user channels"],
];

/** "2 device links · 1 group membership", omitting zero counts. */
export const formatMergeCounts = (counts: UserMergeCounts): string => {
  const parts = COUNT_LABELS.flatMap(([key, one, many]) => {
    const value = counts[key];

    return value > 0 ? [`${value} ${value === 1 ? one : many}`] : [];
  });

  return parts.length > 0 ? parts.join(" · ") : "No rows move";
};

const UserLabel = (props: { user: DirectoryUserRef }) => (
  <span class="flex min-w-0 flex-col">
    <span class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span class="truncate text-xs font-medium text-foreground">{props.user.name}</span>
      <Show when={props.user.disabled}>
        <Badge variant="outline">Disabled</Badge>
      </Show>
      <Show when={props.user.linked}>
        <Badge variant="brand">SSO linked</Badge>
      </Show>
    </span>
    <span class="truncate text-xs text-muted-foreground">
      {props.user.email} · {SOURCE_LABELS[props.user.source]}
    </span>
  </span>
);

function SourceRow(props: {
  id: string;
  user: DirectoryUserRef;
  hint?: string;
  reasons?: ReadonlyArray<DirectoryUserMergeCandidate["reasons"][number]>;
  checked: boolean;
  disabled?: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <li class="flex items-start gap-2.5 px-3 py-2">
      <Checkbox
        id={props.id}
        class="mt-0.5 size-3.5 shrink-0"
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={(checked) => props.onToggle(checked === true)}
      />
      <label for={props.id} class="min-w-0 flex-1 cursor-pointer">
        <UserLabel user={props.user} />
        <Show when={props.hint}>
          <span class="mt-0.5 block text-xs text-muted-foreground">{props.hint}</span>
        </Show>
        <Show when={(props.reasons?.length ?? 0) > 0}>
          <span class="mt-1 flex flex-wrap gap-1">
            <For each={props.reasons}>
              {(reason) => <Badge variant="outline">{REASON_LABELS[reason]}</Badge>}
            </For>
          </span>
        </Show>
      </label>
    </li>
  );
}

function PreviewSummary(props: { preview: DirectoryUserMergePreview }) {
  return (
    <div class="space-y-2">
      <ul class="divide-y divide-border rounded-lg border border-border">
        <For each={props.preview.sources}>
          {(source) => (
            <li class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-3 py-2">
              <UserLabel user={source.user} />
              <span class="text-xs tabular-nums text-muted-foreground">
                {formatMergeCounts(source.counts)}
              </span>
            </li>
          )}
        </For>
      </ul>

      <p class="text-xs leading-relaxed text-muted-foreground">
        Moving to <span class="font-medium text-foreground">{props.preview.target.name}</span>:{" "}
        {formatMergeCounts(props.preview.totals)}.
        <Show when={Object.values(props.preview.deduplicated).some((value) => value > 0)}>
          {" "}
          {formatMergeCounts(props.preview.deduplicated)} already exist on the target and stay as
          they are.
        </Show>
      </p>

      <Show when={props.preview.warnings.length > 0}>
        <ul class="space-y-1 rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2 text-xs leading-relaxed text-warning-foreground">
          <For each={props.preview.warnings}>{(warning) => <li>{warning}</li>}</For>
        </ul>
      </Show>
    </div>
  );
}

/**
 * Fold duplicate directory people into the person whose page opened this
 * dialog.
 *
 * The list of likely duplicates comes from the server (shared address, or an
 * object id/email this target absorbed in an earlier merge). The search below
 * it covers the rest of the tenant's directory for the case where the
 * provider recreated the person with entirely new details. Nothing is written
 * until the preview has been shown and, when the directory objects differ,
 * explicitly confirmed.
 */
export function MergeUsersDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: UserDetail;
}) {
  const params = useParams();
  const qc = useQueryClient();
  const idPrefix = createUniqueId();

  const [search, setSearch] = createSignal("");
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set());
  const [confirmed, setConfirmed] = createSignal(false);

  const targetId = () => props.target.id;

  const candidates = useQuery(() => ({
    ...enterpriseQueries.userMergeCandidates(params.tenantId, targetId()),
    enabled: props.open && !isServer,
  }));

  const directory = useQuery(() => ({
    ...enterpriseQueries.users(params.tenantId),
    enabled: props.open && !isServer,
  }));

  const selectedIds = createMemo(() =>
    [...selected()].sort((left, right) => left.localeCompare(right)),
  );

  const preview = useQuery(() => ({
    ...enterpriseQueries.userMergePreview(params.tenantId, targetId(), selectedIds()),
    enabled: props.open && selectedIds().length > 0 && !isServer,
  }));

  const candidateRows = createMemo(() => candidates.data?.candidates ?? []);
  const candidateIds = createMemo(() => new Set(candidateRows().map((row) => row.user.id)));

  const searchResults = createMemo(() => {
    const term = search().trim().toLowerCase();

    if (!term) return [];

    return (directory.data?.rows ?? [])
      .filter((row) => row.id !== targetId())
      .filter((row) => !candidateIds().has(row.id))
      .filter(
        (row) =>
          row.name.toLowerCase().includes(term) ||
          row.email.toLowerCase().includes(term) ||
          (row.externalId ?? "").toLowerCase().includes(term),
      )
      .slice(0, 20);
  });

  const otherUsers = createMemo(() => (directory.data?.rows ?? []).length - 1);

  const toggle = (userId: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);

      if (checked) next.add(userId);
      else next.delete(userId);

      return next;
    });

  const reset = () => {
    setSearch("");
    setSelected(new Set<string>());
    setConfirmed(false);
  };

  const merge = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: async () => {
      const ids = selectedIds();

      if (ids.length === 0) throw new Error("Select at least one duplicate directory user.");

      return enterprise.mergeDirectoryUsers(params.tenantId, targetId(), {
        sourceIds: ids,
        confirmExternalIdMismatch: confirmed(),
      });
    },
    onSuccess: async (result) => {
      if (result.status === "unchanged") {
        toast.info("Those users were already merged", {
          description: "The duplicate records were absorbed by an earlier merge.",
        });
      } else {
        const names = result.sources.map((source) => source.user.name).join(", ");

        toast.success(`Merged ${names} into ${result.target.name}`, {
          description: `${formatMergeCounts(result.totals)} moved.`,
        });
      }

      const mergedIds = result.sources.map((source) => source.user.id);

      reset();
      props.onOpenChange(false);

      await Promise.all([
        qc.invalidateQueries({ queryKey: enterpriseKeys.users(params.tenantId) }),
        qc.invalidateQueries({ queryKey: enterpriseKeys.user(params.tenantId, targetId()) }),
        qc.invalidateQueries({
          queryKey: enterpriseKeys.userMergeCandidates(params.tenantId, targetId()),
        }),
        qc.invalidateQueries({ queryKey: enterpriseKeys.directory(params.tenantId) }),
      ]);

      for (const id of mergedIds)
        qc.removeQueries({ queryKey: enterpriseKeys.user(params.tenantId, id) });
    },
  }));

  const busy = () => merge.isPending || preview.isFetching;

  const canMerge = () =>
    selectedIds().length > 0 &&
    preview.data !== undefined &&
    (!preview.data.requiresExternalIdConfirmation || confirmed());

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) reset();
        props.onOpenChange(open);
      }}
    >
      <DialogContent class="max-h-9/10 max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle class="flex items-center">
            <GitMerge class="size-4" />
            Merge duplicate directory people
          </DialogTitle>
          <DialogDescription>
            Choose the directory records that describe the same person as{" "}
            <span class="font-medium text-foreground">{props.target.name}</span>. Their device
            links, group memberships, policy assignments and exclusions move to this person, then
            the duplicate records are removed.
          </DialogDescription>
        </DialogHeader>

        <div class="mt-4 space-y-4">
          <section>
            <h3 class="text-xs font-medium text-foreground">Likely duplicates</h3>
            <Show
              when={!candidates.isPending}
              fallback={
                <p class="mt-1 text-xs text-muted-foreground">Looking for matches…</p>
              }
            >
              <Show
                when={candidateRows().length > 0}
                fallback={
                  <div class="mt-2">
                    <EmptyState
                      icon={GitMerge}
                      title="No likely duplicates"
                      description={
                        otherUsers() > 0
                          ? "Nothing in this directory shares an address with, or was previously merged into, this person. Search below to pick a record manually."
                          : "This is the only directory person in the tenant, so there is nothing to merge."
                      }
                    />
                  </div>
                }
              >
                <ul class="mt-2 divide-y divide-border rounded-lg border border-border">
                  <For each={candidateRows()}>
                    {(candidate) => (
                      <SourceRow
                        id={`${idPrefix}-candidate-${candidate.user.id}`}
                        user={candidate.user}
                        reasons={candidate.reasons}
                        hint={
                          candidate.reasons.includes("previously-merged")
                            ? "This record matches one an earlier merge absorbed, so the provider likely recreated it."
                            : undefined
                        }
                        checked={selected().has(candidate.user.id)}
                        onToggle={(checked) => toggle(candidate.user.id, checked)}
                      />
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
            <Show when={candidates.isError}>
              <ErrorText error={candidates.error} />
            </Show>
          </section>

          <Show when={otherUsers() > 0}>
            <section>
              <h3 class="text-xs font-medium text-foreground">Other directory people</h3>
              <div class="relative mt-2">
                <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
                <Input
                  value={search()}
                  onInput={(event) => setSearch(event.currentTarget.value)}
                  placeholder="Search by name, email or external id…"
                  class="w-full"
                  aria-label="Search directory people to merge"
                />
              </div>
              <Show when={search().trim().length > 0}>
                <Show
                  when={searchResults().length > 0}
                  fallback={
                    <p class="mt-2 text-xs text-muted-foreground">
                      No other directory person matches “{search().trim()}”.
                    </p>
                  }
                >
                  <ul class="mt-2 divide-y divide-border rounded-lg border border-border">
                    <For each={searchResults()}>
                      {(row) => (
                        <SourceRow
                          id={`${idPrefix}-search-${row.id}`}
                          user={{
                            id: row.id,
                            name: row.name,
                            email: row.email,
                            externalId: row.externalId ?? null,
                            source: row.source,
                            disabled: row.disabled,
                            linked: row.linked,
                          }}
                          hint={row.disabled ? "Disabled directory person" : undefined}
                          checked={selected().has(row.id)}
                          onToggle={(checked) => toggle(row.id, checked)}
                        />
                      )}
                    </For>
                  </ul>
                </Show>
              </Show>
            </section>
          </Show>

          <Show when={selectedIds().length > 0}>
            <section>
              <h3 class="text-xs font-medium text-foreground">What will move</h3>
              <div class="mt-2">
                <Show
                  when={!preview.isPending}
                  fallback={<p class="text-xs text-muted-foreground">Building preview…</p>}
                >
                  <>
                    <Show when={preview.data}>
                      {(value) => <PreviewSummary preview={value()} />}
                    </Show>
                    <Show when={preview.isError}>
                      <ErrorText error={preview.error} />
                    </Show>
                  </>
                </Show>
              </div>

              <Show when={preview.data?.requiresExternalIdConfirmation}>
                <label class="mt-2 flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-foreground">
                  <Checkbox
                    class="mt-0.5 size-3.5"
                    checked={confirmed()}
                    onCheckedChange={(checked) => setConfirmed(checked === true)}
                  />
                  <span>
                    I understand these records report different directory object ids. They describe
                    the same person and should be merged.
                  </span>
                </label>
              </Show>

              <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
                Directory sync may recreate the duplicate it no longer sees. The merge still
                completes; the recreated record then appears under “Likely duplicates” so it can be
                merged again.
              </p>
            </section>
          </Show>

          <ErrorText error={merge.error} />
        </div>

        <DialogFooter class="mt-4 flex-row justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={merge.isPending}
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={!canMerge() || busy()} onClick={() => merge.mutate()}>
            {merge.isPending
              ? "Merging…"
              : selectedIds().length > 0
                ? `Merge ${selectedIds().length} ${selectedIds().length === 1 ? "user" : "users"}`
                : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Sidebar banner on the detail page when the directory likely duplicates it. */
export function MergeDuplicateNotice(props: {
  candidates: ReadonlyArray<DirectoryUserMergeCandidate>;
  onOpen: () => void;
}) {
  return (
    <div class="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-brand/25 bg-brand/[0.06] px-4 py-3">
      <div class="flex min-w-0 items-start gap-2">
        <GitMerge class="mt-0.5 size-4 shrink-0" />
        <div class="min-w-0">
          <p class="text-xs font-medium text-foreground">
            {props.candidates.length === 1
              ? "A directory record likely duplicates this person"
              : `${props.candidates.length} directory records likely duplicate this person`}
          </p>
          <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {props.candidates
              .slice(0, 3)
              .map((candidate) => candidate.user.name)
              .join(", ")}
            <Show when={props.candidates.length > 3}> and more</Show>. Directory sync may have
            recreated someone who was merged before, or imported the same address twice.
          </p>
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={props.onOpen}>
        Review merge
      </Button>
    </div>
  );
}
