import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import type {
  AttributeDefinitionRow,
  AttributeType,
  AttributeVisibility,
  DeviceAttributeImportResult,
} from "@mattrax/enterprise-domain/client";
import { ErrorText, Field, Panel, QueryError } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { ReadOnlyNotice, useCan } from "~/lib/permissions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-[13px] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

const textareaClass =
  "min-h-40 w-full rounded-lg border border-input bg-transparent p-2.5 font-mono text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

const typeLabels: Readonly<Record<AttributeType, string>> = {
  text: "Text",
  number: "Number",
  boolean: "True / false",
  date: "Date",
  select: "Select",
};

type Draft = {
  key: string;
  label: string;
  type: AttributeType;
  options: string;
  required: boolean;
  visibility: AttributeVisibility;
  sortOrder: number;
};

const emptyDraft = (sortOrder: number): Draft => ({
  key: "",
  label: "",
  type: "text",
  options: "",
  required: false,
  visibility: "visible",
  sortOrder,
});

const draftFromRow = (row: AttributeDefinitionRow): Draft => ({
  key: row.key,
  label: row.label,
  type: row.type,
  options: (row.options ?? []).join(", "),
  required: row.required,
  visibility: row.visibility,
  sortOrder: row.sortOrder,
});

const optionsOf = (draft: Draft) =>
  draft.type === "select"
    ? draft.options
        .split(",")
        .map((option) => option.trim())
        .filter(Boolean)
    : undefined;

export default function AttributeSettingsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const writable = () => can("devices.write");

  const definitions = useQuery(() => ({
    queryKey: enterpriseKeys.attributes(params.tenantId),
    queryFn: () => enterprise.listAttributes(params.tenantId),
  }));

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
      });
    },
    onSuccess: async () => {
      reset();
      await invalidate();

      setDraft(emptyDraft((definitions.data?.rows.length ?? 0) + 1));
    },
    onError: (cause) => setError(cause),
  }));

  const remove = useMutation(() => ({
    mutationFn: (id: string) => enterprise.deleteAttribute(params.tenantId, id),
    onSuccess: async () => {
      setDeleteTarget(null);
      await invalidate();
    },
    onError: (cause) => setError(cause),
  }));

  const importValues = useMutation(() => ({
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

      <Panel
        class="xl:col-span-2"
        title="Device attributes"
        description="Define the fields your organisation tracks on devices. Keys are stable: they become CSV columns and ${attribute.<key>} policy variables."
        flush
      >
        <Show
          when={(definitions.data?.rows.length ?? 0) > 0}
          fallback={
            <p class="px-4 py-6 text-[13px] text-muted-foreground sm:px-5">
              {definitions.isPending
                ? "Loading attributes…"
                : "No attributes yet. Add cost centre, warranty end or anything else you track."}
            </p>
          }
        >
          <div class="overflow-x-auto">
            <table class="w-full text-left text-[12.5px]">
              <thead class="border-b border-border text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th class="px-4 py-2 font-medium sm:px-5">Label</th>
                  <th class="px-3 py-2 font-medium">Key</th>
                  <th class="px-3 py-2 font-medium">Type</th>
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
                      <td class="px-3 py-2.5 font-mono text-[11.5px] text-muted-foreground">
                        {row.key}
                      </td>
                      <td class="px-3 py-2.5">{typeLabels[row.type]}</td>
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
                              class="text-destructive hover:bg-destructive/10"
                              onClick={() => setDeleteTarget(row)}
                            >
                              Delete
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
          <label class="flex items-center gap-2 self-end pb-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={draft().required}
              disabled={!writable()}
              onChange={(event) => setDraft({ ...draft(), required: event.currentTarget.checked })}
            />
            Required on every device
          </label>
        </div>
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <Button
            disabled={!writable() || save.isPending || !draft().key || !draft().label}
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
          <input
            type="file"
            accept=".csv,text/csv"
            class="block w-full text-[12.5px] text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-2.5 file:py-1.5 file:text-[12px] file:text-foreground"
            onChange={(event) => void readCsvFile(event.currentTarget.files?.[0])}
          />
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
              <p class="text-[12.5px] text-muted-foreground">
                {summary().updated} row{summary().updated === 1 ? "" : "s"} applied
                {summary().failed > 0 ? `, ${summary().failed} failed` : ""}.
              </p>
            )}
          </Show>
          <Show when={importResults()?.length}>
            <ul class="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-3 text-[12px]">
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
