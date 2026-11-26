import { useParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { createSignal, Show } from "solid-js";
import CisTemplateDialog from "~/components/mdm/cis-template-dialog";
import type { CisTemplateOutcome } from "~/components/mdm/cis-template-dialog";
import { ErrorText, Field, Page, PageHeader, Panel } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ShieldCheck } from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { AccessDenied, useCan } from "~/lib/permissions";
import { ScopeTagSelect } from "~/components/scope-tags/scope-tag-select";
import { policyToConfigurations } from "~/lib/policy-designer/build";
import type { PolicyDraft } from "~/lib/policy-designer/build";

const textareaClass =
  "min-h-28 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export default function NewPolicyPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCan();
  const [name, setName] = createSignal("");
  const [nameInvalid, setNameInvalid] = createSignal(false);
  const [notes, setNotes] = createSignal("");
  const [scopeTags, setScopeTags] = createSignal<Array<string>>([]);
  const [cisOpen, setCisOpen] = createSignal(false);
  const [cisTemplate, setCisTemplate] = createSignal<CisTemplateOutcome | null>(null);

  const create = useMutation(() => ({
    mutationFn: async () => {
      const template = cisTemplate();

      const configurations = template
        ? policyToConfigurations({
            version: 2,
            name: name(),
            platforms: { [template.template.platform]: template.selections },
          } satisfies PolicyDraft)
        : undefined;

      const payload = {
        name: name(),
        notes: notes() || null,
        ...(configurations ? { configurations } : {}),
      };

      const policy = await enterprise.createPolicy(params.tenantId, payload);

      return { ...policy, fromTemplate: template !== null };
    },
    onSuccess: async ({ id, fromTemplate }) => {
      // Tagging is a second request. If it fails, keep the created resource
      // and let the detail page's tag editor retry rather than leaving the
      // form ready to create a duplicate on the next click.
      if (scopeTags().length > 0) {
        try {
          await enterprise.setScopeTagAssignments(params.tenantId, {
            resourceType: "policy",
            resourceIds: [id],
            tagIds: scopeTags(),
          });
        } catch {
          // The resource exists; its tag editor remains available.
        }
      }

      await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "policy") });
      await qc.invalidateQueries({
        queryKey: enterpriseKeys.entitySearchPrefix(params.tenantId, "policy"),
      });
      navigate(`/t/${params.tenantId}/policies/${id}/${fromTemplate ? "design" : "editor"}`);
    },
  }));

  return (
    <Show when={can("policies.write")} fallback={<AccessDenied />}>
      <Page>
        <PageHeader
          eyebrow="Policies"
          title="Create policy"
          description="Create a policy, then configure payloads in the editor or start from a CIS benchmark."
        />
        <div
      class="grid max-w-3xl gap-5 lg:grid-cols-(--policy-cols) lg:items-start"
      style={{ "--policy-cols": "minmax(0,1fr) 260px" }}
    >
          <Panel
            title="Policy details"
            description="Name and internal notes are required metadata."
          >
            <form
              class="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <Field label="Name" hint="Shown across the dashboard and on managed devices.">
                <Input
                  required
                  value={name()}
                  aria-invalid={nameInvalid() ? "true" : "false"}
                  onInvalid={() => setNameInvalid(true)}
                  onInput={(e) => {
                    setName(e.currentTarget.value);

                    if (nameInvalid() && e.currentTarget.value.trim()) setNameInvalid(false);
                  }}
                  placeholder="e.g. Corporate Mac baseline"
                />
              </Field>
              <Field label="Notes" hint="Optional. Describe what this policy enforces and why.">
                <textarea
                  class={textareaClass}
                  value={notes()}
                  onInput={(e) => setNotes(e.currentTarget.value)}
                  placeholder="What does this policy do?"
                />
              </Field>
              <Field
                label="Start from a template"
                hint="Optional. Apply a reviewed CIS benchmark, then tune the settings in the designer."
              >
                <Show
                  when={cisTemplate()}
                  fallback={
                    <Button type="button" variant="outline" onClick={() => setCisOpen(true)}>
                      <ShieldCheck class="mr-1.5 size-4" /> Choose a CIS benchmark
                    </Button>
                  }
                >
                  {(template) => (
                    <div class="rounded-lg border border-border bg-surface/60 p-3">
                      <div class="flex flex-wrap items-start justify-between gap-2">
                        <div class="min-w-0">
                          <p class="text-xs font-semibold text-foreground">
                            {template().template.benchmark.name}
                          </p>
                          <p class="mt-0.5 text-xs text-muted-foreground">
                            Version {template().template.benchmark.version} ·{" "}
                            {template().appliedControls} control
                            {template().appliedControls === 1 ? "" : "s"} ·{" "}
                            {template().appliedSettings} setting
                            {template().appliedSettings === 1 ? "" : "s"}
                          </p>
                        </div>
                        <div class="flex shrink-0 gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setCisOpen(true)}
                          >
                            Change
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setCisTemplate(null)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </Show>
              </Field>
              <ScopeTagSelect
                tenantId={params.tenantId!}
                value={scopeTags()}
                onChange={setScopeTags}
              />
              <ErrorText error={create.error} />
              <div class="flex flex-wrap items-center gap-2 pt-1">
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? "Creating…" : "Create policy"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => navigate(`/t/${params.tenantId}/policies`)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Panel>

          <Panel class="hidden lg:block">
            <div class="flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground">
              <ShieldCheck class="size-4" />
            </div>
            <h2 class="mt-3 text-xs font-semibold text-foreground">What happens next</h2>
            <ol class="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
              <li class="flex gap-2">
                <span class="font-mono text-xs text-muted-foreground">01</span>
                Add restrictions, certificates or a custom profile in the advanced editor.
              </li>
              <li class="flex gap-2">
                <span class="font-mono text-xs text-muted-foreground">02</span>
                Or open the designer to build the policy visually from the catalogue.
              </li>
              <li class="flex gap-2">
                <span class="font-mono text-xs text-muted-foreground">03</span>
                Assign the policy to groups or devices, then sync.
              </li>
            </ol>
          </Panel>
        </div>
      </Page>
      <CisTemplateDialog
        open={cisOpen()}
        platform={cisTemplate()?.template.platform}
        selections={cisTemplate()?.selections ?? []}
        onOpenChange={setCisOpen}
        onApply={(outcome) => setCisTemplate(outcome)}
      />
    </Show>
  );
}
