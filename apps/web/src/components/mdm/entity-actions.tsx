import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Match } from "effect";
import { createSignal, For, Show } from "solid-js";
import { toast } from "~/components/toast";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { ErrorText } from "./common";
import { useCan } from "~/lib/permissions";
import {
  enterprise,
  enterpriseKeys,
  type DeviceRow,
  type Entity,
  type GroupRow,
  type PolicyRow,
} from "~/lib/enterprise";
import { errorMessage, raisedFailure } from "~/lib/errors";

type Named = { id: string; name: string };

/** One row that a bulk action could not complete, with a readable reason. */
type BulkFailure = { id: string; name: string; reason: string };

type BulkOutcome = { succeeded: number; failed: BulkFailure[] };

const entityNoun = (entity: Entity, count: number) => {
  const plural = entity === "policy" ? "policies" : `${entity}s`;

  return `${count} ${count === 1 ? entity : plural}`;
};

const capitalise = (value: string) => value.slice(0, 1).toUpperCase() + value.slice(1);

/**
 * The API reports why a row was skipped. Translate the tagged reasons into
 * sentences; anything unrecognised is shown as sent rather than hidden.
 */
const failureReason = (reason: string) =>
  reason === "notFound" ? "No longer exists" : capitalise(reason.replace(/[_-]+/g, " "));

/**
 * Run one request per row with bounded concurrency and keep every outcome. A
 * single rejection must never discard the result of the rows that already
 * succeeded, and an "all matching" selection can be thousands of rows, so the
 * requests must not all be in flight at once.
 */
const BULK_REQUEST_CONCURRENCY = 6;

