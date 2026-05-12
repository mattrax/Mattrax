import { useNavigate } from "@solidjs/router";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { ErrorText, Field, PageHeader } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default function NewTenantPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = createSignal("");
  const [slug, setSlug] = createSignal("");
  const createTenant = useMutation(() => ({
    mutationFn: () => enterprise.createTenant({ name: name(), slug: slug() || slugify(name()) }),
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: enterpriseKeys.me() });
      navigate(`/t/${id}/devices`);
    },
  }));
  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader title="Create tenant" description="Tenants map directly to Better Auth organizations and scope all MDM resources." />
      <Card class="max-w-xl"><CardContent>
        <form class="space-y-4" onSubmit={(event) => { event.preventDefault(); createTenant.mutate(); }}>
          <Field label="Tenant name"><Input required value={name()} onInput={(event) => { setName(event.currentTarget.value); if (!slug()) setSlug(slugify(event.currentTarget.value)); }} placeholder="Acme Operations" /></Field>
          <Field label="Slug"><Input required value={slug()} onInput={(event) => setSlug(slugify(event.currentTarget.value))} placeholder="acme-operations" /></Field>
          <ErrorText error={createTenant.error} />
          <Button type="submit" disabled={createTenant.isPending}>{createTenant.isPending ? "Creating..." : "Create tenant"}</Button>
        </form>
      </CardContent></Card>
    </div>
  );
}
