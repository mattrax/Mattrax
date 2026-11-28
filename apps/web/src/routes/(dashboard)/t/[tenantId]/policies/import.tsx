import { useParams, useSearchParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Effect, Match, Option, Schema } from "effect";
import type { PortablePolicy } from "@mattrax/enterprise-domain/client";
import { createMemo, createSignal, For, Show } from "solid-js";
import {
  ErrorText,
  Field,
  Page,
  PageHeader,
  Panel,
  QueryError,
  SkeletonRows,
} from "~/components/mdm/common";
import { Badge } from "@mattrax/ui";
import { Button } from "@mattrax/ui";
import { Input } from "@mattrax/ui";
import { CheckCircle2, CircleAlert, Info } from "~/components/ui/icons";
import { toast } from "~/components/toast";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { errorMessage, raisedFailure } from "~/lib/errors";
import {
  mobileconfigFromBytes,
  normalizeMobileconfig,
  parsePolicyImportText,
  planMobileconfigImport,
  planPolicyImport,
  policyImportActionLabel,
} from "~/lib/policy-import";
import type {
  PolicyImportAction,
  PolicyImportConflict,
  PolicyImportPlan,
  PolicyImportTarget,
} from "~/lib/policy-import";
import { AccessDenied, useCan } from "~/lib/permissions";
import { handleStaleWriteWithToast } from "~/lib/stale-write-toast";

const ImportTargetSchema = Schema.Struct({
  name: Schema.String,
  notes: Schema.optional(Schema.NullOr(Schema.String)),
  configurations: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
  configurationScopes: Schema.optional(
    Schema.Record(Schema.String, Schema.Literals(["device", "user"])),
  ),
});

const decodeTarget = Schema.decodeUnknownOption(ImportTargetSchema);

const textareaClass =
  "min-h-36 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-xs leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const MOBILECONFIG_EXTENSION = /\.(mobileconfig|plist)$/i;

const importActionVariant = (action: PolicyImportAction) =>
  Match.value(action).pipe(
    Match.when("add", () => "success" as const),
    Match.when("overwrite", () => "warning" as const),
    Match.orElse(() => "outline" as const),
  );

const pastedMobileconfig = (text: string) =>
  text.startsWith("<?xml") ||
  text.startsWith("<plist") ||
  /-----BEGIN (?:PKCS7|CMS)-----/.test(text);

/** The parsed source, kept separate from the plan so a conflict toggle re-plans. */
type ParsedSource =
  | { readonly kind: "document"; readonly policy: PortablePolicy }
  | {
      readonly kind: "mobileconfig";
      readonly content: string;
      readonly signed: boolean;
      readonly fileName?: string;
      readonly displayName?: string;
      readonly description?: string;
      readonly scope?: "device" | "user";
    };

/** Read query data only after success so a pending or disabled query cannot suspend the page. */
function settledQueryData<T>(query: {
  readonly isSuccess: boolean;
  readonly data: T | undefined;
}): T | undefined {
  return query.isSuccess ? query.data : undefined;
}

