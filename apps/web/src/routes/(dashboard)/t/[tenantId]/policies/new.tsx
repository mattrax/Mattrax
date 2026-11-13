import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { ErrorText, Field, Page, PageHeader, Panel } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ShieldCheck } from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

const textareaClass =
  "min-h-28 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

export default function NewPolicyPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const create = useMutation(() => ({
    mutationFn: () =>
      enterprise.createPolicy(params.tenantId, { name: name(), notes: notes() || null }),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "policy") });
      navigate(`/t/${params.tenantId}/policies/${id}/editor`);
    },
  }));
  return (
    <Page>
      <PageHeader
        eyebrow="Policies"
        title="Create policy"
        description="Create a policy, then configure payloads in the editor."
      />
      <div class="grid max-w-3xl gap-5 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
        <Panel title="Policy details" description="Name and internal notes are required metadata.">
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
                onInput={(e) => setName(e.currentTarget.value)}
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
          <div class="flex size-8 items-center justify-center rounded-lg border border-brand/25 bg-brand-muted text-brand">
            <ShieldCheck class="size-4" />
          </div>
          <h2 class="mt-3 text-[13px] font-semibold text-foreground">What happens next</h2>
          <ol class="mt-2 space-y-2 text-[12px] leading-relaxed text-muted-foreground">
            <li class="flex gap-2">
              <span class="font-mono text-[10px] text-brand">01</span>
              Add restrictions, certificates or a custom profile in the advanced editor.
            </li>
            <li class="flex gap-2">
              <span class="font-mono text-[10px] text-brand">02</span>
              Or open the designer to build the policy visually from the catalogue.
            </li>
            <li class="flex gap-2">
              <span class="font-mono text-[10px] text-brand">03</span>
              Assign the policy to groups or devices, then sync.
            </li>
          </ol>
        </Panel>
      </div>
    </Page>
  );
}
