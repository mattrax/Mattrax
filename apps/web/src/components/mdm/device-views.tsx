import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, Label, NativeSelect } from "@mattrax/ui";
import type {
  DeviceView,
  DeviceViewQuery,
  DeviceViewVisibility,
} from "@mattrax/enterprise-domain/client";
import { Ellipsis, Plus, Star } from "~/components/ui/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { toast } from "~/components/toast";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { deviceViewSearchQuery } from "~/lib/device-view-query";
import { ErrorText } from "./common";
import { MdmTableTabs } from "./table";
import type { MdmTableTab } from "./table";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

/**
 * The device table's saved-view tabs.
 *
 * Tabs sit above the table like a spreadsheet's sheets: one per saved view,
 * plus the unfiltered list. Counts come from the same search endpoint the
 * table uses, so a tab always promises the number of rows opening it will
 * show. The page owns applying a view to the URL; this component owns the CRUD
 * dialogs and cache invalidation so the device page does not grow another
 * hundred lines of form state.
 */
export function DeviceViewsTabs(props: {
  tenantId: string;
  views: ReadonlyArray<DeviceView>;
  currentViewId: string | undefined;
  /** `devices.read`: members can curate private views. */
  canSave: boolean;
  /** `devices.write`: publish to the tenant and edit tenant views. */
  canPublish: boolean;
  /** The query the current table state would save; active view merges extras. */
  currentQuery: (activeView?: DeviceView) => DeviceViewQuery;
  onApply: (view: DeviceView) => void;
  /** Drop every filter and return to the unfiltered list. */
  onClear: () => void;
  /** Drop the active-view marker after deleting the selected view. */
  onCurrentViewDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [visibility, setVisibility] = createSignal<DeviceViewVisibility>("private");
  const [errored, setErrored] = createSignal<unknown>();
  const [busy, setBusy] = createSignal(false);
  const [pendingAction, setPendingAction] = createSignal<"update" | "duplicate" | "default" | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = createSignal<DeviceView>();
  const [deleteBusy, setDeleteBusy] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal<unknown>();

  const current = () => props.views.find((view) => view.id === props.currentViewId);

  // One cheap search per tab, limit 1, gives every tab its count without a
  // new API surface. A single query owns them all: N observers would each
  // subscribe to the table's invalidation and could tear down the page under
  // a modal, while one query means one refetch for the whole strip. Failed
  // counts simply leave that tab without a number.
  const countQueries = createMemo(() => [
    { id: "all", query: { limit: 1, offset: 0 } },
    ...props.views.map((view) => ({
      id: view.id,
      query: deviceViewSearchQuery(view.query),
    })),
  ]);

  const counts = useQuery(() => ({
    queryKey: [
      ...enterpriseKeys.deviceSearchPrefix(props.tenantId),
      "view-counts",
      countQueries().map((item) => [item.id, item.query] as const),
    ],
    queryFn: async () => {
      const results = await Promise.allSettled(
        countQueries().map((item) =>
          enterprise.searchDevices(props.tenantId, item.query).then((result) => result.total),
        ),
      );

      return results.map((result) => (result.status === "fulfilled" ? result.value : undefined));
    },
    staleTime: 60_000,
    retry: false,
  }));

  const countAt = (index: number) => counts.data?.[index];

  const tabs = createMemo<MdmTableTab[]>(() => [
    { id: "all", label: "All devices", count: countAt(0) },
    ...props.views.map((view, index) => ({
      id: view.id,
      label: view.name,
      count: countAt(index + 1),
      icon: view.isDefault ? (
        <Star class="size-3 shrink-0 text-brand" aria-label="Your default view" />
      ) : undefined,
    })),
  ]);

  const selectTab = (id: string) => {
    if (id === "all") {
      props.onClear();

      return;
    }

    const view = props.views.find((item) => item.id === id);

    if (view) props.onApply(view);
  };

  const canEdit = (view: DeviceView) =>
    view.visibility === "tenant" ? props.canPublish : view.isOwner;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: enterpriseKeys.deviceViews(props.tenantId) });

  const failure = (error: unknown) => {
    setErrored(error);
  };

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setVisibility("private");
    setErrored(undefined);
    setEditorOpen(true);
  };

  const openRename = (view: DeviceView) => {
    setEditingId(view.id);
    setName(view.name);
    setDescription(view.description ?? "");
    setVisibility(view.visibility);
    setErrored(undefined);
    setEditorOpen(true);
  };

  const saveEditor = async () => {
    setBusy(true);
    setErrored(undefined);

    try {
      const id = editingId();

      if (id) {
        await enterprise.patchDeviceView(props.tenantId, id, {
          name: name().trim(),
          description: description().trim() || null,
          visibility: visibility(),
        });
        toast.success("View renamed");
      } else {
        await enterprise.createDeviceView(props.tenantId, {
          name: name().trim(),
          description: description().trim() || null,
          visibility: visibility(),
          query: props.currentQuery(),
        });
        toast.success("View saved");
      }

      await invalidate();
      setEditorOpen(false);
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  };

  const updateQuery = async (view: DeviceView) => {
    setPendingAction("update");

    try {
      await enterprise.patchDeviceView(props.tenantId, view.id, {
        query: props.currentQuery(view),
      });
      await invalidate();
      toast.success("View updated to the current filters");
    } catch (error) {
      toast.error("Could not update the view", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
    } finally {
      setPendingAction(null);
    }
  };

  const duplicate = async (view: DeviceView) => {
    setPendingAction("duplicate");

    try {
      await enterprise.createDeviceView(props.tenantId, {
        name: `${view.name} copy`.slice(0, 120),
        description: view.description,
        // A member who cannot publish keeps the copy private.
        visibility: view.visibility === "tenant" && !props.canPublish ? "private" : view.visibility,
        query: view.query,
      });
      await invalidate();
      toast.success("View duplicated");
    } catch (error) {
      toast.error("Could not duplicate the view", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
    } finally {
      setPendingAction(null);
    }
  };

  const toggleDefault = async (view: DeviceView) => {
    setPendingAction("default");

    try {
      await enterprise.setDefaultDeviceView(props.tenantId, view.isDefault ? null : view.id);
      await invalidate();
      toast.success(view.isDefault ? "Default view cleared" : "Default view set");
    } catch (error) {
      toast.error("Could not change your default view", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
    } finally {
      setPendingAction(null);
    }
  };

  const confirmDelete = async () => {
    const view = deleteTarget();

    if (!view) return;

    setDeleteBusy(true);
    setDeleteError(undefined);

    try {
      await enterprise.deleteDeviceView(props.tenantId, view.id);
      await invalidate();
      toast.success("View deleted");
      setDeleteTarget(undefined);

      if (props.currentViewId === view.id) props.onCurrentViewDeleted();
    } catch (error) {
      setDeleteError(error);
    } finally {
      setDeleteBusy(false);
    }
  };

  const menuTrigger = (): JSX.Element => (
    <DropdownMenuTrigger class="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
      <Ellipsis class="size-4" />
      <span class="sr-only">Manage saved views</span>
    </DropdownMenuTrigger>
  );

  return (
    <>
      <div class="flex items-center gap-2">
        <MdmTableTabs
          tabs={tabs()}
          value={props.currentViewId ?? "all"}
          onSelect={selectTab}
          label="Device views"
          class="flex-1"
        />
        <Show when={props.canSave}>
          <div class="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              class="h-7 gap-1 rounded-md px-2 text-[11.5px] text-muted-foreground"
              onClick={openCreate}
            >
              <Plus class="size-3.5" />
              Save view
            </Button>
            <DropdownMenu placement="bottom-end">
              {menuTrigger()}
              <DropdownMenuContent class="w-64">
                <DropdownMenuLabel>Saved views</DropdownMenuLabel>
                <p class="px-2 pb-1.5 text-[11px] text-muted-foreground">
                  {props.views.length > 0
                    ? "Switch views from the tabs above."
                    : "Save the current filters and columns to reuse them later."}
                </p>
                <DropdownMenuItem onSelect={openCreate}>
                  <Plus class="size-3.5" />
                  Save current view…
                </DropdownMenuItem>
                <Show when={current()}>
                  {(view) => (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={!canEdit(view()) || pendingAction() !== null}
                        onSelect={() => void updateQuery(view())}
                      >
                        {pendingAction() === "update" ? "Updating…" : `Update “${view().name}”`}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!canEdit(view())}
                        onSelect={() => openRename(view())}
                      >
                        Rename…
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={pendingAction() !== null}
                        onSelect={() => void duplicate(view())}
                      >
                        {pendingAction() === "duplicate" ? "Duplicating…" : "Duplicate"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={pendingAction() !== null}
                        onSelect={() => void toggleDefault(view())}
                      >
                        {pendingAction() === "default"
                          ? "Saving…"
                          : view().isDefault
                            ? "Clear my default"
                            : "Set as my default"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={!canEdit(view())}
                        onSelect={() => {
                          setDeleteError(undefined);
                          setDeleteTarget(view());
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </Show>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Show>
      </div>

      <Show when={props.canSave}>
        <Dialog open={editorOpen()} onOpenChange={(open) => !busy() && setEditorOpen(open)}>
          <DialogContent class="max-w-md rounded-lg p-6">
            <DialogHeader>
              <DialogTitle>{editingId() ? "Rename view" : "Save view"}</DialogTitle>
              <DialogDescription>
                {editingId()
                  ? "Change the name, description or who can see this view. The filters stay as they are."
                  : "Save the current filters, sort and visible columns as a named view."}
              </DialogDescription>
            </DialogHeader>
            <div class="space-y-3">
              <div class="space-y-1.5">
                <Label for="device-view-name">Name</Label>
                <Input
                  id="device-view-name"
                  value={name()}
                  maxlength={120}
                  placeholder="MIA Macs"
                  onInput={(event) => setName(event.currentTarget.value)}
                />
              </div>
              <div class="space-y-1.5">
                <Label for="device-view-description">Description</Label>
                <Input
                  id="device-view-description"
                  value={description()}
                  maxlength={2000}
                  placeholder="Optional"
                  onInput={(event) => setDescription(event.currentTarget.value)}
                />
              </div>
              <div class="space-y-1.5">
                <Label for="device-view-visibility">Visibility</Label>
                <NativeSelect
                  id="device-view-visibility"
                  value={visibility()}
                  onChange={(event) =>
                    setVisibility(event.currentTarget.value as DeviceViewVisibility)
                  }
                >
                  <option value="private">Private to me</option>
                  <Show when={props.canPublish}>
                    <option value="tenant">Everyone in this tenant</option>
                  </Show>
                </NativeSelect>
                <p class="text-[11px] text-muted-foreground">
                  {visibility() === "tenant"
                    ? "Tenant views can be opened by every member. Managing devices is required to publish."
                    : "Only you can see and manage a private view."}
                </p>
              </div>
              <ErrorText error={errored()} />
            </div>
            <DialogFooter class="mt-5">
              <Button variant="outline" disabled={busy()} onClick={() => setEditorOpen(false)}>
                Cancel
              </Button>
              <Button disabled={busy() || !name().trim()} onClick={() => void saveEditor()}>
                {busy() ? "Saving…" : editingId() ? "Save changes" : "Save view"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={deleteTarget() !== undefined}
          onOpenChange={(open) => {
            if (!open && !deleteBusy()) setDeleteTarget(undefined);
          }}
          title="Delete view"
          description={`Delete “${deleteTarget()?.name ?? "this view"}”? The filters and columns stay in the URL, but the saved view is gone.`}
          confirmLabel="Delete view"
          destructive
          pending={deleteBusy()}
          error={deleteError()}
          onConfirm={() => void confirmDelete()}
        />
      </Show>
    </>
  );
}
