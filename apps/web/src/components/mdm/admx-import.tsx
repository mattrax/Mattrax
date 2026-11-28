import { Checkbox } from "@mattrax/ui";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { AdmxBundle, AdmxCatalogueIndex } from "@mattrax/enterprise-domain/admx";
import { parseAdmxBundle } from "@mattrax/enterprise-domain/admx";
import { Badge } from "@mattrax/ui";
import { Button } from "@mattrax/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@mattrax/ui";
import { CircleAlert, Info, TriangleAlert } from "~/components/ui/icons";
import {
  admxPolicySelection,
  loadAdmxCatalogueIndex,
  readAdmxFiles,
} from "~/lib/policy-designer/admx";
import type { AdmxSelection } from "~/lib/policy-designer/admx";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { cn } from "~/lib/utils";

/**
 * ADMX import: pick a vendor template (a .zip, or an .admx plus its .adml),
 * review what was discovered, then add the selected policies.
 *
 * The review is deliberately explicit about the two delivery paths and about
 * policies that cannot be added. Nothing is applied from the file: names are
 * rendered as text and the only consumer of the XML is the parser.
 */

export type AdmxImportDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onImport: (selections: readonly AdmxSelection[]) => void;
};

/** User-scoped ADMX needs the raw editor: the designer saves one device scope. */
const blockedReason = (policy: AdmxBundle["policies"][number]) =>
  policy.unmappable ??
  (policy.scope === "user"
    ? "User-scoped ADMX policies are not supported by the designer. Add them through the policy editor, which can set a user scope."
    : undefined);

