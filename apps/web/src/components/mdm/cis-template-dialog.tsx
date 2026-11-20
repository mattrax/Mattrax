import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Check, Info, ShieldCheck } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import { loadCollection, type Collection, type PlatformId } from "~/lib/policy-designer/catalog";
import {
  applyCisTemplateToSelections,
  cisControlIds,
  cisRequiredCollections,
  loadCisTemplate,
  loadCisTemplateIndex,
  type CisApplyResult,
  type CisTemplateSummary,
  type CompiledCisTemplate,
} from "~/lib/policy-designer/cis";
import type { Selection } from "~/lib/policy-designer/build";
import { cn } from "~/lib/utils";

export type CisTemplateOutcome = CisApplyResult & {
  readonly template: CompiledCisTemplate;
};

export type CisTemplateDialogProps = {
  readonly open: boolean;
  /** Limit the picker to one platform. Omit on the creation page. */
  readonly platform?: PlatformId;
  /** Existing selections for the active platform; used for merge preview. */
  readonly selections: ReadonlyArray<Selection>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onApply: (outcome: CisTemplateOutcome) => void;
};

const PLATFORM_LABEL: Record<PlatformId, string> = {
  apple: "Apple",
  windows: "Windows",
  android: "Android",
};

const controlsLabel = (stats: { controls: number; mapped: number }) =>
  `${stats.mapped} of ${stats.controls} controls mapped`;

/**
 * CIS benchmark picker.
 *
 * A template is applied only after the administrator confirms which controls to
 * include. The dialog loads the catalogue collections the chosen controls need,
 * then hands the parent the merged selections. Unmapped controls are shown and
 * disabled rather than hidden: the gap is part of the information.
 */