const settleRows = async <T,>(
  targets: readonly Named[],
  request: (id: string) => Promise<T>,
): Promise<BulkOutcome> => {
  const results: Array<PromiseSettledResult<T> | undefined> = Array.from({
    length: targets.length,
  });

  let next = 0;

  const worker = async () => {
    while (next < targets.length) {
      const index = next++;
      const target = targets[index]!;

      try {
        results[index] = { status: "fulfilled", value: await request(target.id) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(BULK_REQUEST_CONCURRENCY, targets.length) }, () => worker()),
  );

  const failed: BulkFailure[] = [];

  results.forEach((result, index) => {
    if (result?.status !== "rejected") return;

    const row = targets[index]!;

    failed.push({
      id: row.id,
      name: row.name,
      reason: errorMessage(raisedFailure(result.reason), "Request failed"),
    });
  });

  return { succeeded: targets.length - failed.length, failed };
};

const reasonDetails = (failed: readonly BulkFailure[]) =>
  failed.map((row) => `${row.name}: ${row.reason}`);

/**
 * Report a bulk outcome: a plain success, a warning naming what failed, or an
 * outright error when nothing worked. The failure list is kept on the toast so
 * the operator can see why, not just how many.
 */
const reportBulk = (entity: Entity, copy: { ok: string; fail: string }, outcome: BulkOutcome) => {
  const requested = outcome.succeeded + outcome.failed.length;

  if (outcome.failed.length === 0) {
    toast.success(`${capitalise(copy.ok)} ${entityNoun(entity, outcome.succeeded)}`);

    return;
  }

  if (outcome.succeeded === 0) {
    toast.error(`${capitalise(copy.fail)} ${entityNoun(entity, requested)}`, {
      details: reasonDetails(outcome.failed),
    });

    return;
  }

  toast.warning(`${capitalise(copy.ok)} ${outcome.succeeded} of ${entityNoun(entity, requested)}`, {
    description: `${capitalise(entityNoun(entity, outcome.failed.length))} did not complete.`,
    details: reasonDetails(outcome.failed),
  });
};

const confirmTarget = (rows: Named[], entity: string) =>
  rows.length > 3
    ? `Delete ${rows.length} ${entity === "policy" ? "policies" : `${entity}s`}`
    : rows.map((row) => row.name).join(", ");

function ConfirmAction(props: {
  title: string;
  description: string;
  target: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = createSignal(false);
  const [value, setValue] = createSignal("");

  const mutation = useMutation(() => ({
    mutationFn: props.onConfirm,
    onSuccess: () => {
      setValue("");
      setOpen(false);
    },
  }));

  return (
    <>
      <Button variant={props.destructive ? "destructive" : "outline"} onClick={() => setOpen(true)}>
        {props.title}
      </Button>
      <Dialog open={open()} onOpenChange={setOpen}>
        <DialogContent class="max-w-md rounded-lg border border-border bg-popover p-6">
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            <DialogDescription>{props.description}</DialogDescription>
          </DialogHeader>
          <div class="space-y-2">
            <p class="text-sm">
              Type <span class="font-mono font-semibold">{props.target}</span> to confirm.
            </p>
            <Input
              aria-label={`Type ${props.target} to confirm`}
              value={value()}
              onInput={(e) => setValue(e.currentTarget.value)}
            />
          </div>
          <ErrorText error={mutation.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={props.destructive ? "destructive" : "default"}
              disabled={value() !== props.target || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ScopeGroupsAction(props: {
  targets: () => Promise<Named[]>;
  relation: "devices" | "policies";
}) {
  const params = useParams();
  const qc = useQueryClient();
  const [open, setOpen] = createSignal(false);
  const [changes, setChanges] = createSignal<Record<string, "all" | "none">>({});

  const groups = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "group"),
    queryFn: () => enterprise.list(params.tenantId, "group"),
  }));

  const groupRows = () => groups.data?.rows ?? [];
  const groupName = (id: string) => groupRows().find((group) => group.id === id)?.name ?? id;

  const patch = useMutation(() => ({
    mutationFn: async () => {
      const entries = Object.entries(changes());
      const selected = (await props.targets()).map((row) => row.id);

      const results = await Promise.allSettled(
        entries.map(([groupId, state]) =>
          enterprise.patchGroupMembers(
            params.tenantId,
            groupId,
            state === "all"
              ? { assign: { [props.relation]: selected } }
              : { unassign: { [props.relation]: selected } },
          ),
        ),
      );

      const failed: BulkFailure[] = [];

      results.forEach((result, index) => {
        if (result.status !== "rejected") return;

        const id = entries[index]![0];

        failed.push({
          id,
          name: groupName(id),
          reason: errorMessage(raisedFailure(result.reason), "Update failed"),
        });
      });

      // Nothing applied: keep the popover open with the inline error so the
      // operator can retry without reselecting anything.
      if (failed.length === entries.length) throw new Error(failed[0]!.reason);

      return { total: entries.length, failed };
    },
    onSuccess: async ({ total, failed }) => {
      setChanges({});
      setOpen(false);

      if (failed.length === 0) toast.success("Group assignments updated");
      else
        toast.warning(`Group assignments updated for ${total - failed.length} of ${total} groups`, {
          description: `${failed.length === 1 ? "One group" : `${failed.length} groups`} could not be updated.`,
          details: reasonDetails(failed),
        });

      await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "group") });
      await qc.invalidateQueries({ queryKey: ["enterprise", "device-search"] });
    },
  }));

  return (
    <div class="relative">
      <Button
        variant="outline"
        size="sm"
        aria-label="Assign selected rows to groups"
        aria-expanded={open() ? "true" : "false"}
        onClick={() => setOpen((value) => !value)}
      >
        Scope
      </Button>
      <Show when={open()}>
        <div class="fixed bottom-24 left-1/2 z-50 max-h-[60vh] w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 overflow-y-auto rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl">
          <For each={groupRows()}>
            {(group) => (
              <button
                type="button"
                onClick={() =>
                  setChanges((value) => ({
                    ...value,
                    [group.id]: value[group.id] === "all" ? "none" : "all",
                  }))
                }
                class="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-[12.5px] outline-none hover:bg-hover focus-visible:bg-hover"
              >
                <span>{group.name}</span>
                <span class="text-muted-foreground">
                  {Match.value(changes()[group.id]).pipe(
                    Match.when("all", () => "Assign"),
                    Match.when("none", () => "Remove"),
                    Match.orElse(() => ""),
                  )}
                </span>
              </button>
            )}
          </For>
          <ErrorText error={patch.error ?? groups.error} />
          <div class="mt-1 flex items-center justify-between gap-2 border-t border-border px-2 pb-1 pt-2">
            <Button
              size="sm"
              disabled={Object.keys(changes()).length === 0 || patch.isPending}
              onClick={() => patch.mutate()}
            >
              Apply
            </Button>
          </div>
        </div>
      </Show>
    </div>
  );
}

