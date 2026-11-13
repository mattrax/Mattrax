import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, Match, onSettled, Show, Switch } from "solid-js";
import { ErrorText, Page, PageHeader, Panel } from "~/components/mdm/common";
import { MobileconfigPreview } from "~/components/mdm/mobileconfig-preview";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys, type PolicyRow } from "~/lib/enterprise";
import { arrayBufferToBase64, base64ToArrayBuffer, selectFile } from "~/lib/upload-file";

const keys = {
  cert: "mttx.apple.certificate.default",
  app: "mttx.apple.application.default",
  custom: "mttx.apple.custom.default",
  device: "mttx.apple.device",
  windows: "mttx.windows.custom.default",
} as const;

type Config = Record<string, any>;

const textareaClass =
  "min-h-24 w-full rounded-lg border border-input bg-transparent p-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

const sections = [
  { id: "security", label: "Security", hint: "Certificate" },
  { id: "applications", label: "Applications", hint: "Soon" },
  { id: "device", label: "Device", hint: "Restrictions" },
  { id: "windows", label: "Windows", hint: "OMA-URI" },
  { id: "custom", label: "Custom profile", hint: "mobileconfig" },
  { id: "raw", label: "Advanced JSON", hint: "Raw" },
] as const;

export function PolicyConfigurationEditor() {
  const params = useParams();
  const queryClient = useQueryClient();
  const policy = useQuery(() => ({
    queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId),
    queryFn: () => enterprise.get(params.tenantId, "policy", params.policyId),
  }));
  const row = () => policy.data as PolicyRow | undefined;
  const [canEdit, setCanEdit] = createSignal(false);
  const [active, setActive] = createSignal("security");
  const [config, setConfig] = createSignal<Config>({});
  const [initial, setInitial] = createSignal("{}");
  const [raw, setRaw] = createSignal("{}");

  createEffect(
    () => row()?.id,
    () => {
      const configurations = row()?.configurations;
      if (!configurations) return;
      setConfig(configurations);
      setInitial(JSON.stringify(configurations));
      setRaw(JSON.stringify(configurations, null, 2));
    },
  );

  const dirty = createMemo(() => JSON.stringify(config()) !== initial());
  const configuredKinds = createMemo(() => Object.keys(config()).length);
  const setKey = (key: string, value: unknown) =>
    setConfig((current) => ({ ...current, [key]: value }));
  const save = useMutation(() => ({
    mutationFn: () =>
      enterprise.patchPolicy(params.tenantId, params.policyId, { configurations: config() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId),
      });
      setCanEdit(false);
      setInitial(JSON.stringify(config()));
    },
  }));

  const toggleEdit = () => {
    if (canEdit() && dirty()) save.mutate();
    else setCanEdit(!canEdit());
  };
  const cancel = () => {
    setConfig(JSON.parse(initial()));
    setRaw(JSON.stringify(JSON.parse(initial()), null, 2));
    setCanEdit(false);
  };

  onSettled(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (canEdit() && dirty()) save.mutate();
      }
      if (event.key === "Escape" && canEdit()) cancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  return (
    <Page>
      <PageHeader
        eyebrow="Policy"
        title={row()?.name ?? "Policy editor"}
        description={dirty() ? "Policy has local changes" : "Policy has no local changes"}
        meta={
          <Show when={row()}>
            <Badge variant="outline" class="gap-1.5 text-muted-foreground">
              {configuredKinds()} configuration{configuredKinds() === 1 ? "" : "s"}
            </Badge>
            <Show when={dirty()}>
              <span class="inline-flex items-center gap-1.5 text-warning-foreground">
                <span class="size-1.5 rounded-full bg-warning" aria-hidden="true" />
                Unsaved changes
              </span>
            </Show>
            <Show when={!dirty()}>
              <span class="inline-flex items-center gap-1.5">
                <span class="size-1.5 rounded-full bg-success" aria-hidden="true" />
                {canEdit() ? "Editing" : "Read only"}
              </span>
            </Show>
          </Show>
        }
        actions={
          <>
            <Button
              as="a"
              href={`/t/${params.tenantId}/policies/${params.policyId}/design`}
              variant="outline"
            >
              Open designer
            </Button>
            <Button
              as="a"
              href="https://configure.mattrax.app"
              target="_blank"
              rel="noreferrer"
              variant="outline"
            >
              Browse settings
            </Button>
            <Button variant={canEdit() ? "default" : "outline"} onClick={toggleEdit}>
              {!canEdit() ? "Edit" : dirty() ? "Save" : "Done"}
            </Button>
            <Show when={canEdit()}>
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            </Show>
          </>
        }
      />
      <div class="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
        <EditorNav active={active()} setActive={setActive} canEdit={canEdit()} />
        <Panel
          title={activeTitle(active())}
          description={sectionDescription(active())}
          actions={
            <Show when={dirty()}>
              <Badge
                variant="outline"
                class="border-warning/30 bg-warning/10 text-warning-foreground"
              >
                Unsaved
              </Badge>
            </Show>
          }
        >
          <fieldset disabled={!canEdit()} class="min-w-0 space-y-5 disabled:opacity-70">
            <Switch>
              <Match when={active() === "security"}>
                <SecuritySection config={config()} setKey={setKey} />
              </Match>
              <Match when={active() === "applications"}>
                <ApplicationSection
                  config={config()}
                  setKey={setKey}
                  tenantId={params.tenantId}
                  policyId={params.policyId}
                />
              </Match>
              <Match when={active() === "device"}>
                <DeviceSection config={config()} setKey={setKey} />
              </Match>
              <Match when={active() === "windows"}>
                <WindowsSection config={config()} setKey={setKey} />
              </Match>
              <Match when={active() === "custom"}>
                <CustomSection
                  config={config()}
                  setKey={setKey}
                  policyId={params.policyId ?? "policy"}
                />
              </Match>
              <Match when={active() === "raw"}>
                <div class="space-y-3">
                  <p class="text-[12.5px] leading-relaxed text-muted-foreground">
                    Edit the raw configuration map. Values use Mattrax configuration kinds.
                  </p>
                  <textarea
                    class={`${textareaClass} min-h-80 font-mono text-[11px] leading-relaxed`}
                    value={raw()}
                    onInput={(event) => setRaw(event.currentTarget.value)}
                    onChange={(event) => {
                      try {
                        const parsed = JSON.parse(event.currentTarget.value);
                        setConfig(parsed);
                        setRaw(JSON.stringify(parsed, null, 2));
                      } catch {
                        // Keep the raw text; the save button will stay disabled.
                      }
                    }}
                  />
                </div>
              </Match>
            </Switch>
          </fieldset>
          <ErrorText error={save.error} />
        </Panel>
      </div>
    </Page>
  );
}