export default function ImportPolicyPage() {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCan();

  const targetId = () => {
    const value = searchParams.policy;

    return Array.isArray(value) ? value[0] : value;
  };

  const target = useQuery(() => ({
    queryKey: enterpriseKeys.item(params.tenantId, "policy", targetId()),
    queryFn: () => enterprise.get(params.tenantId, "policy", targetId()),
    enabled: Boolean(targetId()),
  }));

  const row = (): PolicyImportTarget | undefined =>
    Option.getOrUndefined(decodeTarget(settledQueryData(target)));

  /** A `?policy=` that has not loaded is not an invitation to create a policy. */
  const targetPending = () => Boolean(targetId()) && target.isPending;
  const targetUnavailable = () => Boolean(targetId()) && !target.isPending && row() === undefined;

  const [sourceText, setSourceText] = createSignal("");
  const [fileName, setFileName] = createSignal<string | undefined>();
  const [parsed, setParsed] = createSignal<ParsedSource | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [conflict, setConflict] = createSignal<PolicyImportConflict>("skip");
  const [name, setName] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [priority, setPriority] = createSignal("0");

  const plan = createMemo<PolicyImportPlan | null>(() => {
    const value = parsed();

    if (!value) return null;

    if (value.kind === "document")
      return planPolicyImport({
        policy: value.policy,
        existing: row(),
        conflict: conflict(),
      });

    return planMobileconfigImport({
      content: value.content,
      signed: value.signed,
      fileName: value.fileName,
      displayName: value.displayName,
      description: value.description,
      scope: value.scope,
      existing: row(),
      conflict: conflict(),
    });
  });

  const seed = (next: PolicyImportPlan) => {
    if (row()) return;

    setName(next.name);
    setNotes(next.notes ?? "");
    setPriority(String(next.priority ?? 0));
  };

  const previewMobileconfig = async (
    profile: { content: string; signed: boolean },
    file?: string,
  ) => {
    setBusy(true);
    setError(null);

    try {
      // The existing preview endpoint is the authoritative parser: it unwraps a
      // signed profile and returns the display name, description and scope.
      const preview = await enterprise.previewMobileconfig(profile.content);

      const next = {
        kind: "mobileconfig" as const,
        content: profile.content,
        signed: profile.signed,
        fileName: file,
        displayName: preview.displayName,
        description: preview.description,
        scope: preview.scope,
      };

      setParsed(next);
      seed(
        planMobileconfigImport({
          content: next.content,
          signed: next.signed,
          fileName: next.fileName,
          displayName: next.displayName,
          description: next.description,
          scope: next.scope,
          existing: row(),
          conflict: conflict(),
        }),
      );
    } catch (error_) {
      setError(errorMessage(raisedFailure(error_), "This is not a valid .mobileconfig profile."));
    } finally {
      setBusy(false);
    }
  };

  const previewDocument = async (text: string, source: string) => {
    setBusy(true);
    setError(null);

    try {
      const policy = await Effect.runPromise(parsePolicyImportText(text, source));

      setParsed({ kind: "document", policy });
      seed(planPolicyImport({ policy, existing: row(), conflict: conflict() }));
    } catch (error_) {
      setError(errorMessage(raisedFailure(error_), "This is not a valid policy document."));
    } finally {
      setBusy(false);
    }
  };

  const readText = async (text: string, source: string) => {
    setSourceText(text);
    setParsed(null);

    if (pastedMobileconfig(text.trim()))
      return previewMobileconfig(normalizeMobileconfig({ content: text }), source);

    return previewDocument(text, source);
  };

  const readFile = async (file: File) => {
    setFileName(file.name);
    setError(null);
    setParsed(null);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());

      if (MOBILECONFIG_EXTENSION.test(file.name))
        return await previewMobileconfig(mobileconfigFromBytes(bytes, file.name), file.name);

      return await previewDocument(new TextDecoder().decode(bytes), file.name);
    } catch (error_) {
      setError(errorMessage(raisedFailure(error_), "Could not read that file."));
    }
  };

  const writable = () => can("policies.write");

  const writableConfigurations = () => Object.keys(plan()?.payload.configurations ?? {}).length;

  const clearTarget = () => {
    setSearchParams({ policy: undefined }, { replace: true });
    setParsed(null);
    setSourceText("");
    setFileName(undefined);
    setError(null);
  };

  const save = useMutation(() => ({
    mutationFn: async () => {
      const next = plan();

      if (!next) throw new Error("Preview a policy before importing it.");

      if (targetId() && !row())
        throw new Error("The target policy has not loaded. Reload the page and try again.");

      if (next.blocked)
        throw new Error("This import cannot be saved. Fix the highlighted problem.");

      if (writableConfigurations() === 0) throw new Error("There is nothing to import.");

      if (!row() && !name().trim()) throw new Error("Give the policy a name.");

      if (!row())
        return enterprise.createPolicy(params.tenantId, {
          name: name().trim(),
          notes: notes().trim() || null,
          priority: Number(priority()) || 0,
          enabled: next.enabled,
          configurations: next.payload.configurations,
          configurationScopes: next.payload.configurationScopes,
        });

      await enterprise.patchPolicy(params.tenantId, targetId(), {
        configurations: next.payload.configurations,
        configurationScopes: next.payload.configurationScopes,
        expectedUpdatedAt: target.data?.updatedAt,
      });

      return { id: targetId()! };
    },
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "policy") });
      await qc.invalidateQueries({
        queryKey: enterpriseKeys.item(params.tenantId, "policy", id),
      });
      toast.success(row() ? "Configurations imported" : "Policy imported");
      navigate(`/t/${params.tenantId}/policies/${id}`);
    },
    onError: (cause) => {
      if (
        handleStaleWriteWithToast(cause, {
          reload: () =>
            qc.invalidateQueries({
              queryKey: enterpriseKeys.item(params.tenantId, "policy", targetId()),
            }),
        })
      )
        return;

      toast.error("Could not import", {
        description: errorMessage(raisedFailure(cause), "Try again in a moment."),
      });
    },
  }));

  const counts = createMemo(() => {
    const configurations = plan()?.configurations ?? [];

    return {
      added: configurations.filter((entry) => entry.action === "add").length,
      replaced: configurations.filter((entry) => entry.action === "overwrite").length,
      unchanged: configurations.filter((entry) => entry.action === "unchanged").length,
      skipped: configurations.filter((entry) => entry.action === "skip").length,
    };
  });

  const backHref = () =>
    row() && targetId()
      ? `/t/${params.tenantId}/policies/${targetId()}`
      : `/t/${params.tenantId}/policies`;

  return (
    <Show when={writable()} fallback={<AccessDenied />}>
      <Page>
        <a
          href={backHref()}
          class="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          ← {row() ? "Back to policy" : "Back to policies"}
        </a>
        <PageHeader
          eyebrow="Policies"
          title={row() ? `Import into ${row()!.name}` : "Import policy"}
          description={
            row()
              ? "Add configurations from a file or a policy exported from Mattrax. The policy's name, notes, priority and assignments stay as they are."
              : "Create a policy from a .mobileconfig profile or a policy exported from Mattrax."
          }
          actions={
            <Show when={row()}>
              <Button variant="outline" onClick={clearTarget}>
                Import into a new policy
              </Button>
            </Show>
          }
        />

        <QueryError error={target.error} onRetry={() => void target.refetch()} />

        <Show
          when={!targetPending() && !targetUnavailable()}
          fallback={
            <Panel
              title={targetPending() ? "Loading policy" : "Policy unavailable"}
              description={
                targetPending()
                  ? "Loading the policy this import adds configurations to."
                  : "The policy in this link could not be loaded, so the import stays in merge mode instead of creating a new policy."
              }
            >
              <Show
                when={targetPending()}
                fallback={
                  <div class="space-y-3">
                    <p class="text-xs leading-relaxed text-muted-foreground">
                      Nothing has been created. Reload the page to retry, or start a new policy
                      explicitly.
                    </p>
                    <Button variant="outline" onClick={clearTarget}>
                      Import into a new policy
                    </Button>
                  </div>
                }
              >
                <SkeletonRows rows={3} />
              </Show>
            </Panel>
          }
        >
          <div
          class="grid max-w-5xl gap-5 lg:grid-cols-(--import-grid) lg:items-start"
          style={{ "--import-grid": "minmax(0,1fr) 320px" }}
        >
            <div class="space-y-5">
              <Panel
                title="Source"
                description="Upload a file or paste a policy document. A .mobileconfig creates one Apple profile configuration."
              >
                <div class="space-y-4">
                  <Field label="File" hint="Accepts .mobileconfig, .plist, .json, .yaml and .yml.">
                    <input
                      type="file"
                      accept=".mobileconfig,.plist,.json,.yaml,.yml,application/json"
                      class="block w-full cursor-pointer rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-xs text-foreground file:mr-2 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:text-foreground"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];

                        if (file) void readFile(file);
                      }}
                    />
                  </Field>

                  <Field
                    label="Or paste"
                    hint="A policy document exported with `mattrax policies export`, or a mobileconfig saved as text."
                  >
                    <textarea
                      class={textareaClass}
                      value={sourceText()}
                      onInput={(event) => setSourceText(event.currentTarget.value)}
                      placeholder={'{ "version": 1, "policies": [ … ] }'}
                    />
                  </Field>

                  <div class="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={() =>
                        void readText(sourceText(), fileName() ?? "The pasted document")
                      }
                      disabled={busy() || sourceText().trim().length === 0}
                    >
                      {busy() ? "Reading…" : "Preview"}
                    </Button>
                    <Show when={parsed()}>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setParsed(null);
                          setSourceText("");
                          setFileName(undefined);
                          setError(null);
                        }}
                      >
                        Clear
                      </Button>
                    </Show>
                  </div>

                  <Show when={error()}>
                    {(message) => (
                      <p role="alert" class="text-xs leading-relaxed text-destructive">
                        {message()}
                      </p>
                    )}
                  </Show>

                  <Show when={row()}>
                    <div class="space-y-2 rounded-lg border border-border bg-muted/15 px-3 py-2.5">
                      <p class="label-caps">Existing configurations</p>
                      <p class="text-xs leading-relaxed text-muted-foreground">
                        A kind the policy already has is kept unless you choose to replace it.
                      </p>
                      <div class="flex flex-col gap-1.5 text-xs text-muted-foreground">
                        <label class="flex items-center gap-2">
                          <Input
                            type="radio"
                            name="conflict"
                            checked={conflict() === "skip"}
                            onChange={() => setConflict("skip")}
                          />
                          Skip existing kinds
                        </label>
                        <label class="flex items-center gap-2">
                          <Input
                            type="radio"
                            name="conflict"
                            checked={conflict() === "overwrite"}
                            onChange={() => setConflict("overwrite")}
                          />
                          Replace existing kinds
                        </label>
                      </div>
                    </div>
                  </Show>
                </div>
              </Panel>

              <Show when={plan()}>
                {(value) => (
                  <Panel
                    title="Preview"
                    description="Nothing is saved until you import, and the server validates every configuration before writing."
                    actions={
                      <Badge variant="outline">
                        <Info class="size-3" />
                        {value().source === "mobileconfig" ? "mobileconfig" : "policy document"}
                      </Badge>
                    }
                  >
                    <div class="space-y-4">
                      <Show when={!row()}>
                        <div
                        class="grid gap-3 sm:grid-cols-(--import-row-grid)"
                        style={{ "--import-row-grid": "minmax(0,1fr) 120px" }}
                      >
                          <Field label="Policy name">
                            <Input
                              value={name()}
                              onInput={(event) => setName(event.currentTarget.value)}
                            />
                          </Field>
                          <Field label="Priority">
                            <Input
                              type="number"
                              min="0"
                              step="1"
                              value={priority()}
                              onInput={(event) => setPriority(event.currentTarget.value)}
                            />
                          </Field>
                        </div>
                        <Field label="Notes" hint="Optional.">
                          <textarea
                            class={`${textareaClass} min-h-20 font-sans text-xs`}
                            value={notes()}
                            onInput={(event) => setNotes(event.currentTarget.value)}
                          />
                        </Field>
                      </Show>

                      <div class="flex flex-wrap items-center gap-1.5 text-xs">
                        <Show when={counts().added > 0}>
                          <Badge variant="success">
                            {counts().added} added
                          </Badge>
                        </Show>
                        <Show when={counts().replaced > 0}>
                          <Badge variant="warning">
                            {counts().replaced} replaced
                          </Badge>
                        </Show>
                        <Show when={counts().unchanged > 0}>
                          <Badge variant="outline">
                            {counts().unchanged} unchanged
                          </Badge>
                        </Show>
                        <Show when={counts().skipped > 0}>
                          <Badge variant="outline">
                            {counts().skipped} skipped
                          </Badge>
                        </Show>
                      </div>

                      <Show
                        when={value().configurations.length > 0}
                        fallback={
                          <p class="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-xs text-muted-foreground">
                            The document does not contain configurations. Use the editor to add them
                            manually.
                          </p>
                        }
                      >
                        <div class="divide-y divide-border overflow-hidden rounded-lg border border-border">
                          <For each={value().configurations}>
                            {(entry) => (
                              <div class="flex flex-wrap items-center gap-2 bg-muted/10 px-3 py-2.5">
                                <span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                                  {entry.kind}
                                </span>
                                <Badge variant="outline">
                                  {entry.scope === "user" ? "User channel" : "Device channel"}
                                </Badge>
                                <Badge variant={importActionVariant(entry.action)}>
                                  {policyImportActionLabel(entry.action)}
                                </Badge>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>

                      <Show when={value().warnings.length > 0}>
                        <ul class="space-y-1.5">
                          <For each={value().warnings}>
                            {(warning) => (
                              <li class="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                                <CircleAlert class="mt-0.5 size-3.5 shrink-0" />
                                <span>{warning}</span>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>

                      <Show when={value().blocked}>
                        <p
                          role="alert"
                          class="rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-xs leading-relaxed text-destructive"
                        >
                          This import cannot be saved. Use an unsigned profile if it must be
                          delivered on the user channel.
                        </p>
                      </Show>

                      <div class="flex flex-wrap items-center gap-2">
                        <Button
                          onClick={() => save.mutate()}
                          disabled={
                            save.isPending ||
                            value().blocked ||
                            writableConfigurations() === 0 ||
                            (!row() && name().trim().length === 0)
                          }
                        >
                          {save.isPending
                            ? "Importing…"
                            : row()
                              ? "Import configurations"
                              : "Create policy"}
                        </Button>
                        <Button variant="ghost" onClick={() => navigate(backHref())}>
                          Cancel
                        </Button>
                      </div>
                      <ErrorText error={save.error} />
                    </div>
                  </Panel>
                )}
              </Show>
            </div>

            <Panel class="lg:sticky lg:top-20">
              <div class="flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground">
                <CheckCircle2 class="size-4" />
              </div>
              <h2 class="mt-3 text-xs font-semibold text-foreground">What is imported</h2>
              <ul class="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
                <li>
                  <span class="font-medium text-foreground">Policy document</span> — the format
                  written by <code class="font-mono text-xs">mattrax policies export</code>. It
                  is versioned, accepts YAML or JSON, and holds one policy per import.
                </li>
                <li>
                  <span class="font-medium text-foreground">.mobileconfig</span> — stored as
                  <code class="ml-1 font-mono text-xs">mttx.apple.custom.imported</code>. A
                  signed profile is kept byte-for-byte.
                </li>
                <li>
                  <span class="font-medium text-foreground">Existing policy</span> — only its
                  configurations change; metadata, assignments and the delivery scope of kinds the
                  document does not name are kept.
                </li>
              </ul>
              <Show when={target.isPending && targetId()}>
                <div class="mt-4">
                  <SkeletonRows rows={2} />
                </div>
              </Show>
            </Panel>
          </div>
        </Show>
      </Page>
    </Show>
  );
}
