import { useParams } from "@solidjs/router";
import { PolicyRow } from "@mattrax/enterprise-domain/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Option, Schema } from "effect";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onSettled,
  Show,
  Switch,
} from "solid-js";
import { ErrorText, Page, PageHeader, Panel, QueryError } from "~/components/mdm/common";
import DocumentationLink from "~/components/mdm/documentation-link";
import { NativeSelect , Checkbox } from "@mattrax/ui";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ChevronDown } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import { CertificateEditor, MailEditor } from "~/components/mdm/policy-certificates";
import StaleWriteBanner from "~/components/stale-write-banner";
import { toast } from "~/components/toast";
import { chord, useCommands } from "~/lib/commands";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { optimisticallyPatchItem } from "~/lib/optimistic";
import {
  APPLE_PROFILE_DOCS,
  WINDOWS_CSP_DOCS,
  appleDocumentationUrl,
} from "~/lib/policy-designer/documentation";
import { ReadOnlyNotice, useCan } from "~/lib/permissions";
import { arrayBufferToBase64, base64ToArrayBuffer, selectFile } from "~/lib/upload-file";
import { createStaleWriteGuard } from "~/lib/stale-write";
import { handleStaleWriteWithToast } from "~/lib/stale-write-toast";
import { useUnsavedChanges } from "~/lib/unsaved-changes";
import { decodePolicyConfiguration, decodePolicyConfigurationOrEmpty } from "~/lib/policy-config";
import type { PolicyConfiguration } from "~/lib/policy-config";

const keys = {
  app: "mttx.apple.application.default",
  custom: "mttx.apple.custom.default",
  device: "mttx.apple.device",
  windows: "mttx.windows.custom.default",
} as const;

const CustomProfile = Schema.Struct({
  content: Schema.String,
  fileName: Schema.optional(Schema.String),
  signed: Schema.optional(Schema.Boolean),
});

const DeviceConfig = Schema.Struct({ camera: Schema.optional(Schema.Boolean) });

const WindowsConfig = Schema.Struct({
  omaUri: Schema.optional(Schema.String),
  value: Schema.optional(Schema.String),
  format: Schema.optional(Schema.String),
});

type CustomProfile = typeof CustomProfile.Type;

const decodePolicyRow = Schema.decodeUnknownOption(PolicyRow);

const decodeCustomProfile = Schema.decodeUnknownOption(CustomProfile);

const decodeDeviceConfig = Schema.decodeUnknownOption(DeviceConfig);

const decodeWindowsConfig = Schema.decodeUnknownOption(WindowsConfig);

const isCustomProfileKind = (kind: string) => /^mttx\.apple\.custom\.[^.]+$/.test(kind);

const textareaClass =
  "min-h-24 w-full rounded-lg border border-input bg-transparent p-2.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30";

/** Apple's page for the restrictions payload this section edits. */
const APPLE_RESTRICTIONS_DOCS = appleDocumentationUrl({
  kind: "profile",
  identifier: "com.apple.applicationaccess",
  name: "Restrictions",
});

const sections = [
  { id: "custom", label: "Profiles", hint: "mobileconfig" },
  { id: "security", label: "Certificates", hint: "PKCS/PFX" },
  { id: "mail", label: "Mail", hint: "S/MIME" },
  { id: "device", label: "Restrictions", hint: "Apple" },
  { id: "windows", label: "Windows", hint: "OMA-URI" },
  { id: "raw", label: "JSON", hint: "Raw" },
] as const;