function activeTitle(active: string) {
  if (active === "applications") return "Applications";
  if (active === "custom") return "Custom profile";
  if (active === "device") return "Device restrictions";
  if (active === "windows") return "Windows configuration";
  if (active === "raw") return "Advanced JSON";
  return "Security";
}

function sectionDescription(active: string) {
  if (active === "applications") return "Package delivery for this policy.";
  if (active === "custom") return "Upload and inspect a .mobileconfig profile.";
  if (active === "device") return "Restrictions applied to every device in scope.";
  if (active === "windows") return "SyncML policy nodes for Windows devices.";
  if (active === "raw") return "The full configuration map, as stored on the policy.";
  return "Certificates attached to this policy.";
}

function EditorNav(props: {
  active: string;
  setActive: (value: string) => void;
  canEdit: boolean;
}) {
  return (
    <Panel class="lg:sticky lg:top-20" flush>
      <nav aria-label="Editor sections" class="no-scrollbar flex gap-1 overflow-x-auto p-2 lg:grid">
        {sections.map((section) => {
          const current = () => props.active === section.id;
          return (
            <Button
              variant={current() ? "secondary" : "ghost"}
              aria-pressed={current() ? "true" : "false"}
              aria-label={section.label}
              onClick={() => props.setActive(section.id)}
              class="shrink-0 justify-between gap-2 px-2.5 lg:w-full"
            >
              <span class="flex min-w-0 items-center gap-2">
                <span
                  class={
                    current()
                      ? "truncate text-[12.5px] font-medium text-foreground"
                      : "truncate text-[12.5px] text-muted-foreground"
                  }
                >
                  {section.label}
                </span>
              </span>
              <span class="shrink-0 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                {section.hint}
              </span>
            </Button>
          );
        })}
        <Show when={!props.canEdit}>
          <p class="hidden px-2 py-1 text-[10.5px] leading-relaxed text-muted-foreground/70 lg:block">
            Choose Edit to change these settings.
          </p>
        </Show>
      </nav>
    </Panel>
  );
}

function SecuritySection(props: { config: Config; setKey: (key: string, value: unknown) => void }) {
  const cert = () => props.config[keys.cert] as { pem?: string } | null | undefined;
  const uploadCert = async () =>
    props.setKey(keys.cert, {
      pem: await (
        await selectFile(".pem,text/plain,application/pem,application/x-pem-file")
      ).text(),
    });
  return (
    <Show
      when={cert()}
      fallback={
        <div class="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5">
          <p class="text-[12.5px] text-muted-foreground">
            Upload a PEM certificate for this policy.
          </p>
          <Button onClick={uploadCert}>Upload certificate</Button>
        </div>
      }
    >
      {(value) => (
        <div class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-[12.5px] text-muted-foreground">A PEM certificate is configured.</p>
            <div class="flex gap-2">
              <Button onClick={uploadCert}>Replace</Button>
              <Button variant="outline" onClick={() => props.setKey(keys.cert, null)}>
                Remove
              </Button>
            </div>
          </div>
          <pre class="max-h-64 overflow-auto rounded-lg border border-border bg-muted/20 p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
            {value().pem}
          </pre>
        </div>
      )}
    </Show>
  );
}

