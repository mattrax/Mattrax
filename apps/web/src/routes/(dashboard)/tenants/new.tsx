import { useNavigate } from "~/lib/navigation";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { ErrorText, Field, Page, PageHeader, Panel } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ArrowLeft } from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { rememberTenantAlias } from "~/lib/tenant";

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export default function NewTenantPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = createSignal("");
  const [slug, setSlug] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  let nameInput: HTMLInputElement | undefined;

  const createTenant = useMutation(() => ({
    mutationFn: () => enterprise.createTenant({ name: name(), slug: slug() || slugify(name()) }),
    onSuccess: ({ id }) => {
      // Land on the canonical slug: an id URL would be rewritten to the slug
      // moments later, which churns the tenant route's query keys for nothing.
      // Seed the slug/id alias so those keys resolve before `/me` refreshes.
      rememberTenantAlias(slug(), id);
      navigate(`/t/${slug() || id}/devices`);
      // Navigate before the background refresh: waiting for the cache write
      // leaves the form in its pending state and the route never changes.
      void queryClient.invalidateQueries({ queryKey: enterpriseKeys.me() });
    },
  }));

  return (
    <Page class="max-w-[640px]">
      <a
        href="/dashboard"
        class="inline-flex w-fit items-center gap-1.5 text-[12px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <ArrowLeft class="size-3.5" />
        Back to dashboard
      </a>

      <PageHeader
        eyebrow="New tenant"
        title="Create tenant"
        description="Tenants scope all MDM resources and team access."
      />

      <Panel>
        <form
          class="space-y-4"
          novalidate
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);

            if (!name().trim()) {
              setError("Enter a tenant name.");
              nameInput?.focus();

              return;
            }

            createTenant.mutate();
          }}
        >
          <Field label="Tenant name">
            <Input
              ref={(element) => {
                nameInput = element;
              }}
              class="h-9"
              value={name()}
              onInput={(event) => {
                setName(event.currentTarget.value);

                if (!slug()) setSlug(slugify(event.currentTarget.value));
              }}
              placeholder="Acme Operations"
            />
          </Field>
          <Field
            label="Slug"
            hint="Used in URLs and API calls. Lowercase letters, numbers and dashes."
          >
            <Input
              class="h-9 font-mono text-[13px]"
              value={slug()}
              onInput={(event) => setSlug(slugify(event.currentTarget.value))}
              placeholder="acme-operations"
            />
          </Field>
          <ErrorText error={error() ?? createTenant.error} />
          <div class="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button type="submit" disabled={createTenant.isPending}>
              {createTenant.isPending ? "Creating..." : "Create tenant"}
            </Button>
            <Button as="a" href="/dashboard" variant="outline">
              Cancel
            </Button>
          </div>
        </form>
      </Panel>
    </Page>
  );
}
