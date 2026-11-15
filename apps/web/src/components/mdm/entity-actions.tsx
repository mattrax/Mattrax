import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Match } from "effect";
import { createSignal, For, Show } from "solid-js";
import { announce } from "~/components/app-shell";
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

type Named = { id: string; name: string };

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
        <DialogContent class="max-w-md rounded-lg border border-white/[0.09] bg-popover p-6">
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

function ScopeGroupsAction(props: { selected: Named[]; relation: "devices" | "policies" }) {
  const params = useParams();
  const qc = useQueryClient();
  const [open, setOpen] = createSignal(false);
  const [changes, setChanges] = createSignal<Record<string, "all" | "none">>({});

  const groups = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "group"),
    queryFn: () => enterprise.list(params.tenantId, "group"),
  }));

  const patch = useMutation(() => ({
    mutationFn: async () =>
      Promise.all(
        Object.entries(changes()).map(([groupId, state]) =>
          enterprise.patchGroupMembers(
            params.tenantId,
            groupId,
            state === "all"
              ? { assign: { [props.relation]: props.selected.map((row) => row.id) } }
              : { unassign: { [props.relation]: props.selected.map((row) => row.id) } },
          ),
        ),
      ),
    onSuccess: async () => {
      setChanges({});
      setOpen(false);
      announce("Group assignments updated");
      await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "group") });
      await qc.invalidateQueries({ queryKey: ["enterprise", "device-search"] });
    },
  }));

  const groupRows = () => groups.data?.rows ?? [];

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
        <div class="fixed bottom-24 left-1/2 z-50 max-h-[60vh] w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 overflow-y-auto rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl shadow-black/50">
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
                class="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-[12.5px] outline-none hover:bg-white/[0.06] focus-visible:bg-white/[0.06]"
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
}) {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const rows = () => props.selected.map((row) => ({ id: row.id, name: row.name }));
  const ids = () => rows().map((row) => row.id);

  const canSync = () => {
    if (props.entity === "device") return can("devices.command");

    if (props.entity === "group") return can("groups.write");

    return can("policies.write");
  };

  const canDelete = () => {
    if (props.entity === "group") return can("groups.write");

    return can("policies.write");
  };

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, props.entity) });

    if (props.entity === "device")
      await qc.invalidateQueries({ queryKey: ["enterprise", "device-search"] });
    props.clear();
  };

  const countLabel = (count: number) => `${count} ${props.entity}${count === 1 ? "" : "s"}`;

  const sync = useMutation(() => ({
    mutationFn: async () => {
      if (props.entity === "device")
        return Promise.all(ids().map((id) => enterprise.deviceAction(params.tenantId, id)));

      if (props.entity === "group") return enterprise.syncGroups(params.tenantId, ids());

      return enterprise.syncPolicies(params.tenantId, ids());
    },
    onSuccess: async () => {
      const count = ids().length;

      await invalidate();
      announce(`Sync requested for ${countLabel(count)}`);
    },
  }));

  return (
    <>
      <Show when={props.entity !== "group" && can("groups.write")}>
        <ScopeGroupsAction
          selected={rows()}
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
          target={rows()
            .map((r) => r.name)
            .join(", ")}
          destructive
          onConfirm={async () => {
            const count = ids().length;

            await Promise.all(ids().map((id) => enterprise.deviceUnenroll(params.tenantId, id)));
            await invalidate();
            announce(`Unenrolled ${countLabel(count)}`);
          }}
        />
      </Show>
      <Show when={props.entity !== "device" && canDelete()}>
        <ConfirmAction
          title={`Delete ${ids().length} ${props.entity === "policy" ? (ids().length === 1 ? "policy" : "policies") : `${props.entity}${ids().length === 1 ? "" : "s"}`}?`}
          description="This cannot be undone."
          target={confirmTarget(rows(), props.entity)}
          destructive
          onConfirm={async () => {
            const count = ids().length;

            if (props.entity === "group") await enterprise.deleteGroups(params.tenantId, ids());
            else await enterprise.deletePolicies(params.tenantId, ids());
            await invalidate();
            announce(`Deleted ${countLabel(count)}`);
          }}
        />
      </Show>
    </>
  );
}
