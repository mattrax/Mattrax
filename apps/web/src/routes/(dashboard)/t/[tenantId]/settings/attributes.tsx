import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import type {
  AttributeDefinitionRow,
  AttributeSource,
  AttributeType,
  AttributeVisibility,
  DeviceAttributeImportResult,
} from "@mattrax/enterprise-domain/client";
import { ErrorText, Field, Panel, QueryError } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { Checkbox } from "@mattrax/ui";
import ConfirmDialog from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import {
  optimisticallyRemoveCollectionItems,
  optimisticallyUpdateCollection,
} from "~/lib/optimistic";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { ReadOnlyNotice, useCan } from "~/lib/permissions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-xs text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30";

const textareaClass =
  "min-h-40 w-full rounded-lg border border-input bg-transparent p-2.5 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30";

const typeLabels: Readonly<Record<AttributeType, string>> = {
  text: "Text",
  number: "Number",
  boolean: "True / false",
  date: "Date",
  select: "Select",
};

const sourceLabels: Readonly<Record<AttributeSource, string>> = {
  manual: "Manual",
  script: "Script",
  directory: "Directory",
};

const sourceOptions: ReadonlyArray<{ value: AttributeSource; label: string }> = [
  { value: "manual", label: "Manual — an administrator or CSV sets the value" },
  { value: "script", label: "Script — the bound script reports the value" },
  {
    value: "directory",
    label: "Directory — reserved, no directory connector collects it yet",
  },
];

type Draft = {
  key: string;
  label: string;
  type: AttributeType;
  options: string;
  required: boolean;
  visibility: AttributeVisibility;
  source: AttributeSource;
  scriptId: string;
  scriptOutputKey: string;
  sortOrder: number;
};

const emptyDraft = (sortOrder: number): Draft => ({
  key: "",
  label: "",
  type: "text",
  options: "",
  required: false,
  visibility: "visible",
  source: "manual",
  scriptId: "",
  scriptOutputKey: "",
  sortOrder,
});

const draftFromRow = (row: AttributeDefinitionRow): Draft => ({
  key: row.key,
  label: row.label,
  type: row.type,
  options: (row.options ?? []).join(", "),
  required: row.required,
  visibility: row.visibility,
  source: row.source,
  scriptId: row.scriptId ?? "",
  scriptOutputKey: row.scriptOutputKey ?? "",
  sortOrder: row.sortOrder,
});

/**
 * The binding fields a save sends. A non-script source explicitly clears the
 * binding so a stale script id cannot survive a switch to manual.
 */
const bindingOf = (draft: Draft) =>
  draft.source === "script"
    ? {
        source: draft.source,
        scriptId: draft.scriptId || null,
        scriptOutputKey: draft.scriptOutputKey.trim() || null,
      }
    : { source: draft.source, scriptId: null, scriptOutputKey: null };

const optionsOf = (draft: Draft) =>
  draft.type === "select"
    ? draft.options
        .split(",")
        .map((option) => option.trim())
        .filter(Boolean)
    : undefined;

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.attributes(params.tenantId)),
    ]);
  },
};

