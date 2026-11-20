import { useParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { Option, Schema } from "effect";
import { createSignal, Show } from "solid-js";
import { ErrorText, Field, Page, PageHeader, Panel } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Package } from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { AccessDenied, useCan } from "~/lib/permissions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-[13px] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

const textareaClass =
  "min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

const manifestSourceLabel = (platform: "apple" | "win" | "android"): string => {
  switch (platform) {
    case "apple":
      return "Manifest URL";
    case "win":
      return "MSI URL";
    default:
      return "Managed Google Play";
  }
};

const identityLabel = (platform: "apple" | "win" | "android"): string => {
  switch (platform) {
    case "android":
      return "Managed Google Play package";
    case "win":
      return "MSI ProductCode";
    default:
      return "Bundle / package ID";
  }
};

const identityHint = (platform: "apple" | "win" | "android"): string | undefined => {
  switch (platform) {
    case "win":
      return "The MSI ProductCode (GUID) for Windows installs.";
    case "android":
      return "Managed Google Play package, for example com.google.android.gm.";
    default:
      return undefined;
  }
};

const identityPlaceholder = (platform: "apple" | "win" | "android"): string =>
  platform === "android" ? "com.google.android.gm" : "com.example.app";

const installerLabel = (platform: "apple" | "win" | "android"): string =>
  platform === "win" ? "MSI URL" : "Manifest URL";

const installerHint = (platform: "apple" | "win" | "android"): string => {
  switch (platform) {
    case "apple":
      return "An HTTPS itms-services manifest plist. Devices must be able to fetch it.";
    case "win":
      return "An HTTPS link to a signed .msi. Windows installs it through the MDM channel.";
    default:
      return "Managed Google Play installs by package name; this URL is metadata only.";
  }
};

const installerPlaceholder = (platform: "apple" | "win" | "android"): string =>
  platform === "win" ? "https://example.com/app.msi" : "https://example.com/app/manifest.plist";

export default function NewApplicationPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCan();
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
    onSuccess: ({ id }) => {
      // Navigate immediately: the detail page is a cold load for the new id, and
      // the catalogue list refreshes in the background.
      navigate(`/t/${params.tenantId}/applications/${id}`);
      void qc.invalidateQueries({ queryKey: enterpriseKeys.applications(params.tenantId) });
      void qc.invalidateQueries({
        queryKey: enterpriseKeys.entitySearchPrefix(params.tenantId, "application"),
      });
    },
  }));

  return (
    <Show when={can("applications.write")} fallback={<AccessDenied />}>
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
                      const value = Option.getOrUndefined(
                        Schema.decodeUnknownOption(Schema.Literals(["apple", "win", "android"]))(
                          event.currentTarget.value,
                        ),
                      );

                      if (value === undefined) return;

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
                    onChange={(event) => {
                      const value = Option.getOrUndefined(
                        Schema.decodeUnknownOption(
                          Schema.Literals(["manifest", "store", "upload"]),
                        )(event.currentTarget.value),
                      );

                      if (value !== undefined) setSource(value);
                    }}
                  >
                    <option value="manifest">{manifestSourceLabel(platform())}</option>
                    <Show when={platform() === "apple"}>
                      <option value="store">App Store ID</option>
                    </Show>
                    <option value="upload">Uploaded file</option>
                  </select>
                </Field>
                <Field label={identityLabel(platform())} hint={identityHint(platform())}>
                  <Input
                    value={bundleId()}
                    onInput={(e) => setBundleId(e.currentTarget.value)}
                    placeholder={identityPlaceholder(platform())}
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
                <Field label={installerLabel(platform())} hint={installerHint(platform())}>
                  <Input
                    value={manifestUrl()}
                    onInput={(e) => setManifestUrl(e.currentTarget.value)}
                    placeholder={installerPlaceholder(platform())}
                  />
                </Field>
              </Show>
              <Show when={source() === "store"}>
                <Field
                  label="App Store ID"
                  hint="Numeric iTunes Store ID. Apps and Books licensing is used when a token exists."
                >
                  <Input value={storeId()} onInput={(e) => setStoreId(e.currentTarget.value)} />
                </Field>
              </Show>
              <Show when={source() === "upload"}>
                <p class="rounded-lg border border-border bg-surface px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
                  Save the application first, then upload the installer from its detail page. Apple
                  installs a signed .pkg from the upload; Windows and Android use the installer URL
                  or the Managed Google Play package instead.
                </p>
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
              <div class="flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground">
                <Package class="size-4" />
              </div>
              <h2 class="mt-3 text-[13px] font-semibold text-foreground">Delivery</h2>
              <p class="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                Apple installs a manifest, App Store or uploaded .pkg app on assigned Macs and
                iPhones. Windows queues an MSI install through the MDM channel, and Android adds
                assigned apps to the Managed Google Play policy.
              </p>
            </Panel>
            <Panel title="Sources">
              <dl class="space-y-2.5 text-[12px]">
                <div>
                  <dt class="font-medium text-foreground">Manifest / MSI URL</dt>
                  <dd class="text-muted-foreground">
                    Internal Apple builds (OTA manifest) or a signed Windows .msi.
                  </dd>
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
                    A signed .pkg installs on macOS; an .ipa needs an OTA manifest URL.
                  </dd>
                </div>
              </dl>
            </Panel>
          </div>
        </form>
      </Page>
    </Show>
  );
}
