import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, Match, Show, Switch } from "solid-js";
import { ErrorText, Field, PageHeader } from "~/components/mdm/common";
import { MobileconfigPreview } from "~/components/mdm/mobileconfig-preview";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { enterprise, enterpriseKeys, type PolicyRow } from "~/lib/enterprise";
import { arrayBufferToBase64, base64ToArrayBuffer, selectFile } from "~/lib/upload-file";

const keys = {
  cert: "mttx.apple.certificate.default",
  app: "mttx.apple.application",
  custom: "mttx.apple.custom.og",
} as const;

type Config = Record<string, any>;

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

  createEffect(() => {
    if (!row()?.configurations) return;
    const next = row()!.configurations ?? {};
    setConfig(next);
    setInitial(JSON.stringify(next));
  });

  const dirty = createMemo(() => JSON.stringify(config()) !== initial());
  const setKey = (key: string, value: unknown) => setConfig((current) => ({ ...current, [key]: value }));
  const save = useMutation(() => ({
    mutationFn: () => enterprise.patchPolicy(params.tenantId, params.policyId, { configurations: config() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId) });
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
    setCanEdit(false);
  };

  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title={row()?.name ?? "Policy editor"}
        description={dirty() ? "Policy has local changes" : "Policy has no local changes"}
        actions={
          <>
            <Button variant="outline" onClick={toggleEdit}>{!canEdit() ? "Edit" : dirty() ? "Save" : "Done"}</Button>
            <Show when={canEdit()}><Button variant="ghost" onClick={cancel}>Cancel</Button></Show>
          </>
        }
      />
      <div class="grid gap-6 lg:grid-cols-[220px_1fr]">
        <EditorNav active={active()} setActive={setActive} />
        <Card>
          <CardHeader><CardTitle>{activeTitle(active())}</CardTitle></CardHeader>
          <CardContent>
            <fieldset disabled={!canEdit()} class="space-y-5 disabled:opacity-70">
              <Switch>
                <Match when={active() === "security"}><SecuritySection config={config()} setKey={setKey} /></Match>
                <Match when={active() === "applications"}><ApplicationSection config={config()} setKey={setKey} tenantId={params.tenantId} policyId={params.policyId} /></Match>
                <Match when={active() === "custom"}><CustomSection config={config()} setKey={setKey} policyId={params.policyId ?? "policy"} /></Match>
              </Switch>
            </fieldset>
            <ErrorText error={save.error} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function activeTitle(active: string) {
  if (active === "applications") return "Applications";
  if (active === "custom") return "Custom Policy";
  return "Security";
}

function EditorNav(props: { active: string; setActive: (value: string) => void }) {
  return (
    <Card>
      <CardContent class="grid gap-1">
        <Button variant={props.active === "security" ? "secondary" : "ghost"} onClick={() => props.setActive("security")}>Security</Button>
        <Button variant={props.active === "applications" ? "secondary" : "ghost"} onClick={() => props.setActive("applications")}>Applications</Button>
        <Button variant={props.active === "custom" ? "secondary" : "ghost"} onClick={() => props.setActive("custom")}>Custom Policy</Button>
      </CardContent>
    </Card>
  );
}

function SecuritySection(props: { config: Config; setKey: (key: string, value: unknown) => void }) {
  const cert = () => props.config[keys.cert] as { pem?: string } | null | undefined;
  const uploadCert = async () => props.setKey(keys.cert, { pem: await (await selectFile(".pem,text/plain,application/pem,application/x-pem-file")).text() });
  return (
    <Show when={cert()} fallback={<div class="space-y-3"><p class="text-sm text-muted-foreground">Upload a PEM certificate for this policy.</p><Button onClick={uploadCert}>Upload certificate</Button></div>}>
      {(value) => (
        <div class="space-y-3">
          <p class="text-sm text-muted-foreground">A PEM certificate is configured.</p>
          <div class="flex gap-2"><Button onClick={uploadCert}>Replace</Button><Button variant="outline" onClick={() => props.setKey(keys.cert, null)}>Remove</Button></div>
          <pre class="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs">{value().pem}</pre>
        </div>
      )}
    </Show>
  );
}

function ApplicationSection(props: { config: Config; setKey: (key: string, value: unknown) => void; tenantId?: string; policyId?: string }) {
  const app = () => props.config[keys.app] as { sha256?: string; fileName?: string; contentType?: string | null; size?: number } | null | undefined;
  const upload = async () => {
    const file = await selectFile(".pkg,.dmg,.zip,application/octet-stream,application/x-apple-diskimage,application/zip");
    const uploaded = await enterprise.uploadPolicyApplication(props.tenantId, props.policyId, {
      fileName: file.name,
      contentType: file.type || undefined,
      content: arrayBufferToBase64(await file.arrayBuffer()),
    });
    props.setKey(keys.app, uploaded);
  };
  const download = async () => {
    const sha256 = app()?.sha256;
    if (!sha256) return;
    const file = await enterprise.downloadPolicyApplication(props.tenantId, props.policyId, sha256);
    const url = URL.createObjectURL(new Blob([base64ToArrayBuffer(file.content)], { type: file.contentType ?? "application/octet-stream" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Show when={app()} fallback={<div class="space-y-3"><p class="text-sm text-muted-foreground">Upload an application installer for this policy. Delivery is not connected to MDM yet.</p><Button onClick={upload}>Upload application</Button></div>}>
      {(value) => (
        <div class="space-y-4">
          <div class="rounded-lg border p-3 text-sm">
            <p class="font-medium">{value().fileName}</p>
            <p class="text-muted-foreground">SHA-256: {value().sha256}</p>
            <Show when={value().size !== undefined}><p class="text-muted-foreground">Size: {value().size} bytes</p></Show>
          </div>
          <div class="flex gap-2"><Button onClick={download}>Download</Button><Button onClick={upload}>Replace</Button><Button variant="outline" onClick={() => props.setKey(keys.app, null)}>Remove</Button></div>
        </div>
      )}
    </Show>
  );
}

function CustomSection(props: { config: Config; setKey: (key: string, value: unknown) => void; policyId: string }) {
  const custom = () => props.config[keys.custom] as { content?: string } | null | undefined;
  const upload = async () => props.setKey(keys.custom, { content: arrayBufferToBase64(await (await selectFile("application/x-apple-aspen-config,.mobileconfig")).arrayBuffer()) });
  const download = () => {
    const content = custom()?.content;
    if (!content) return;
    const url = URL.createObjectURL(new Blob([base64ToArrayBuffer(content)], { type: "application/x-apple-aspen-config" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${props.policyId}.mobileconfig`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Show when={custom()} fallback={<div class="space-y-3"><p class="text-sm text-muted-foreground">Upload your own .mobileconfig file.</p><Button onClick={upload}>Upload</Button></div>}>
      {(value) => (
        <div class="space-y-4">
          <p class="text-sm text-muted-foreground">You have uploaded a mobileconfig file.</p>
          <div class="flex gap-2"><Button onClick={download}>Download</Button><Button onClick={upload}>Replace</Button><Button variant="outline" onClick={() => props.setKey(keys.custom, null)}>Remove</Button></div>
          <Show when={value().content}><MobileconfigPreview content={value().content!} /></Show>
        </div>
      )}
    </Show>
  );
}
