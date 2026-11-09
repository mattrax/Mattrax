import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { ErrorText, Field, PageHeader } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

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
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Create policy"
        description="Create a policy, then configure payloads in the editor."
      />
      <Card class="max-w-xl">
        <CardContent>
          <form
            class="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label="Name">
              <Input required value={name()} onInput={(e) => setName(e.currentTarget.value)} />
            </Field>
            <Field label="Notes">
              <textarea
                class="min-h-28 rounded-lg border bg-white px-3 py-2 text-sm"
                value={notes()}
                onInput={(e) => setNotes(e.currentTarget.value)}
              />
            </Field>
            <ErrorText error={create.error} />
            <Button type="submit" disabled={create.isPending}>
              Create policy
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