export function CisTemplateDialog(props: CisTemplateDialogProps) {
  const [summaries, setSummaries] = createSignal<CisTemplateSummary[]>();
  const [indexError, setIndexError] = createSignal<string>();
  const [summary, setSummary] = createSignal<CisTemplateSummary>();
  const [template, setTemplate] = createSignal<CompiledCisTemplate>();
  const [templateError, setTemplateError] = createSignal<string>();
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set<string>());
  const [query, setQuery] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [applyError, setApplyError] = createSignal<string>();

  const available = createMemo(() =>
    (summaries() ?? []).filter(
      (candidate) => props.platform === undefined || candidate.platform === props.platform,
    ),
  );

  const visibleControls = createMemo(() => {
    const term = query().trim().toLowerCase();
    const controls = template()?.controls ?? [];

    if (!term) return controls;

    return controls.filter((control) =>
      `${control.id} ${control.title} ${control.description}`.toLowerCase().includes(term),
    );
  });

  const mappedCount = createMemo(
    () => template()?.controls.filter((control) => control.mapped).length ?? 0,
  );

  const allMappedSelected = createMemo(() => {
    const current = template();

    if (!current) return false;

    return cisControlIds(current).every((id) => selected().has(id));
  });

  const coverage = createMemo(() => {
    const stats = template()?.stats;

    if (!stats || stats.controls === 0) return 0;

    return Math.round((stats.mapped / stats.controls) * 100);
  });

  const choose = (next: CisTemplateSummary | undefined) => {
    setSummary(next);
    setTemplate(undefined);
    setTemplateError(undefined);
    setApplyError(undefined);
    setQuery("");

    if (!next) return;

    setBusy(true);
    void loadCisTemplate(next)
      .then((loaded) => {
        setTemplate(loaded);
        setSelected(new Set(cisControlIds(loaded)));
      })
      .catch((error) =>
        setTemplateError(error instanceof Error ? error.message : "Could not load the template."),
      )
      .finally(() => setBusy(false));
  };

  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;

      setApplyError(undefined);

      if (summaries()) {
        if (!summary() || (props.platform !== undefined && summary()!.platform !== props.platform))
          choose(available()[0]);

        return;
      }

      setBusy(true);
      void loadCisTemplateIndex()
        .then((index) => {
          setSummaries([...index.templates]);

          const first = index.templates.find(
            (candidate) => props.platform === undefined || candidate.platform === props.platform,
          );

          if (first) choose(first);
        })
        .catch((error) =>
          setIndexError(error instanceof Error ? error.message : "Could not load the CIS templates."),
        )
        .finally(() => setBusy(false));
    },
  );

  const toggleControl = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
  };

  const setAllMapped = (enabled: boolean) => {
    const current = template();

    if (!current) return;

    setSelected(enabled ? new Set(cisControlIds(current)) : new Set<string>());
  };

  const apply = async () => {
    const current = template();

    if (!current || selected().size === 0) return;

    setBusy(true);
    setApplyError(undefined);

    try {
      const controlIds = [...selected()];
      const required = cisRequiredCollections(current, controlIds);

      const entries = await Promise.all(
        required.map(async (id): Promise<[string, Collection]> => [
          id,
          await loadCollection(current.platform, id),
        ]),
      );

      const collections = new Map(entries);

      const result = applyCisTemplateToSelections({
        template: current,
        controlIds,
        selections: props.selections,
        collections,
      });

      props.onApply({ ...result, template: current });
      props.onOpenChange(false);
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : "Could not apply the template.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="flex max-h-[88vh] max-w-4xl flex-col overflow-hidden rounded-xl p-5">
        <DialogHeader>
          <DialogTitle class="text-base">Apply a CIS benchmark</DialogTitle>
          <DialogDescription class="text-[12px] leading-relaxed">
            Turn a reviewed subset of a CIS benchmark into policy settings. Unmapped controls are
            listed so you can see what the template does not cover.
          </DialogDescription>
        </DialogHeader>

        <Show when={indexError()}>
          {(error) => (
            <p role="alert" class="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              Could not load the CIS templates: {error()}
            </p>
          )}
        </Show>

        <Show when={!indexError()}>
          <div class="mt-3 grid gap-3 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
            <div class="min-w-0 space-y-3">
              <label class="block">
                <span class="mb-1 block text-[11px] font-medium text-foreground">Benchmark</span>
                <select
                  class="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-[12px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                  value={summary()?.id ?? ""}
                  onChange={(event) => {
                    choose(available().find((item) => item.id === event.currentTarget.value));
                  }}
                >
                  <For each={available()}>
                    {(item) => (
                      <option value={item.id}>
                        {PLATFORM_LABEL[item.platform]} · {item.benchmark.name} v
                        {item.benchmark.version}
                      </option>
                    )}
                  </For>
                </select>
              </label>

              <Show
                when={template()}
                fallback={
                  <div class="rounded-xl border border-dashed border-input px-3 py-6 text-center text-[12px] text-muted-foreground">
                    {busy() ? "Loading benchmark…" : "No benchmark is available for this platform."}
                  </div>
                }
              >
                {(current) => (
                  <div class="space-y-3 rounded-xl border border-border bg-surface/60 p-3">
                    <div class="flex items-start gap-2">
                      <div class="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
                        <ShieldCheck class="size-4" />
                      </div>
                      <div class="min-w-0">
                        <p class="text-[12px] font-semibold leading-snug text-foreground">
                          {current().benchmark.name}
                        </p>
                        <p class="mt-0.5 text-[11px] text-muted-foreground">
                          Version {current().benchmark.version}
                          {current().benchmark.os ? ` · ${current().benchmark.os}` : ""}
                        </p>
                      </div>
                    </div>

                    <div>
                      <div class="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                        <span>{controlsLabel(current().stats)}</span>
                        <span class="tabular-nums">{coverage()}%</span>
                      </div>
                      <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          class="h-full rounded-full bg-brand-solid"
                          style={{ width: `${coverage()}%` }}
                        />
                      </div>
                      <p class="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                        {current().stats.settings} settings across{" "}
                        {current().stats.mapped} mapped controls.
                      </p>
                    </div>

                    <p class="text-[11px] leading-relaxed text-muted-foreground">
                      {current().description}
                    </p>

                    <a
                      href={current().benchmark.source}
                      target="_blank"
                      rel="noreferrer"
                      class="inline-block text-[11px] font-medium text-brand-solid underline-offset-2 hover:underline"
                    >
                      Benchmark source
                    </a>

                    <div class="flex flex-wrap gap-1.5">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy() || allMappedSelected()}
                        onClick={() => setAllMapped(true)}
                      >
                        Select all mapped
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy() || selected().size === 0}
                        onClick={() => setAllMapped(false)}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                )}
              </Show>

              <p class="flex gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
                <Info class="mt-0.5 size-3 shrink-0" />
                <span>
                  Control summaries are Mattrax's own wording. The CIS benchmark document is not
                  copied or redistributed.
                </span>
              </p>
            </div>

            <div class="flex min-h-[320px] min-w-0 flex-col overflow-hidden rounded-xl border border-border">
              <div class="shrink-0 border-b border-border p-2">
                <Input
                  value={query()}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  placeholder="Filter controls by reference or title"
                  aria-label="Filter CIS controls"
                  class="h-8 text-[12px]"
                />
              </div>

              <Show when={templateError()}>
                {(error) => (
                  <p role="alert" class="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                    {error()}
                  </p>
                )}
              </Show>

              <Show
                when={template()}
                fallback={
                  <div class="flex flex-1 items-center justify-center px-4 py-10 text-[12px] text-muted-foreground">
                    {busy() ? "Loading benchmark…" : "Choose a benchmark to see its controls."}
                  </div>
                }
              >
                <div class="max-h-[46vh] flex-1 overflow-y-auto">
                  <Show
                    when={visibleControls().length > 0}
                    fallback={
                      <p class="px-3 py-8 text-center text-[12px] text-muted-foreground">
                        No controls match that filter.
                      </p>
                    }
                  >
                    <ul>
                      <For each={visibleControls()}>
                        {(control) => {
                          const id = () => `cis-control-${control.id.replaceAll(".", "-")}`;
                          const checked = () => selected().has(control.id);

                          return (
                            <li class="border-b border-border/60 last:border-b-0">
                              <div class="flex items-start gap-2 px-3 py-2">
                                <input
                                  id={id()}
                                  type="checkbox"
                                  class="mt-0.5 size-3.5 shrink-0 accent-[var(--brand-solid)]"
                                  checked={checked()}
                                  disabled={!control.mapped}
                                  onChange={() => toggleControl(control.id)}
                                />
                                <label
                                  for={id()}
                                  class={cn(
                                    "min-w-0 flex-1",
                                    control.mapped ? "cursor-pointer" : "cursor-default",
                                  )}
                                >
                                  <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span class="font-mono text-[10px] text-muted-foreground">
                                      {control.id}
                                    </span>
                                    <span class="text-[12px] font-medium leading-snug text-foreground">
                                      {control.title}
                                    </span>
                                    <Show when={control.level}>
                                      {(level) => (
                                        <Badge variant="outline" class="h-4 px-1 text-[9px]">
                                          {level()}
                                        </Badge>
                                      )}
                                    </Show>
                                    <Show when={control.mapped} fallback={
                                      <Badge variant="secondary" class="h-4 px-1 text-[9px]">
                                        Not mapped
                                      </Badge>
                                    }>
                                      <Badge variant="success" class="h-4 px-1 text-[9px]">
                                        <Check class="mr-0.5 size-2.5" />
                                        {control.settings.length}
                                      </Badge>
                                    </Show>
                                  </span>
                                  <span class="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                                    {control.description}
                                  </span>
                                  <Show when={control.note}>
                                    {(note) => (
                                      <span class="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground/80">
                                        {note()}
                                      </span>
                                    )}
                                  </Show>
                                  <Show when={control.settings.length > 0}>
                                    <details class="mt-1">
                                      <summary class="cursor-pointer text-[10px] font-medium text-muted-foreground hover:text-foreground">
                                        {control.settings.length} mapped setting
                                        {control.settings.length === 1 ? "" : "s"}
                                      </summary>
                                      <ul class="mt-1 space-y-0.5">
                                        <For each={control.settings}>
                                          {(setting) => (
                                            <li class="text-[10px] leading-relaxed text-muted-foreground">
                                              <span class="text-foreground/80">
                                                {setting.collectionName}
                                              </span>{" "}
                                              → {setting.settingName} ={" "}
                                              <span class="font-mono">{setting.displayValue}</span>
                                            </li>
                                          )}
                                        </For>
                                      </ul>
                                    </details>
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
              </Show>
            </div>
          </div>
        </Show>

        <Show when={applyError()}>
          {(error) => (
            <p role="alert" class="mt-3 whitespace-pre-wrap rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              {error()}
            </p>
          )}
        </Show>

        <DialogFooter class="mt-3 flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <p class="text-[11px] text-muted-foreground">
            {selected().size} control{selected().size === 1 ? "" : "s"} selected
            <Show when={mappedCount() > 0}> · {mappedCount()} mapped available</Show>
          </p>
          <div class="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy() || !template() || selected().size === 0}
              onClick={() => void apply()}
            >
              {busy() ? "Applying…" : "Apply selected controls"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
