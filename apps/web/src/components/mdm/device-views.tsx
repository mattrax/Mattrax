import { createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Badge, Button, Label, NativeSelect } from "@mattrax/ui";
import type {
  DeviceView,
  DeviceViewQuery,
  DeviceViewVisibility,
} from "@mattrax/enterprise-domain/client";
import { ChevronDown, Plus, Settings, Star } from "~/components/ui/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import ConfirmDialog from "~/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { toast } from "~/components/toast";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { ErrorText } from "./common";
import { deviceViewSync } from "~/lib/device-view-sync";

/**
 * The device toolbar's saved-view menu.
 *
 * The page owns applying a view to the URL; this component owns the CRUD
 * dialogs and cache invalidation so the device page does not grow another
 * hundred lines of form state.
 */
export default function DeviceViewsMenu(props: {
  tenantId: string;
  accountId: string;
  views: ReadonlyArray<DeviceView>;
  currentViewId: string | undefined;
  /** `devices.read`: members can curate private views. */
  canSave: boolean;
  /** `devices.write`: publish to the tenant and edit tenant views. */
  canPublish: boolean;
  /** The query the current table state would save; active view merges extras. */
  currentQuery: (activeView?: DeviceView) => DeviceViewQuery;
  onApply: (view: DeviceView) => void;
  /** Drop the active-view marker after deleting the selected view. */
  onCurrentViewDeleted: () => void;
}) {
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

  const canEdit = (view: DeviceView) =>
    view.visibility === "tenant" ? props.canPublish : view.isOwner;

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
        await deviceViewSync.patch(props.tenantId, props.accountId, id, {
          name: name().trim(),
          description: description().trim() || null,
          visibility: visibility(),
        });
        toast.success("View renamed");
      } else {
        await deviceViewSync.create(props.tenantId, props.accountId, {
          name: name().trim(),
          description: description().trim() || null,
          visibility: visibility(),
          query: props.currentQuery(),
        });
        toast.success("View saved");
      }

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
      await deviceViewSync.patch(props.tenantId, props.accountId, view.id, {
        query: props.currentQuery(view),
      });
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
      await deviceViewSync.create(props.tenantId, props.accountId, {
        name: `${view.name} copy`.slice(0, 120),
        description: view.description,
        // A member who cannot publish keeps the copy private.
        visibility: view.visibility === "tenant" && !props.canPublish ? "private" : view.visibility,
        query: view.query,
      });
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
      await deviceViewSync.setDefault(
        props.tenantId,
        props.accountId,
        view.isDefault ? null : view.id,
      );
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
      await deviceViewSync.delete(props.tenantId, props.accountId, view.id);
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
    <span class="inline-flex rounded-full border border-border bg-card px-2.5 text-xs text-muted-foreground transition-colors duration-140 ease-swift hover:bg-hover hover:text-foreground focus-within:ring-2 focus-within:ring-ring/60">
      <DropdownMenuTrigger class="flex h-7 items-center">
        <Settings class="size-3.5" />
        <span class="mx-1.5 max-w-32 truncate">{current()?.name ?? "Views"}</span>
        <ChevronDown class="size-3.5" />
      </DropdownMenuTrigger>
    </span>
  );

  return (
    <Show when={props.canSave}>
      <DropdownMenu placement="bottom-end">
        {menuTrigger()}
        <DropdownMenuContent class="w-64">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          <Show
            when={props.views.length > 0}
            fallback={
              <p class="px-2 py-2 text-xs text-muted-foreground">
                Save the current filters and columns to reuse them later.
              </p>
            }
          >
            <DropdownMenuRadioGroup
              value={props.currentViewId ?? ""}
              onValueChange={(value) => {
                const view = props.views.find((item) => item.id === value);

                if (view) props.onApply(view);
              }}
            >
              <For each={props.views}>
                {(view) => (
                  <DropdownMenuRadioItem value={view.id} indicator="check">
                    <span class="flex min-w-0 flex-1 items-center gap-1.5">
                      <span class="truncate">{view.name}</span>
                      <Show when={view.visibility === "tenant"}>
                        <Badge variant="subtle">Tenant</Badge>
                      </Show>
                      <Show when={view.isDefault}>
                        <span class="inline-flex shrink-0 text-brand">
                          <Star class="size-3" aria-label="Your default" />
                        </span>
                      </Show>
                    </span>
                  </DropdownMenuRadioItem>
                )}
              </For>
            </DropdownMenuRadioGroup>
          </Show>
          <DropdownMenuSeparator />
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
                <DropdownMenuItem disabled={!canEdit(view())} onSelect={() => openRename(view())}>
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

      <Dialog open={editorOpen()} onOpenChange={(open) => !busy() && setEditorOpen(open)}>
        <DialogContent class="max-w-md">
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
                disabled={editingId() !== null}
                onChange={(event) =>
                  setVisibility(event.currentTarget.value as DeviceViewVisibility)
                }
              >
                <option value="private">Private to me</option>
                <Show when={props.canPublish}>
                  <option value="tenant">Everyone in this tenant</option>
                </Show>
              </NativeSelect>
              <p class="text-xs text-muted-foreground">
                {editingId() !== null
                  ? "Visibility is fixed after a view is saved. Create a new view to change it."
                  : visibility() === "tenant"
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
  );
}