export default function PolicyConfigurationEditor() {
  const params = useParams();
  const queryClient = useQueryClient();
  const { can } = useCan();
  const writable = () => can("policies.write");

  const policy = useQuery(() => ({
    queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId),
    queryFn: () => enterprise.get(params.tenantId, "policy", params.policyId),
  }));

  const policyVariables = useQuery(() => ({
    queryKey: enterpriseKeys.policyVariables(params.tenantId),
    queryFn: () => enterprise.getPolicyVariables(params.tenantId),
  }));

  const row = () => Option.getOrUndefined(decodePolicyRow(policy.data));
  const seededPolicyId = createMemo(() => row()?.id);
  const guard = createStaleWriteGuard(() => row()?.updatedAt);
  const [canEdit, setCanEdit] = createSignal(false);
  /** Bumped by "Reload latest" to reseed the form from the refetched policy. */
  const [reseed, setReseed] = createSignal(0);
  const [active, setActive] = createSignal("custom");
  const [config, setConfig] = createSignal<PolicyConfiguration>({});
  const [scopes, setScopes] = createSignal<Record<string, "device" | "user">>({});
  const [initialScopes, setInitialScopes] = createSignal("{}");
  const [initial, setInitial] = createSignal("{}");
  const [raw, setRaw] = createSignal("{}");
  const [rawError, setRawError] = createSignal<string | null>(null);

  const seedFromRow = () => {
    const configurations = row()?.configurations;

    if (!configurations) return;

    const decoded = Option.getOrUndefined(decodePolicyConfiguration(configurations)) ?? {};

    const nextScopes = { ...row()?.configurationScopes };

    setConfig(decoded);
    setScopes(nextScopes);
    setInitial(JSON.stringify(decoded));
    setInitialScopes(JSON.stringify(nextScopes));
    setRaw(JSON.stringify(decoded, null, 2));
    setRawError(null);
  };

  // Seed per policy, and again only when the operator explicitly reloads the
  // latest version. The memo keeps same-policy refetches from changing the key.
  createEffect(
    () => `${seededPolicyId() ?? ""}:${reseed()}`,
    () => seedFromRow(),
  );

  const dirty = createMemo(
    () =>
      JSON.stringify(config()) !== initial() ||
      JSON.stringify(scopes()) !== initialScopes() ||
      rawError() !== null,
  );

  const configuredKinds = createMemo(() => Object.keys(config()).length);

  /** Kinds that will exist after saving; `null` marks a pending removal. */
  const scopeableKinds = createMemo(() =>
    Object.entries(config()).flatMap(([kind, value]) => (value === null ? [] : [kind])),
  );

  const unsaved = useUnsavedChanges(() => canEdit() && dirty());

  const setKey = (key: string, value: Schema.Json) => {
    setConfig((current) => ({ ...current, [key]: value }));

    if (value === null)
      setScopes((current) => {
        const next = { ...current };
        delete next[key];

        return next;
      });
  };

  const setScope = (kind: string, scope: "device" | "user") =>
    setScopes((current) => ({ ...current, [kind]: scope }));

  const save = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: () =>
      enterprise.patchPolicy(params.tenantId, params.policyId, {
        configurations: config(),
        configurationScopes: scopes(),
        expectedUpdatedAt: guard.expectedUpdatedAt(),
      }),
    onMutate: async () =>
      optimisticallyPatchItem(queryClient, params.tenantId!, "policy", params.policyId!, {
        configurations: config(),
        configurationScopes: scopes(),
      }),
    onSuccess: () => {
      guard.markSaved();
      setCanEdit(false);
      setInitial(JSON.stringify(config()));
      setInitialScopes(JSON.stringify(scopes()));
      toast.success("Policy configurations saved");
    },
    onError: (error, _variables, restore) => {
      restore?.();

      if (
        handleStaleWriteWithToast(error, {
          reload: () =>
            queryClient.invalidateQueries({
              queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId),
            }),
        })
      ) {
        // Keep the draft and stay in edit mode; the banner offers an explicit
        // reload or overwrite.
        guard.markConflict();
        setCanEdit(true);

        return;
      }

      toast.error("Could not save the configurations", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
    },
    onSettled: () =>
      void queryClient.invalidateQueries({
        queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId),
      }),
  }));

  const reloadLatest = async () => {
    await policy.refetch();
    setReseed((value) => value + 1);
    guard.acceptLatest();
  };

  const toggleEdit = () => {
    if (!writable()) return;

    if (canEdit() && rawError()) {
      toast.error("Fix the invalid JSON before leaving the editor", {
        description: rawError() ?? undefined,
      });

      return;
    }

    if (canEdit() && dirty()) save.mutate();
    else setCanEdit(!canEdit());
  };

  createEffect(
    () => writable(),
    (allowed) => {
      if (!allowed) setCanEdit(false);
    },
  );

  const discard = () => {
    const decoded = decodePolicyConfigurationOrEmpty(JSON.parse(initial()));
    const nextScopes =
      Option.getOrUndefined(
        Schema.decodeUnknownOption(
          Schema.Record(Schema.String, Schema.Literals(["device", "user"])),
        )(JSON.parse(initialScopes())),
      ) ?? {};

    setConfig(decoded);
    setScopes(nextScopes);
    setRaw(JSON.stringify(decoded, null, 2));
    setRawError(null);
    setCanEdit(false);
  };

  const cancel = () => unsaved.confirm(discard);

  useCommands([
    {
      id: "policy-editor-save",
      title: "Save policy changes",
      subtitle: "Persist the edited configurations to the policy",
      group: "This page",
      shortcut: chord("s", { mod: true }),
      enabled: () => canEdit() && dirty(),
      run: () => {
        save.mutate();
      },
    },
    {
      id: "policy-editor-edit",
      title: "Toggle edit mode",
      subtitle: "Switch between read-only and editable configurations",
      group: "This page",
      enabled: writable,
      run: toggleEdit,
    },
    {
      id: "policy-editor-discard",
      title: "Discard unsaved edits",
      subtitle: "Restore the policy's stored configurations",
      group: "This page",
      enabled: () => canEdit() && dirty(),
      run: cancel,
    },
  ]);

  onSettled(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && canEdit()) cancel();
    };

    window.addEventListener("keydown", handler);

    return () => window.removeEventListener("keydown", handler);
  });

  return (
    <Page wide>
      {unsaved.prompt}
      <a
        href={`/t/${params.tenantId}/policies/${params.policyId}`}
        class="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Back to policy
      </a>
      <PageHeader
        title={row()?.name ?? "Policy editor"}
        description="Review and edit the configurations stored on this policy."
        meta={
          <Show when={row()}>
            <Badge variant="outline">
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
            <Show when={writable()}>
              <Button variant={canEdit() ? "default" : "outline"} onClick={toggleEdit}>
                {!canEdit() ? "Edit" : dirty() ? "Save" : "Done"}
              </Button>
              <Show when={canEdit()}>
                <Button variant="ghost" onClick={cancel}>
                  Cancel
                </Button>
              </Show>
            </Show>
          </>
        }
      />
      <QueryError error={policy.error} onRetry={() => void policy.refetch()} />
      <Show when={guard.conflict()}>
        <StaleWriteBanner
          reloading={policy.isFetching}
          onReload={() => void reloadLatest()}
          onKeepMine={() => guard.acceptLatest()}
        />
      </Show>
      <Show when={!writable()}>
        <ReadOnlyNotice>
          Your role can view this policy's configuration but not edit it.
        </ReadOnlyNotice>
      </Show>
      <div class="grid gap-5 lg:grid-cols-2 lg:items-start">
        <EditorNav active={active()} setActive={setActive} canEdit={canEdit()} />
        <Panel
          title={activeTitle(active())}
          description={sectionDescription(active())}
          actions={
            <Show when={dirty()}>
              <Badge
                variant="warning"
              >
                Unsaved
              </Badge>
            </Show>
          }
        >
          <fieldset disabled={!canEdit()} class="min-w-0 space-y-5 disabled:opacity-70">
            <Switch>
              <Match when={active() === "security"}>
                <CertificateEditor config={config()} setKey={setKey} />
              </Match>
              <Match when={active() === "mail"}>
                <MailEditor config={config()} setKey={setKey} />
              </Match>
              <Match when={active() === "device"}>
                <DeviceSection config={config()} setKey={setKey} />
              </Match>
              <Match when={active() === "windows"}>
                <WindowsSection
                  config={config()}
                  setKey={setKey}
                  scopes={scopes()}
                  setScope={setScope}
                />
              </Match>
              <Match when={active() === "custom"}>
                <CustomSection
                  config={config()}
                  setKey={setKey}
                  policyId={params.policyId ?? "policy"}
                  scopes={scopes()}
                  setScope={setScope}
                />
              </Match>
              <Match when={active() === "raw"}>
                <div class="space-y-3">
                  <p class="text-xs leading-relaxed text-muted-foreground">
                    Edit the raw configuration map. Values use Mattrax configuration kinds.
                  </p>
                  <Show when={scopeableKinds().length > 0}>
                    <div class="space-y-1.5 rounded-lg border border-border bg-muted/15 px-3 py-2">
                      <p class="label-caps">Delivery scope</p>
                      <p class="text-xs leading-relaxed text-muted-foreground">
                        Device scope reaches every user of the device. User scope is delivered only
                        on a linked, identity-verified Apple user channel.
                      </p>
                      <For each={scopeableKinds()}>
                        {(kind) => (
                          <div class="flex items-center justify-between gap-3">
                            <span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                              {kind}
                            </span>
                            <ScopeSelect kind={kind} scopes={scopes()} setScope={setScope} />
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                  <textarea
                    class={`${textareaClass} min-h-80 font-mono text-xs leading-relaxed`}
                    value={raw()}
                    onInput={(event) => setRaw(event.currentTarget.value)}
                    onChange={(event) => {
                      const text = event.currentTarget.value;

                      try {
                        const parsed = JSON.parse(text);
                        const decoded = Option.getOrUndefined(decodePolicyConfiguration(parsed));

                        if (decoded === undefined) {
                          setRaw(text);
                          setRawError("Configurations must be a JSON object with JSON values.");

                          return;
                        }

                        setConfig(decoded);
                        setRaw(JSON.stringify(parsed, null, 2));
                        setRawError(null);
                      } catch (error) {
                        // Keep the typed text and tell the user why it cannot
                        // be saved instead of silently dropping it.
                        setRaw(text);
                        setRawError(
                          error instanceof Error ? error.message : "The JSON is not valid.",
                        );
                      }
                    }}
                  />
                  <Show when={rawError()}>
                    <p role="alert" class="text-xs text-destructive">
                      {rawError()}
                    </p>
                  </Show>
                </div>
              </Match>
            </Switch>
          </fieldset>
          <VariableHints
            loading={policyVariables.isPending}
            variables={policyVariables.data?.variables ?? []}
            notes={policyVariables.data?.notes ?? []}
          />
          <ErrorText error={save.error} />
        </Panel>
      </div>
    </Page>
  );
}

function activeTitle(active: string) {
  if (active === "custom") return "Profiles";

  if (active === "device") return "Device restrictions";

  if (active === "windows") return "Windows configuration";

  if (active === "raw") return "JSON";

  if (active === "mail") return "Mail account";

  return "Certificates";
}

function sectionDescription(active: string) {
  if (active === "custom")
    return "Upload .mobileconfig profiles. Signed profiles deploy exactly as supplied.";

  if (active === "device") return "Restrictions applied to every device in scope.";

  if (active === "windows") return "SyncML policy nodes for Windows devices.";

  if (active === "raw") return "The full configuration map, with a delivery scope per setting.";

  if (active === "mail") return "An Apple Mail account with S/MIME signing and encryption.";

  return "Trusted roots, PKCS and imported PFX identities for Apple, Windows and Android.";
}

function EditorNav(props: {
  active: string;
  setActive: (value: string) => void;
  canEdit: boolean;
}) {
  return (
    <Panel class="min-w-0 lg:sticky lg:top-20" flush>
      <nav aria-label="Editor sections" class="no-scrollbar flex gap-1 overflow-x-auto p-2 lg:grid">
        {sections.map((section) => {
          const current = () => props.active === section.id;

          return (
            <Button
              variant={current() ? "secondary" : "ghost"}
              aria-pressed={current() ? "true" : "false"}
              aria-label={section.label}
              onClick={() => props.setActive(section.id)}
              class="shrink-0 justify-between lg:w-full"
            >
              <span class="flex min-w-0 items-center gap-2">
                <span
                  class={
                    current()
                      ? "truncate text-xs font-medium text-foreground"
                      : "truncate text-xs text-muted-foreground"
                  }
                >
                  {section.label}
                </span>
              </span>
              <span class="shrink-0 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {section.hint}
              </span>
            </Button>
          );
        })}
        <Show when={!props.canEdit}>
          <p class="hidden px-2 py-1 text-xs leading-relaxed text-muted-foreground lg:block">
            Choose Edit to change these settings.
          </p>
        </Show>
      </nav>
    </Panel>
  );
}

/**
 * Delivery channel for one configuration. User scope is validated by the API:
 * Apple profiles need `PayloadScope: User`, Windows needs `./User/` OMA-URIs,
 * and Android has no per-user policy.
 */
function ScopeSelect(props: {
  kind: string;
  scopes: Readonly<Record<string, "device" | "user">>;
  setScope: (kind: string, scope: "device" | "user") => void;
  class?: string;
}) {
  return (
    <label class={`flex items-center gap-2 text-xs text-muted-foreground ${props.class ?? ""}`}>
      <span>Scope</span>
      <NativeSelect
        class="h-7 w-auto"
        value={props.scopes[props.kind] ?? "device"}
        onChange={(event) =>
          props.setScope(props.kind, event.currentTarget.value === "user" ? "user" : "device")
        }
      >
        <option value="device">Device channel</option>
        <option value="user">User channel</option>
      </NativeSelect>
    </label>
  );
}

function DeviceSection(props: {
  config: PolicyConfiguration;
  setKey: (key: string, value: Schema.Json) => void;
}) {
  const device = () =>
    Option.getOrUndefined(decodeDeviceConfig(props.config[keys.device])) ?? { camera: true };

  return (
    <div class="space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <p class="text-xs leading-relaxed text-muted-foreground">
          Basic restrictions applied to the device channel, so every user on a managed device
          receives them.
        </p>
        <DocumentationLink
          href={APPLE_RESTRICTIONS_DOCS}
          source="Apple"
          subject="the Restrictions payload"
        />
      </div>
      <label class="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/15 p-3 text-xs transition-colors hover:bg-muted/30">
        <span>
          <strong class="block font-medium text-foreground">Allow camera</strong>
          <span class="text-xs text-muted-foreground">
            Disable the camera on managed devices.
          </span>
        </span>
        <Checkbox
          class="size-4 shrink-0"
          checked={device().camera !== false}
          onCheckedChange={(checked) =>
            props.setKey(keys.device, { ...device(), camera: checked === true })
          }
        />
      </label>
    </div>
  );
}

function WindowsSection(props: {
  config: PolicyConfiguration;
  setKey: (key: string, value: Schema.Json) => void;
  scopes: Readonly<Record<string, "device" | "user">>;
  setScope: (kind: string, scope: "device" | "user") => void;
}) {
  const current = () => Option.getOrUndefined(decodeWindowsConfig(props.config[keys.windows]));

  return (
    <div class="space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <p class="text-xs leading-relaxed text-muted-foreground">
          Deploy a Windows MDM OMA-URI. The value is delivered on the device's next SyncML check-in.
          User scope requires a <code class="font-mono text-xs">./User/</code> CSP path and is
          accepted for every user on the device: Windows has no per-login policy channel.
        </p>
        <DocumentationLink
          href={WINDOWS_CSP_DOCS}
          source="Microsoft"
          subject="the Windows Policy CSP"
        />
      </div>
      <ScopeSelect
        kind={keys.windows}
        scopes={props.scopes}
        setScope={props.setScope}
        class="justify-between rounded-lg border border-border bg-muted/15 px-3 py-2"
      />
      <label class="space-y-1.5 text-sm">
        <span class="text-xs font-medium text-foreground/90">OMA-URI</span>
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
        <span class="text-xs font-medium text-foreground/90">Value</span>
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
  config: PolicyConfiguration;
  setKey: (key: string, value: Schema.Json) => void;
  policyId: string;
  scopes: Readonly<Record<string, "device" | "user">>;
  setScope: (kind: string, scope: "device" | "user") => void;
}) {
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);

  const profiles = () =>
    Object.entries(props.config).flatMap(([kind, value]) => {
      const profile = Option.getOrUndefined(decodeCustomProfile(value));

      return profile !== undefined && isCustomProfileKind(kind) ? [[kind, profile] as const] : [];
    });

  const nextKind = () => {
    for (let index = 1; ; index++) {
      const kind = `mttx.apple.custom.uploaded${index === 1 ? "" : index}`;

      if (!(kind in props.config)) return kind;
    }
  };

  const upload = async () => {
    setError(null);

    try {
      const file = await selectFile("application/x-apple-aspen-config,.mobileconfig");
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const head = new TextDecoder().decode(bytes.slice(0, 512));

      const signed =
        (bytes[0] === 0x30 && (bytes[1] === 0x82 || bytes[1] === 0x81 || bytes[1] === 0x80)) ||
        /-----BEGIN (?:PKCS7|CMS)-----/.test(head);

      props.setKey(nextKind(), {
        content: arrayBufferToBase64(buffer),
        fileName: file.name,
        signed,
      });
    } catch (error_) {
      if (error_ instanceof Error && /abort/i.test(error_.name)) return;
      setError(errorMessage(raisedFailure(error_), "Could not read that file."));
    }
  };

  const extract = async (kind: string) => {
    const value = Option.getOrUndefined(decodeCustomProfile(props.config[kind]));

    if (value === undefined) return;

    setBusy(kind);
    setError(null);

    try {
      const result = await enterprise.extractMobileconfig(value.content);
      props.setKey(kind, {
        ...value,
        content: arrayBufferToBase64(new TextEncoder().encode(result.plist).buffer),
        signed: false,
      });
    } catch (error_) {
      setError(errorMessage(raisedFailure(error_), "Could not remove the signature."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
        <div class="min-w-0 flex-1">
          <p class="text-xs font-medium text-foreground">Existing profiles</p>
          <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Signed profiles keep their signature and deploy byte-for-byte. User-scoped profiles must
            declare <code class="font-mono text-xs">PayloadScope User</code> and are delivered
            on the Apple user channel; device-scoped profiles stay on the device channel.
          </p>
        </div>
        <DocumentationLink
          href={APPLE_PROFILE_DOCS}
          source="Apple"
          subject="configuration profiles"
        />
        <Button onClick={upload}>Upload profile</Button>
      </div>

      <Show when={error()}>{(message) => <ErrorText error={message()} />}</Show>

      <Show
        when={profiles().length > 0}
        fallback={
          <p class="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-xs text-muted-foreground">
            No profiles uploaded yet.
          </p>
        }
      >
        <div class="space-y-3">
          <For each={profiles()}>
            {([kind, profile]) => {
              return (
                <div class="overflow-hidden rounded-lg border border-border">
                  <div class="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-3 py-2">
                    <span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                      {kind}
                    </span>
                    <ScopeSelect kind={kind} scopes={props.scopes} setScope={props.setScope} />
                    <Show when={profile.signed}>
                      <Badge
                        variant="success"
                      >
                        Signed · read-only
                      </Badge>
                    </Show>
                    <Show when={profile.signed}>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy() === kind}
                        onClick={() => void extract(kind)}
                      >
                        {busy() === kind ? "Removing…" : "Remove signature & edit"}
                      </Button>
                    </Show>
                    <Button size="sm" variant="ghost" onClick={() => props.setKey(kind, null)}>
                      Remove
                    </Button>
                  </div>
                  <div class="p-3">
                    <Show when={kind === "mttx.apple.custom.designer"}>
                      <p class="text-xs leading-relaxed text-muted-foreground">
                        This profile is generated by the designer. Edit it there so the draft and
                        the compiled profile stay in sync.
                      </p>
                    </Show>
                    <Show
                      when={!profile.signed && kind !== "mttx.apple.custom.designer"}
                      fallback={
                        <Show when={kind !== "mttx.apple.custom.designer"}>
                          <p class="text-xs leading-relaxed text-muted-foreground">
                            {profile.fileName ?? "Uploaded profile"} is deployed unchanged. Devices
                            verify its signature with the certificate it already trusts.
                          </p>
                        </Show>
                      }
                    >
                      <label class="space-y-1.5">
                        <span class="text-xs font-medium text-foreground/90">
                          Profile plist
                        </span>
                        <textarea
                          class={`${textareaClass} min-h-56 font-mono text-xs leading-relaxed`}
                          value={decodeText(profile.content)}
                          onInput={(event) => {
                            props.setKey(kind, {
                              ...profile,
                              content: arrayBufferToBase64(
                                new TextEncoder().encode(event.currentTarget.value).buffer,
                              ),
                              signed: false,
                            });
                          }}
                        />
                      </label>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

const decodeText = (content: string) => new TextDecoder().decode(base64ToArrayBuffer(content));

/**
 * Variable reference for the policy editor.
 *
 * Names are rendered verbatim (`${device.name}`) so they can be copied into a
 * payload. Unknown names fail when the policy is saved; an attribute with no
 * value on a device resolves to an empty string.
 */
function VariableHints(props: {
  loading: boolean;
  variables: ReadonlyArray<{ name: string; description: string }>;
  notes: ReadonlyArray<string>;
}) {
  return (
    <details class="mt-4 rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-xs">
      <summary class="flex cursor-pointer list-none items-center gap-2 font-medium text-foreground">
        <span class="min-w-0">
          Policy variables{" "}
          <span class="font-normal text-muted-foreground">(resolved per device at delivery)</span>
        </span>
        <span class="disclosure-chevron ml-auto text-muted-foreground"><ChevronDown class="size-3.5 shrink-0" /></span>
      </summary>
      <Show
        when={!props.loading}
        fallback={<p class="mt-2 text-muted-foreground">Loading variables…</p>}
      >
        <ul class="mt-2 grid gap-1.5 sm:grid-cols-2">
          <For each={props.variables}>
            {(variable) => (
              <li class="min-w-0">
                <code class="break-all font-mono text-xs text-foreground">
                  {variable.name}
                </code>
                <p class="text-xs leading-relaxed text-muted-foreground">
                  {variable.description}
                </p>
              </li>
            )}
          </For>
        </ul>
        <Show when={props.notes.length > 0}>
          <ul class="mt-2 space-y-1 border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
            <For each={props.notes}>{(note) => <li>{note}</li>}</For>
          </ul>
        </Show>
      </Show>
    </details>
  );
}
