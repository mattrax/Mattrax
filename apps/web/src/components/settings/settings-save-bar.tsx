import { Portal } from "@solidjs/web";
import { Spinner } from "@mattrax/ui";
import { createSignal, Show } from "solid-js";
import { ErrorText } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { CheckCircle2, TriangleAlert } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import type { TenantProfileDraft } from "./tenant-profile-draft";

/** One explicit save point for the tenant profile, shared by every settings pane. */
export function SettingsSaveBar(props: { draft: TenantProfileDraft }) {
  const draft = props.draft;

  return (
    <Show when={draft.dirty() || draft.saving() || draft.saved()}>
      <div
        role="region"
        aria-label="Tenant settings changes"
        class="fixed bottom-4 left-4 right-4 z-40 flex flex-col gap-2 rounded-xl border border-border bg-card/95 px-3.5 py-2.5 shadow-panel backdrop-blur supports-[backdrop-filter]:bg-card/90 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-[calc(100vw-3rem)]"
      >
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <Show
              when={draft.saving()}
              fallback={
                <Show
                  when={draft.saved() && !draft.dirty()}
                  fallback={<span class="size-2 shrink-0 rounded-full bg-warning" />}
                >
                  <CheckCircle2 class="size-4 shrink-0 text-success" />
                </Show>
              }
            >
              <Spinner class="size-3.5 shrink-0 text-muted-foreground" />
            </Show>
            <div class="min-w-0">
              <p class="text-[12px] font-[550] leading-4 text-foreground" aria-live="polite">
                {draft.saving()
                  ? "Saving tenant changes…"
                  : draft.saved() && !draft.dirty()
                    ? "Tenant changes saved"
                    : "Unsaved tenant changes"}
              </p>
              <Show when={draft.hasBrandingErrors() || draft.validationProblem()}>
                <p class="mt-0.5 text-[10.5px] leading-3.5 text-destructive">
                  {draft.validationProblem() ?? "Fix the highlighted fields before saving."}
                </p>
              </Show>
            </div>
          </div>

          <div class="ml-auto flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="ghost" disabled={draft.saving()} onClick={draft.discard}>
              Discard
            </Button>
            <Button
              size="sm"
              disabled={
                draft.saving() || draft.hasBrandingErrors() || Boolean(draft.validationProblem())
              }
              onClick={draft.requestSave}
            >
              {draft.saving() ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>

        <Show when={draft.saveError()}>
          <div class="max-w-[26rem] [&_p]:text-[11px] [&_p]:leading-4">
            <ErrorText error={draft.saveError()} />
          </div>
        </Show>
      </div>
    </Show>
  );
}

/**
 * A deliberate speed bump before a slug change. The old slug stops resolving,
 * so the person has to type the phrase rather than click through a generic
 * confirm.
 */
export function SlugChangeDialog(props: { draft: TenantProfileDraft }) {
  const draft = props.draft;
  const [confirmation, setConfirmation] = createSignal("");

  const close = () => {
    draft.setSlugConfirmOpen(false);
    setConfirmation("");
  };

  const canConfirm = () => confirmation().trim() === "I understand";

  return (
    <Portal>
      <Dialog
        open={draft.slugConfirmOpen()}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent class="sm:max-w-lg">
          <DialogHeader>
            <div class="flex items-start gap-3">
              <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                <TriangleAlert class="size-4.5" />
              </span>
              <div class="min-w-0">
                <DialogTitle>Changing the tenant slug breaks existing URLs</DialogTitle>
                <DialogDescription>
                  Every page for this tenant moves to a new address. Links to the old slug will stop
                  working.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div class="space-y-2 rounded-lg border border-destructive/25 bg-destructive/[0.04] p-3 text-[12px]">
            <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span class="w-14 shrink-0 text-muted-foreground">Current</span>
              <code class="break-all font-mono text-foreground">
                /t/{draft.savedSlug() || "…"}/…
              </code>
            </div>
            <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span class="w-14 shrink-0 text-muted-foreground">New</span>
              <code class="break-all font-mono text-foreground">/t/{draft.slug() || "…"}/…</code>
            </div>
          </div>

          <div class="space-y-2 text-[12px] leading-relaxed text-muted-foreground">
            <p>
              Bookmarks, API clients, enrollment links and shortcuts shared with your team will need
              the new address. Links using the tenant id still redirect. Your other tenant changes
              will be saved at the same time.
            </p>
            <p class="font-medium text-foreground">This cannot be undone from the old slug.</p>
          </div>

          <label class="block">
            <span class="text-[12px] text-foreground">
              Type{" "}
              <code class="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">I understand</code>{" "}
              to confirm
            </span>
            <Input
              class="mt-1.5"
              value={confirmation()}
              onInput={(event) => setConfirmation(event.currentTarget.value)}
              placeholder="I understand"
              autocomplete="off"
              spellcheck={false}
            />
          </label>

          <DialogFooter>
            <Button size="sm" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!canConfirm()}
              onClick={() => {
                draft.confirmSlugSave();
                setConfirmation("");
              }}
            >
              Change slug and save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Portal>
  );
}