export default function AttributeSettingsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const writable = () => can("devices.write");

  const definitions = useQuery(() => enterpriseQueries.attributes(params.tenantId));
  const scripts = useQuery(() => enterpriseQueries.scripts(params.tenantId));

  const scriptOptions = () => scripts.data?.scripts ?? [];

  const [draft, setDraft] = createSignal<Draft>(emptyDraft(0));
  const [editing, setEditing] = createSignal<string | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<AttributeDefinitionRow | null>(null);
  const [error, setError] = createSignal<unknown>();
  const [csv, setCsv] = createSignal("");

  const [importResults, setImportResults] =
    createSignal<ReadonlyArray<DeviceAttributeImportResult> | null>(null);

  const [importSummary, setImportSummary] = createSignal<{
    updated: number;
    failed: number;
  } | null>(null);

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: enterpriseKeys.attributes(params.tenantId) });
    await qc.invalidateQueries({ queryKey: enterpriseKeys.deviceSearch(params.tenantId) });
    await qc.invalidateQueries({ queryKey: enterpriseKeys.enrollmentQuestions(params.tenantId) });
    await qc.invalidateQueries({ queryKey: enterpriseKeys.policyVariables(params.tenantId) });
  };

  createEffect(
    () => writable(),
    (allowed) => {
      if (!allowed) {
        setEditing(null);
        setDraft(emptyDraft(0));
      }
    },
  );

  const reset = () => {
    setEditing(null);
    setDraft(emptyDraft(definitions.data?.rows.length ?? 0));
    setError(undefined);
  };

  const save = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: () => {
      const current = draft();

      if (editing()) {
        return enterprise.patchAttribute(params.tenantId, editing()!, {
          label: current.label,
          type: current.type,
          options: optionsOf(current) ?? null,
          required: current.required,
          visibility: current.visibility,
          sortOrder: current.sortOrder,
          ...bindingOf(current),
        });
      }

      return enterprise.createAttribute(params.tenantId, {
        key: current.key,
        label: current.label,
        type: current.type,
        options: optionsOf(current),
        required: current.required,
        visibility: current.visibility,
        sortOrder: current.sortOrder,
        ...bindingOf(current),
      });
    },
    onMutate: async () => {
      const current = draft();
      const id = editing();

      // A create has no id until the server answers, so only an edit is written
      // ahead of the response; the settled invalidation picks the new row up.
      if (!id) return;

      return optimisticallyUpdateCollection(
        qc,
        enterpriseKeys.attributes(params.tenantId),
        "rows",
        (rows: AttributeDefinitionRow[]) =>
          rows.map((row): AttributeDefinitionRow =>
            row.id === id
              ? {
                  ...row,
                  label: current.label,
                  type: current.type,
                  options: optionsOf(current) ?? null,
                  required: current.required,
                  visibility: current.visibility,
                  source: current.source,
                  scriptId: bindingOf(current).scriptId,
                  scriptOutputKey: bindingOf(current).scriptOutputKey,
                  scriptName:
                    scriptOptions().find((script) => script.id === current.scriptId)?.name ?? null,
                  sortOrder: current.sortOrder,
                }
              : row,
          ),
      );
    },
    onSuccess: () => {
      reset();
      void invalidate();

      setDraft(emptyDraft((definitions.data?.rows.length ?? 0) + 1));
    },
    onError: (cause, _variables, restore) => {
      restore?.();
      setError(cause);
    },
  }));

  const remove = useMutation(() => ({
    mutationFn: (id: string) => enterprise.deleteAttribute(params.tenantId, id),
    onMutate: async (id) =>
      optimisticallyRemoveCollectionItems(qc, enterpriseKeys.attributes(params.tenantId), "rows", [
        id,
      ]),
    onSuccess: () => {
      setDeleteTarget(null);
      void invalidate();
    },
    onError: (cause, _variables, restore) => {
      restore?.();
      setError(cause);
    },
  }));

  const importValues = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: () => enterprise.importDeviceAttributes(params.tenantId, csv()),
    onSuccess: async (result) => {
      setImportResults(result.results);
      setImportSummary({ updated: result.updated, failed: result.failed });
      await invalidate();
    },
    onError: (cause) => setError(cause),
  }));

  const readCsvFile = async (file: File | undefined) => {
    if (!file) return;

    setCsv(await file.text());
    setImportResults(null);
    setImportSummary(null);
  };

  return (
    <div class="grid gap-5 xl:grid-cols-2">
      <Show when={!writable()}>
        <ReadOnlyNotice class="xl:col-span-2">
          Your role can view the attribute registry but not change devices or their attributes.
        </ReadOnlyNotice>
      </Show>
      <QueryError error={definitions.error} onRetry={() => void definitions.refetch()} />
      <QueryError error={scripts.error} onRetry={() => void scripts.refetch()} />

      <Panel
        class="xl:col-span-2"
        title="Device attributes"
        description="Define the fields your organisation tracks on devices. Keys are stable: they become CSV columns and ${attribute.<key>} policy variables."
        flush
      >
        <Show
          when={(definitions.data?.rows.length ?? 0) > 0}
          fallback={
            <p class="px-4 py-6 text-xs text-muted-foreground sm:px-5">
              {definitions.isPending
                ? "Loading attributes…"
                : "No attributes yet. Add cost centre, warranty end or anything else you track."}
            </p>
          }
        >
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="border-b border-border text-xs uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th class="px-4 py-2 font-medium sm:px-5">Label</th>
                  <th class="px-3 py-2 font-medium">Key</th>
                  <th class="px-3 py-2 font-medium">Type</th>
                  <th class="px-3 py-2 font-medium">Source</th>
                  <th class="px-3 py-2 font-medium">Required</th>
                  <th class="px-3 py-2 font-medium">Visibility</th>
                  <th class="px-3 py-2 font-medium">Devices</th>
                  <th class="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                <For each={definitions.data?.rows ?? []}>
                  {(row) => (
                    <tr class="hover:bg-hover">
                      <td class="px-4 py-2.5 font-medium text-foreground sm:px-5">{row.label}</td>
                      <td class="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                        {row.key}
                      </td>
                      <td class="px-3 py-2.5">{typeLabels[row.type]}</td>
                      <td class="px-3 py-2.5">
                        <Show when={row.source === "script"} fallback={sourceLabels[row.source]}>
                          <span title={`Output key: ${row.scriptOutputKey ?? row.key}`}>
                            Script · {row.scriptName ?? "unavailable"}
                          </span>
                        </Show>
                      </td>
                      <td class="px-3 py-2.5">{row.required ? "Yes" : "No"}</td>
                      <td class="px-3 py-2.5 capitalize">{row.visibility}</td>
                      <td class="px-3 py-2.5">{row.deviceCount ?? 0}</td>
                      <td class="px-3 py-2.5 text-right">
                        <Show when={writable()}>
                          <div class="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => {
                                setEditing(row.id);
                                setDraft(draftFromRow(row));
                                setError(undefined);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => setDeleteTarget(row)}
                            >
                              <span class="text-destructive">Delete</span>
                            </Button>
                          </div>
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Panel>

      <Panel
        title={editing() ? "Edit attribute" : "Add attribute"}
        description="Required attributes must have a value on every device. Hidden attributes are not shown in tables or exports."
      >
        <div class="grid gap-4 sm:grid-cols-2">
          <Field
            label="Key"
            hint="Lowercase letters, numbers and underscores. Cannot be changed later."
          >
            <Input
              value={draft().key}
              disabled={!writable() || editing() !== null}
              placeholder="cost_centre"
              onInput={(event) => setDraft({ ...draft(), key: event.currentTarget.value })}
            />
          </Field>
          <Field label="Label">
            <Input
              value={draft().label}
              disabled={!writable()}
              placeholder="Cost centre"
              onInput={(event) => setDraft({ ...draft(), label: event.currentTarget.value })}
            />
          </Field>
          <Field label="Type">
            <select
              class={selectClass}
              value={draft().type}
              disabled={!writable()}
              onChange={(event) => {
                // SAFETY: the select only renders options from `typeLabels`.
                const type = event.currentTarget.value as AttributeType;

                setDraft({ ...draft(), type });
              }}
            >
              <For each={Object.entries(typeLabels)}>
                {([value, label]) => <option value={value}>{label}</option>}
              </For>
            </select>
          </Field>
          <Show when={draft().type === "select"}>
            <Field label="Options" hint="Comma separated, for example EMEA, AMER, APAC.">
              <Input
                value={draft().options}
                disabled={!writable()}
                placeholder="EMEA, AMER, APAC"
                onInput={(event) => setDraft({ ...draft(), options: event.currentTarget.value })}
              />
            </Field>
          </Show>
          <Field label="Visibility">
            <select
              class={selectClass}
              value={draft().visibility}
              disabled={!writable()}
              onChange={(event) => {
                // SAFETY: the select only renders the two AttributeVisibility values.
                const visibility = event.currentTarget.value as AttributeVisibility;

                setDraft({ ...draft(), visibility });
              }}
            >
              <option value="visible">Visible in tables and exports</option>
              <option value="hidden">Hidden from tables and exports</option>
            </select>
          </Field>
          <Field
            label="Source"
            hint="Script values are read-only here: the bound script owns them."
          >
            <select
              class={selectClass}
              value={draft().source}
              disabled={!writable()}
              onChange={(event) => {
                // SAFETY: the select only renders AttributeSource values.
                const source = event.currentTarget.value as AttributeSource;

                setDraft({ ...draft(), source });
              }}
            >
              <For each={sourceOptions}>
                {(option) => <option value={option.value}>{option.label}</option>}
              </For>
            </select>
          </Field>
          <Show when={draft().source === "script"}>
            <Field
              label="Script"
              hint={
                scriptOptions().length === 0
                  ? "No scripts yet. Create one under Scripts first."
                  : "The script must be enabled and assigned to the devices it should report for."
              }
            >
              <select
                class={selectClass}
                value={draft().scriptId}
                disabled={!writable()}
                onChange={(event) => setDraft({ ...draft(), scriptId: event.currentTarget.value })}
              >
                <option value="">Choose a script…</option>
                <For each={scriptOptions()}>
                  {(script) => <option value={script.id}>{script.name}</option>}
                </For>
              </select>
            </Field>
            <Field
              label="Output key"
              hint="JSON key on stdout. Leave blank to use the attribute key; line output uses the attribute list order."
            >
              <Input
                value={draft().scriptOutputKey}
                disabled={!writable()}
                placeholder={draft().key || "antivirus"}
                onInput={(event) =>
                  setDraft({ ...draft(), scriptOutputKey: event.currentTarget.value })
                }
              />
            </Field>
          </Show>
          <Show when={draft().source === "directory"}>
            <p class="text-xs text-muted-foreground sm:col-span-2">
              Directory collection is not implemented yet. Choosing it records intent; values can
              still be edited manually until a directory connector lands.
            </p>
          </Show>
          <label class="flex items-center gap-2 self-end pb-2 text-xs">
            <Checkbox
              checked={draft().required}
              disabled={!writable()}
              onCheckedChange={(checked) => setDraft({ ...draft(), required: checked === true })}
            />
            Required on every device
          </label>
        </div>
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <Button
            disabled={
              !writable() ||
              save.isPending ||
              !draft().key ||
              !draft().label ||
              (draft().source === "script" && !draft().scriptId)
            }
            onClick={() => save.mutate()}
          >
            {editing() ? "Save attribute" : "Add attribute"}
          </Button>
          <Show when={editing()}>
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </Show>
        </div>
        <ErrorText error={error()} />
      </Panel>

      <Panel
        title="Import device values"
        description="CSV with a serial column and one attribute:<key> column per attribute. Empty cells clear the value; values are validated before they are written."
      >
        <div class="space-y-3">
          <div class="space-y-1.5">
            <label
              for="attribute-csv-file"
              class="block text-xs font-medium text-foreground/90"
            >
              Import device values CSV
            </label>
            <input
              id="attribute-csv-file"
              type="file"
              accept=".csv,text/csv"
              class="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-2.5 file:py-1.5 file:text-xs file:text-foreground"
              onChange={(event) => void readCsvFile(event.currentTarget.files?.[0])}
            />
          </div>
          <textarea
            class={textareaClass}
            aria-label="Attribute CSV"
            placeholder={
              "serial,attribute:cost_centre,attribute:warranty_end\nC02EXAMPLE001,EMEA,2027-01-31"
            }
            value={csv()}
            onInput={(event) => setCsv(event.currentTarget.value)}
          />
          <div class="flex flex-wrap items-center gap-2">
            <Button
              disabled={!writable() || !csv().trim() || importValues.isPending}
              onClick={() => importValues.mutate()}
            >
              {importValues.isPending ? "Importing…" : "Import values"}
            </Button>
            <Button as="a" variant="outline" href={`/t/${params.tenantId}/devices`}>
              Export from Devices
            </Button>
          </div>
          <Show when={importSummary()}>
            {(summary) => (
              <p class="text-xs text-muted-foreground">
                {summary().updated} row{summary().updated === 1 ? "" : "s"} applied
                {summary().failed > 0 ? `, ${summary().failed} failed` : ""}.
              </p>
            )}
          </Show>
          <Show when={importResults()?.length}>
            <ul class="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-3 text-xs">
              <For each={importResults() ?? []}>
                {(result) => (
                  <li
                    class={result.status === "error" ? "text-destructive" : "text-muted-foreground"}
                  >
                    Row {result.row}
                    {result.serial ? ` (${result.serial})` : ""}: {result.status}
                    {result.error ? ` — ${result.error}` : ""}
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <ErrorText error={importValues.error} />
        </div>
      </Panel>

      <ConfirmDialog
        open={deleteTarget() !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget()?.label ?? "this attribute"}?`}
        description="Every device value for this attribute is deleted, it stops appearing as a CSV column, and any policy using its variable is rejected until the reference is removed."
        confirmLabel="Delete attribute"
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          const target = deleteTarget();

          if (target) remove.mutate(target.id);
        }}
      />
    </div>
  );
}
