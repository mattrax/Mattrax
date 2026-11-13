import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import { Button, buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { ErrorText } from "./common";
import {
  enterprise,
  enterpriseKeys,
  type DeviceRow,
  type Entity,
  type GroupRow,
  type PolicyRow,
} from "~/lib/enterprise";

type Named = { id: string; name: string };

const selectedNamed = (rows: Named[]) => rows.map((row) => ({ id: row.id, name: row.name }));

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
      await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "group") });
      await qc.invalidateQueries({ queryKey: ["enterprise", "device-search"] });
    },
  }));

  const groupRows = () => (groups.data?.rows ?? []) as GroupRow[];

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
                  {changes()[group.id] === "all"
                    ? "Assign"
                    : changes()[group.id] === "none"
                      ? "Remove"
                      : ""}
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
  const rows = () => selectedNamed(props.selected as Named[]);
  const ids = () => rows().map((row) => row.id);

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, props.entity) });

    if (props.entity === "device")
      await qc.invalidateQueries({ queryKey: ["enterprise", "device-search"] });
    props.clear();
  };

  const sync = useMutation(() => ({
    mutationFn: async () =>
      props.entity === "device"
        ? Promise.all(ids().map((id) => enterprise.deviceAction(params.tenantId, id)))
        : props.entity === "group"
          ? enterprise.syncGroups(params.tenantId, ids())
          : enterprise.syncPolicies(params.tenantId, ids()),
    onSuccess: invalidate,
  }));

  return (
    <>
      <Show when={props.entity === "device"}>
        <ScopeGroupsAction selected={rows()} relation="devices" />
      </Show>
      <Show when={props.entity === "policy"}>
        <ScopeGroupsAction selected={rows()} relation="policies" />
      </Show>
      <Button variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}>
        Sync
      </Button>
      <Show when={sync.error}>
        <ErrorText error={sync.error} />
      </Show>
      <Show when={props.entity === "device"}>
        <ConfirmAction
          title="Unenroll"
          description="Unenroll selected devices."
          target={rows()
            .map((r) => r.name)
            .join(", ")}
          destructive
          onConfirm={async () => {
            await Promise.all(ids().map((id) => enterprise.deviceUnenroll(params.tenantId, id)));
            await invalidate();
          }}
        />
      </Show>
      <Show when={props.entity !== "device"}>
        <ConfirmAction
          title={`Delete ${ids().length} ${props.entity === "policy" ? (ids().length === 1 ? "policy" : "policies") : `${props.entity}${ids().length === 1 ? "" : "s"}`}?`}
          description="This cannot be undone."
          target={confirmTarget(rows(), props.entity)}
          destructive
          onConfirm={async () => {
            if (props.entity === "group") await enterprise.deleteGroups(params.tenantId, ids());
            else await enterprise.deletePolicies(params.tenantId, ids());
            await invalidate();
          }}
        />
      </Show>
    </>
  );
}
