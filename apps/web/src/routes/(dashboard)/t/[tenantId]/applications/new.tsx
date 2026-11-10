import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { createSignal, Show } from "solid-js";
import { ErrorText, Field, PageHeader } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

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
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Add application"
        description="Catalogue an app and assign it after saving."
      />
      <form
        class="grid max-w-3xl gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <Card>
          <CardContent class="space-y-4">
            <Field label="Name">
              <Input required value={name()} onInput={(e) => setName(e.currentTarget.value)} />
            </Field>
            <div class="grid gap-4 sm:grid-cols-2">
              <Field label="Platform">
                <select
                  class="h-9 rounded-lg border bg-white px-3 text-sm"
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
              <Field label="Source">
                <select
                  class="h-9 rounded-lg border bg-white px-3 text-sm"
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
                <Input value={version()} onInput={(e) => setVersion(e.currentTarget.value)} />
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
            <Field label="Notes">
              <textarea
                class="min-h-24 rounded-lg border bg-white px-3 py-2 text-sm"
                value={notes()}
                onInput={(e) => setNotes(e.currentTarget.value)}
              />
            </Field>
            <ErrorText error={create.error} />
            <div class="flex gap-2">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Saving…" : "Add application"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate(`/t/${params.tenantId}/applications`)}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