function ApplicationSection(_props: {
  config: Config;
  setKey: (key: string, value: unknown) => void;
  tenantId?: string;
  policyId?: string;
}) {
  return (
    <div class="space-y-3">
      <p class="text-[13px] font-medium text-foreground">Application deployment</p>
      <p class="text-[12.5px] leading-relaxed text-muted-foreground">
        Remote app installers are not wired into Apple declarative management yet. Packages can
        still be uploaded to the policy API for future use, but they will not be delivered to
        devices.
      </p>
    </div>
  );
}

function DeviceSection(props: { config: Config; setKey: (key: string, value: unknown) => void }) {
  const device = () => (props.config[keys.device] ?? { camera: true }) as { camera?: boolean };
  return (
    <div class="space-y-4">
      <p class="text-[12.5px] leading-relaxed text-muted-foreground">
        Basic restrictions applied to every device in this policy's scope.
      </p>
      <label class="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/15 p-3 text-[13px] transition-colors hover:bg-muted/30">
        <span>
          <strong class="block font-medium text-foreground">Allow camera</strong>
          <span class="text-[11.5px] text-muted-foreground">
            Disable the camera on managed devices.
          </span>
        </span>
        <input
          type="checkbox"
          class="size-4 shrink-0 accent-[var(--brand)]"
          checked={device().camera !== false}
          onChange={(event) =>
            props.setKey(keys.device, { ...device(), camera: event.currentTarget.checked })
          }
        />
      </label>
    </div>
  );
}

function WindowsSection(props: { config: Config; setKey: (key: string, value: unknown) => void }) {
  const current = () =>
    props.config[keys.windows] as { omaUri?: string; value?: string; format?: string } | undefined;
  return (
    <div class="space-y-4">
      <p class="text-[12.5px] leading-relaxed text-muted-foreground">
        Deploy a Windows MDM OMA-URI. The value is delivered on the device's next SyncML check-in.
        Use Advanced JSON to configure multiple nodes.
      </p>
      <label class="space-y-1.5 text-sm">
        <span class="text-[12.5px] font-medium text-foreground/90">OMA-URI</span>
        <Input
          placeholder="./Vendor/MSFT/Policy/Config/..."
          value={current()?.omaUri ?? ""}
          onInput={(event) =>
            props.setKey(keys.windows, {
              ...current(),
              omaUri: event.currentTarget.value,
            })
          }
        />
      </label>
      <label class="space-y-1.5 text-sm">
        <span class="text-[12.5px] font-medium text-foreground/90">Value</span>
        <Input
          placeholder="1"
          value={current()?.value ?? ""}
          onInput={(event) =>
            props.setKey(keys.windows, {
              ...current(),
              value: event.currentTarget.value,
            })
          }
        />
      </label>
      <Button
        variant="outline"
        onClick={() => props.setKey(keys.windows, null)}
        disabled={!current()}
      >
        Remove Windows configuration
      </Button>
    </div>
  );
}

function CustomSection(props: {
  config: Config;
  setKey: (key: string, value: unknown) => void;
  policyId: string;
}) {
  const custom = () => props.config[keys.custom] as { content?: string } | null | undefined;
  const upload = async () =>
    props.setKey(keys.custom, {
      content: arrayBufferToBase64(
        await (await selectFile("application/x-apple-aspen-config,.mobileconfig")).arrayBuffer(),
      ),
    });
  const download = () => {
    const content = custom()?.content;
    if (!content) return;
    const url = URL.createObjectURL(
      new Blob([base64ToArrayBuffer(content)], { type: "application/x-apple-aspen-config" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${props.policyId}.mobileconfig`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Show
      when={custom()}
      fallback={
        <div class="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5">
          <p class="text-[12.5px] text-muted-foreground">Upload your own .mobileconfig file.</p>
          <Button onClick={upload}>Upload</Button>
        </div>
      }
    >
      {(value) => (
        <div class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-[12.5px] text-muted-foreground">
              You have uploaded a mobileconfig file.
            </p>
            <div class="flex flex-wrap gap-2">
              <Button onClick={download}>Download</Button>
              <Button onClick={upload}>Replace</Button>
              <Button variant="outline" onClick={() => props.setKey(keys.custom, null)}>
                Remove
              </Button>
            </div>
          </div>
          <Show when={value().content}>
            <MobileconfigPreview content={value().content!} />
          </Show>
        </div>
      )}
    </Show>
  );
}