export default function AdmxImportDialog(props: AdmxImportDialogProps) {
  let fileInput: HTMLInputElement | undefined;
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [bundle, setBundle] = createSignal<AdmxBundle | null>(null);
  const [catalogue, setCatalogue] = createSignal<AdmxCatalogueIndex | undefined>(undefined);
  const [catalogueError, setCatalogueError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<ReadonlySet<number>>(new Set<number>());
  const [dragging, setDragging] = createSignal(false);

  const reset = () => {
    setBundle(null);
    setError(null);
    setSelected(new Set<number>());
    setDragging(false);
    setBusy(false);
    setCatalogueError(null);
  };

  createEffect(
    () => props.open,
    (open) => {
      if (!open) {
        reset();

        return;
      }

      // The lookup is only needed for Microsoft in-box policies. Vendor
      // imports still work when it fails; those policies are reported as
      // unmatched.
      if (catalogue() || catalogueError()) return;

      void loadAdmxCatalogueIndex()
        .then(setCatalogue)
        .catch((error_: unknown) =>
          setCatalogueError(
            errorMessage(raisedFailure(error_), "The in-box ADMX lookup could not be loaded."),
          ),
        );
    },
  );

  const accept = async (files: readonly File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);

    try {
      const inputs = await readAdmxFiles(files);
      // Matching in-box policies needs the lookup. Wait for it here so a file
      // dropped while it is still loading is not reported as unmatched.
      let index = catalogue();

      if (!index && !catalogueError()) {
        try {
          index = await loadAdmxCatalogueIndex();
          setCatalogue(index);
        } catch (error_) {
          setCatalogueError(
            errorMessage(raisedFailure(error_), "The in-box ADMX lookup could not be loaded."),
          );
        }
      }

      const next = parseAdmxBundle(inputs, index ? { catalogue: index } : {});

      setBundle(next);
      setSelected(
        new Set(next.policies.flatMap((policy, index) => (blockedReason(policy) ? [] : [index]))),
      );
    } catch (error_) {
      setError(errorMessage(raisedFailure(error_), "The template could not be read."));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (index: number) =>
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(index)) next.delete(index);
      else next.add(index);

      return next;
    });

  const addable = () =>
    (bundle()?.policies ?? []).filter((policy) => !blockedReason(policy)).length;

  const chosen = () =>
    (bundle()?.policies ?? []).filter(
      (policy, index) => selected().has(index) && !blockedReason(policy),
    );

  const add = () => {
    const selections = (bundle()?.policies ?? []).flatMap((policy, index) => {
      if (!selected().has(index) || blockedReason(policy)) return [];
      const selection = admxPolicySelection(policy);

      return selection ? [selection] : [];
    });

    if (selections.length === 0) return;
    props.onImport(selections);
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="max-h-7/8 max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Import ADMX template</DialogTitle>
          <DialogDescription>
            Add a vendor Administrative Template (.admx + .adml, or a .zip containing them).
            Microsoft in-box templates map to the settings already in the catalogue.
          </DialogDescription>
        </DialogHeader>

        <Show when={bundle()}>
          {(loaded) => (
            <div class="mt-3 space-y-2 text-xs">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                <span>
                  <span class="font-medium text-foreground">{loaded().policies.length}</span> polic
                  {loaded().policies.length === 1 ? "y" : "ies"} found
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <span class="font-medium text-foreground">{addable()}</span> can be added
                </span>
                <Show when={loaded().truncated}>
                  <span class="text-destructive">Only the first 500 were read</span>
                </Show>
              </div>
              <Show when={catalogueError()}>
                {(message) => (
                  <p class="rounded-lg border border-warning/30 bg-warning/[0.07] px-2.5 py-1.5 text-xs text-warning-foreground">
                    The in-box lookup could not be loaded ({message()}). Vendor templates can still
                    be imported; Microsoft in-box policies cannot be matched.
                  </p>
                )}
              </Show>
            </div>
          )}
        </Show>

        <Show
          when={bundle()}
          fallback={
            <div
              class={cn(
                "mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
                dragging() ? "border-brand bg-brand/[0.05]" : "border-input",
              )}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void accept(Array.from(event.dataTransfer?.files ?? []));
              }}
            >
              <p class="text-xs font-medium text-foreground">
                Drop an .admx/.adml pair or a .zip here
              </p>
              <p class="max-w-sm text-xs leading-relaxed text-muted-foreground">
                Files are parsed in your browser. Nothing is executed, and templates larger than 1
                MiB per file or 4 MiB in total are refused.
              </p>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept=".admx,.adml,.zip"
                class="sr-only"
                onChange={(event) => {
                  void accept(Array.from(event.currentTarget.files ?? []));
                  event.currentTarget.value = "";
                }}
              />
              <Button
                size="sm"
                variant="outline"
                class="mt-1"
                disabled={busy()}
                onClick={() => fileInput?.click()}
              >
                {busy() ? "Reading…" : "Choose files"}
              </Button>
            </div>
          }
        >
          <div class="mt-3 max-h-1/2 overflow-y-auto rounded-lg border border-border">
            <Show
              when={(bundle()?.policies.length ?? 0) > 0}
              fallback={
                <p class="px-3 py-4 text-xs text-muted-foreground">
                  No policies were found in those files.
                </p>
              }
            >
              <ul>
                <For each={bundle()?.policies ?? []}>
                  {(policy, index) => {
                    const blocked = () => blockedReason(policy);
                    const id = () => `admx-policy-${index()}`;

                    return (
                      <li class="border-b border-border/60 px-3 py-2 last:border-b-0">
                        <div class="flex items-start gap-2">
                          <Checkbox
                            id={id()}
                            class="mt-0.5 size-3.5"
                            checked={selected().has(index())}
                            disabled={Boolean(blocked())}
                            onCheckedChange={() => toggle(index())}
                          />
                          <label for={id()} class="min-w-0 flex-1 cursor-pointer">
                            <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span class="truncate text-xs font-medium text-foreground">
                                {policy.policy.displayName || policy.policy.name}
                              </span>
                              <Badge variant="outline">
                                {policy.source === "inbox" ? "Microsoft in-box" : "Vendor"}
                              </Badge>
                              <Badge variant="secondary">
                                {policy.scope === "device" ? "Device" : "User"}
                              </Badge>
                            </span>
                            <span class="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                              {policy.policy.name}
                              {policy.policy.categoryDisplayPath.length > 0
                                ? ` · ${policy.policy.categoryDisplayPath.join(" › ")}`
                                : ""}
                            </span>
                            <Show
                              when={blocked()}
                              fallback={
                                <span class="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                                  {policy.omaUri}
                                </span>
                              }
                            >
                              {(reason) => (
                                <span class="mt-1 flex items-start gap-1 text-xs leading-relaxed text-destructive">
                                  <CircleAlert class="mt-0.5 size-3 shrink-0" />
                                  <span>{reason()}</span>
                                </span>
                              )}
                            </Show>
                          </label>
                        </div>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </div>

          <Show when={(bundle()?.issues.length ?? 0) > 0}>
            <ul class="mt-2 max-h-28 space-y-1 overflow-y-auto">
              <For each={bundle()?.issues ?? []}>
                {(issue) => (
                  <li
                    class={cn(
                      "flex items-start gap-1.5 text-xs leading-relaxed",
                      issue.severity === "error" ? "text-destructive" : "text-warning-foreground",
                    )}
                  >
                    <Show
                      when={issue.severity === "error"}
                      fallback={<TriangleAlert class="mt-0.5 size-3 shrink-0" />}
                    >
                      <CircleAlert class="mt-0.5 size-3 shrink-0" />
                    </Show>
                    <span class="min-w-0">
                      <Show when={issue.fileName}>
                        {(name) => <span class="font-mono">{name()}: </span>}
                      </Show>
                      {issue.message}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>

        <Show when={error()}>
          {(message) => (
            <p
              role="alert"
              class="mt-3 flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs leading-relaxed text-destructive"
            >
              <CircleAlert class="mt-0.5 size-3.5 shrink-0" />
              <span class="min-w-0">{message()}</span>
            </p>
          )}
        </Show>

        <p class="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <Info class="mt-0.5 size-3 shrink-0" />
          Vendor templates are installed with the Policy CSP ADMXInstall node before their settings
          are written. Names and descriptions come from the file and are rendered as text only.
        </p>

        <DialogFooter class="mt-4 flex-row justify-end">
          <Show when={bundle()}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setBundle(null);
                setError(null);
                setSelected(new Set<number>());
              }}
            >
              Choose different files
            </Button>
          </Show>
          <Button size="sm" disabled={busy() || chosen().length === 0} onClick={add}>
            {chosen().length === 0
              ? "Add policies"
              : `Add ${chosen().length} polic${chosen().length === 1 ? "y" : "ies"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
