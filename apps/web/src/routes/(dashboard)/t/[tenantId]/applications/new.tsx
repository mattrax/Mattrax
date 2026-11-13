import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { createSignal, Show } from "solid-js";
import { ErrorText, Field, Page, PageHeader, Panel } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Package } from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-[13px] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

const textareaClass =
  "min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

export default function NewApplicationPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = createSignal("");
  const [platform, setPlatform] = createSignal<"apple" | "win" | "android">("apple");
  const [source, setSource] = createSignal<"manifest" | "store" | "upload">("manifest");
  const [bundleId, setBundleId] = createSignal("");
  const [version, setVersion] = createSignal("");
  const [manifestUrl, setManifestUrl] = createSignal("");
  const [storeId, setStoreId] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const create = useMutation(() => ({
    mutationFn: () =>
      enterprise.createApplication(params.tenantId, {
        name: name(),
        platform: platform(),
        source: source(),
        bundleId: bundleId() || null,
        version: version() || null,
        manifestUrl: manifestUrl() || null,
        storeId: storeId() || null,
        notes: notes() || null,
      }),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.applications(params.tenantId) });
      navigate(`/t/${params.tenantId}/applications/${id}`);
    },
  }));

  return (
    <Page>
      <PageHeader
        eyebrow="Applications"
        title="Add application"
        description="Catalogue an app and assign it after saving."
      />
      <form
        class="grid max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <Panel title="Application details" description="Metadata devices and admins will see.">
          <div class="space-y-4">
            <Field label="Name">
              <Input
                required
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="e.g. Google Chrome"
              />
            </Field>
            <div class="grid gap-4 sm:grid-cols-2">
              <Field label="Platform">
                <select
                  class={selectClass}
                  value={platform()}
                  onChange={(event) => {
                    const value = event.currentTarget.value as "apple" | "win" | "android";
                    setPlatform(value);
                    if (value !== "apple") setSource("manifest");
                  }}
                >
                  <option value="apple">Apple</option>
                  <option value="win">Windows</option>
                  <option value="android">Android</option>
                </select>
              </Field>
              <Field label="Source" hint="How Mattrax should resolve the installer.">
                <select
                  class={selectClass}
                  value={source()}
                  onChange={(event) =>
                    setSource(event.currentTarget.value as "manifest" | "store" | "upload")
                  }
                >
                  <option value="manifest">Manifest URL</option>
                  <option value="store">App Store ID</option>
                  <option value="upload">Uploaded file (metadata only)</option>
                </select>
              </Field>
              <Field label="Bundle / package ID">
                <Input
                  value={bundleId()}
                  onInput={(e) => setBundleId(e.currentTarget.value)}
                  placeholder="com.example.app"
                />
              </Field>
              <Field label="Version">
                <Input
                  value={version()}
                  onInput={(e) => setVersion(e.currentTarget.value)}
                  placeholder="1.0.0"
                />
              </Field>
            </div>
            <Show when={source() === "manifest"}>
              <Field
                label="Manifest URL"
                hint="An HTTPS itms-services manifest plist. Devices must be able to fetch it."
              >
                <Input
                  value={manifestUrl()}
                  onInput={(e) => setManifestUrl(e.currentTarget.value)}
                  placeholder="https://example.com/app/manifest.plist"
                />
              </Field>
            </Show>
            <Show when={source() === "store"}>
              <Field
                label="App Store ID"
                hint="Numeric iTunes Store ID. VPP licensing is not configured."
              >
                <Input value={storeId()} onInput={(e) => setStoreId(e.currentTarget.value)} />
              </Field>
            </Show>
            <Field label="Notes" hint="Optional. Context for other admins.">
              <textarea
                class={textareaClass}
                value={notes()}
                onInput={(e) => setNotes(e.currentTarget.value)}
                placeholder="Where this app comes from, licensing notes, …"
              />
            </Field>
            <ErrorText error={create.error} />
            <div class="flex flex-wrap items-center gap-2 pt-1">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Saving…" : "Add application"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate(`/t/${params.tenantId}/applications`)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Panel>

        <div class="space-y-5">
          <Panel>
            <div class="flex size-8 items-center justify-center rounded-lg border border-brand/25 bg-brand-muted text-brand">
              <Package class="size-4" />
            </div>
            <h2 class="mt-3 text-[13px] font-semibold text-foreground">Delivery today</h2>
            <p class="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
              Apple apps install on assigned devices from a manifest URL or App Store ID. Windows
              and Android packages are catalogued and visible in the software inventory, but
              automatic install is not implemented yet.
            </p>
          </Panel>
          <Panel title="Sources">
            <dl class="space-y-2.5 text-[12px]">
              <div>
                <dt class="font-medium text-foreground">Manifest URL</dt>
                <dd class="text-muted-foreground">Best for internal builds on Apple platforms.</dd>
              </div>
              <div>
                <dt class="font-medium text-foreground">App Store ID</dt>
                <dd class="text-muted-foreground">
                  Resolves through Apps and Books when a licence pool exists.
                </dd>
              </div>
              <div>
                <dt class="font-medium text-foreground">Uploaded file</dt>
                <dd class="text-muted-foreground">
                  Stores metadata only; add a manifest or store ID before installing.
                </dd>
              </div>
            </dl>
          </Panel>
        </div>
      </form>
    </Page>
  );
}