export function EntityActions(props: {
  entity: Entity;
  selected: Array<DeviceRow | GroupRow | PolicyRow>;
  clear: () => void;
  /** Replaces the table selection, used to keep failed rows selected. */
  select: (ids: readonly string[]) => void;
  /** True when the operator chose every row matching the active filter. */
  allMatching?: boolean;
  /** Number of rows the active filter matches. */
  total?: number;
  /** Resolves the filtered rows to explicit ids, for "select all matching". */
  resolveAll?: () => Promise<Named[]>;
}) {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const rows = (): Named[] => props.selected.map((row) => ({ id: row.id, name: row.name }));
  const count = () => (props.allMatching ? (props.total ?? rows().length) : rows().length);

  /**
   * The rows the action should touch. An "all matching" selection asks the
   * server for the rest of the filtered set; a partial selection keeps using
   * the rows the operator can see.
   */
  const targets = async (): Promise<Named[]> => {
    if (!props.allMatching) return rows();

    if (!props.resolveAll)
      throw new Error("Selecting every matching row is not available for this list.");

    return props.resolveAll();
  };

  const canSync = () => {
    if (props.entity === "device") return can("devices.command");

    if (props.entity === "group") return can("groups.write");

    return can("policies.write");
  };

  const canDelete = () => {
    if (props.entity === "group") return can("groups.write");

    return can("policies.write");
  };

  /** Refetch the list, then keep only the rows that still need attention. */
  const invalidate = async (keep?: readonly string[]) => {
    await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, props.entity) });

    if (props.entity === "device")
      await qc.invalidateQueries({ queryKey: ["enterprise", "device-search"] });

    // An all-matching selection cannot be narrowed to the rows that failed:
    // clear it and let the refreshed list show the current state.
    if (props.allMatching) {
      props.clear();

      return;
    }

    if (keep && keep.length > 0) props.select(keep);
    else props.clear();
  };

  const sync = useMutation(() => ({
    mutationFn: async (): Promise<BulkOutcome> => {
      const selected = await targets();

      if (props.entity === "device")
        return settleRows(selected, (id) => enterprise.deviceAction(params.tenantId, id));

      // Group and policy sync are single endpoints; a rejection fails the whole
      // selection and is reported inline next to the button.
      const selectedIds = selected.map((row) => row.id);

      if (props.entity === "group") await enterprise.syncGroups(params.tenantId, selectedIds);
      else await enterprise.syncPolicies(params.tenantId, selectedIds);

      return { succeeded: selected.length, failed: [] };
    },
    onSuccess: async (outcome) => {
      await invalidate(outcome.failed.map((row) => row.id));
      reportBulk(
        props.entity,
        { ok: "sync requested for", fail: "could not request sync for" },
        outcome,
      );
    },
  }));

  return (
    <>
      <Show when={props.entity !== "group" && can("groups.write")}>
        <ScopeGroupsAction
          targets={targets}
          relation={props.entity === "device" ? "devices" : "policies"}
        />
      </Show>
      <Show when={canSync()}>
        <Button variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}>
          Sync
        </Button>
      </Show>
      <Show when={sync.error}>
        <ErrorText error={sync.error} />
      </Show>
      <Show when={props.entity === "device" && can("devices.write")}>
        <ConfirmAction
          title="Unenroll"
          description="Unenroll selected devices."
          target={
            props.allMatching ? entityNoun("device", count()) : confirmTarget(rows(), "device")
          }
          destructive
          onConfirm={async () => {
            const selected = await targets();

            if (selected.length === 0) return;

            const outcome = await settleRows(selected, (id) =>
              enterprise.deviceUnenroll(params.tenantId, id),
            );

            if (outcome.succeeded === 0) throw new Error(outcome.failed[0]!.reason);

            await invalidate(outcome.failed.map((row) => row.id));
            reportBulk(props.entity, { ok: "unenrolled", fail: "could not unenroll" }, outcome);
          }}
        />
      </Show>
      <Show when={props.entity !== "device" && canDelete()}>
        <ConfirmAction
          title={`Delete ${entityNoun(props.entity, count())}?`}
          description="This cannot be undone."
          target={
            props.allMatching
              ? entityNoun(props.entity, count())
              : confirmTarget(rows(), props.entity)
          }
          destructive
          onConfirm={async () => {
            const requested = await targets();

            if (requested.length === 0) return;

            const requestedIds = requested.map((row) => row.id);

            const result =
              props.entity === "group"
                ? await enterprise.deleteGroups(params.tenantId, requestedIds)
                : await enterprise.deletePolicies(params.tenantId, requestedIds);

            const names = new Map(requested.map((row) => [row.id, row.name]));

            const failures = result.failed.map((row) => ({
              id: row.id,
              name: names.get(row.id) ?? row.id,
              reason: failureReason(row.reason),
            }));

            // The API deletes what it can; nothing deleted is a hard failure and
            // keeps the confirm dialog (and its error) on screen.
            if (result.deleted.length === 0 && failures.length > 0)
              throw new Error(failures[0]!.reason);

            await invalidate(failures.map((row) => row.id));
            reportBulk(
              props.entity,
              { ok: "deleted", fail: "could not delete" },
              { succeeded: result.deleted.length, failed: failures },
            );
          }}
        />
      </Show>
    </>
  );
}
