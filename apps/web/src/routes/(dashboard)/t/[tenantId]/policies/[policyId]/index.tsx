import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import {
  ErrorText,
  Field,
  formatDate,
  Page,
  PageHeader,
  Panel,
  QueryError,
  relativeTime,
} from "~/components/mdm/common";
import { MobileconfigPreview } from "~/components/mdm/mobileconfig-preview";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Activity,
  CircleAlert,
  Laptop,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Wifi,
} from "~/components/ui/icons";
import { enterprise, enterpriseKeys, type PolicyRow } from "~/lib/enterprise";
import { parsePolicyDraft } from "~/lib/policy-designer/build";
import {
  applePasscodeConfiguration,
  appleWifiConfiguration,
  windowsWifiConfiguration,
  type WifiSecurity,
} from "~/lib/policy-designer/presets";

const textareaClass =
  "min-h-28 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

const kindLabel = (kind: string) => {
  if (kind === "mttx.apple.device") return "Device restrictions";

  if (kind.startsWith("mttx.apple.certificate")) return "Certificate";

  if (kind === "mttx.apple.custom.wifi" || kind === "mttx.windows.custom.wifi") return "Wi-Fi";

  if (kind === "mttx.apple.custom.passcode") return "Passcode";

  if (kind === "mttx.apple.custom.designer") return "Apple configuration";

  if (kind.startsWith("mttx.apple.custom")) return "Custom profile";

  if (kind.startsWith("mttx.apple.application")) return "Application";

  if (kind.startsWith("mttx.apple.declaration")) return "Declaration";

  if (kind === "mttx.windows.custom.designer") return "Windows configuration";

  if (kind.startsWith("mttx.windows.custom")) return "Windows configuration";

  if (kind === "mttx.android.policy.designer") return "Android policy";

  if (kind.startsWith("mttx.android.policy")) return "Android policy";

  return kind;
};

const platformLabel = (platform: string) =>
  platform === "apple" ? "Apple" : platform === "windows" ? "Windows" : "Android";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const platformForKind = (kind: string) =>
  kind.startsWith("mttx.windows")
    ? "windows"
    : kind.startsWith("mttx.android")
      ? "android"
      : "apple";

/** Friendly description for a stored configuration, without raw JSON. */
const describe = (kind: string, data: unknown) => {
  const record = isRecord(data) ? data : {};
  const draft = parsePolicyDraft(record.draft);

  if (draft) {
    const target = platformForKind(kind);
    const selections = draft.platforms[target] ?? [];

    return {
      title: draft.name || kindLabel(kind),
      subtitle: `${kindLabel(kind)} · ${selections.length} collection${
        selections.length === 1 ? "" : "s"
      }`,
      collections: selections.map((selection) => ({ label: selection.name, platform: target })),
      platforms: [target],
    };
  }

  if (Array.isArray(record.nodes)) {
    return {
      title: typeof record.ssid === "string" ? `Wi-Fi: ${record.ssid}` : kindLabel(kind),
      subtitle: `${record.nodes.length} OMA-URI node${record.nodes.length === 1 ? "" : "s"}`,
      collections: record.nodes
        .filter(isRecord)
        .slice(0, 8)
        .map((node) => ({ label: String(node.omaUri ?? "Node"), platform: "windows" })),
      platforms: ["windows"],
    };
  }

  if (isRecord(record.policy)) {
    const keys = Object.keys(record.policy);

    return {
      title: kindLabel(kind),
      subtitle: `${keys.length} Android setting${keys.length === 1 ? "" : "s"}`,
      collections: keys.slice(0, 8).map((key) => ({ label: key, platform: "android" })),
      platforms: ["android"],
    };
  }

  if (typeof record.content === "string") {
    const signed =
      record.signed === true ||
      (!record.content.startsWith("PD94bWw") && !record.content.startsWith("PHBsaXN0"));

    const security =
      record.security === "wpa3"
        ? "WPA3 Personal"
        : record.security === "wpa2"
          ? "WPA2 Personal"
          : record.security === "open"
            ? "Open network"
            : undefined;

    return {
      title:
        typeof record.ssid === "string"
          ? `Wi-Fi: ${record.ssid}`
          : String(record.fileName ?? kindLabel(kind)),
      subtitle: signed
        ? "Signed profile · deployed exactly as uploaded"
        : security
          ? `${security} · custom profile`
          : "Custom profile",
      collections: [] as Array<{ label: string; platform: string }>,
      platforms: ["apple"],
      signed,
    };
  }

  if (typeof record.pem === "string")
    return {
      title: "Certificate",
      subtitle: "PEM certificate attached to this policy",
      collections: [],
      platforms: ["apple"],
    };

  return {
    title: kindLabel(kind),
    subtitle: Object.keys(record).length
      ? `${Object.keys(record).length} field${Object.keys(record).length === 1 ? "" : "s"}`
      : "No settings",
    collections: [],
    platforms: [],
  };
};

/** Links to the alternate policy surfaces, styled as a console tab strip. */
function ViewTabs(props: { base: string; active: "overview" | "assignments" | "designer" }) {
  const tabs = () => [
    { id: "overview" as const, label: "Overview", href: props.base },
    { id: "assignments" as const, label: "Assignments", href: `${props.base}/assignments` },
    { id: "designer" as const, label: "Designer", href: `${props.base}/design` },
  ];

  return (
    <nav
      aria-label="Policy views"
      class="no-scrollbar -mb-px flex items-center gap-0.5 overflow-x-auto border-b border-border"
    >
      <For each={tabs()}>
        {(tab) => {
          const current = tab.id === props.active;

          return (
            <a
              href={tab.href}
              aria-current={current ? "page" : undefined}
              class={
                current
                  ? "relative flex h-8 shrink-0 items-center gap-1.5 rounded-t-md border-b-2 border-brand px-2.5 text-[12.5px] font-medium text-foreground"
                  : "relative flex h-8 shrink-0 items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              }
            >
              {tab.label}
            </a>
          );
        }}
      </For>
    </nav>
  );
}

export default function PolicyDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const policy = useQuery(() => ({
    queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId),
    queryFn: () => enterprise.get(params.tenantId, "policy", params.policyId),
  }));

  const row = () => policy.data as PolicyRow | undefined;
  const [name, setName] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [priority, setPriority] = createSignal("0");
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [confirm, setConfirm] = createSignal("");
  const [addOpen, setAddOpen] = createSignal(false);
  createEffect(
    () => row()?.id,
    () => {
      const policy = row();

      if (policy) {
        setName(policy.name);
        setNotes(policy.notes ?? "");
        setPriority(String(policy.priority ?? 0));
      }
    },
  );

  const invalidate = async () => {
    await qc.invalidateQueries({
      queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId),
    });
    await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "policy") });
  };

  const save = useMutation(() => ({
    mutationFn: () =>
      enterprise.patchPolicy(params.tenantId, params.policyId, {
        name: name(),
        notes: notes() || null,
        priority: Number(priority()) || 0,
      }),
    onSuccess: invalidate,
  }));

  const addConfigurations = useMutation(() => ({
    mutationFn: (configurations: Record<string, unknown>) =>
      enterprise.patchPolicy(params.tenantId, params.policyId, { configurations }),
    onSuccess: async () => {
      setAddOpen(false);
      await invalidate();
    },
  }));

  const dup = useMutation(() => ({
    mutationFn: () => enterprise.duplicatePolicy(params.tenantId, params.policyId),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "policy") });
      navigate(`/t/${params.tenantId}/policies/${id}`);
    },
  }));

  const del = useMutation(() => ({
    mutationFn: () =>
      enterprise.deletePolicies(params.tenantId, params.policyId ? [params.policyId] : []),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "policy") });
      navigate(`/t/${params.tenantId}/policies`);
    },
  }));

  const deployments = useQuery(() => ({
    queryKey: [...enterpriseKeys.item(params.tenantId, "policy", params.policyId), "deployments"],
    queryFn: () => enterprise.listPolicyDeployments(params.tenantId, params.policyId),
  }));

  const rollback = useMutation(() => ({
    mutationFn: (deploymentId: string) =>
      enterprise.rollbackPolicy(params.tenantId, params.policyId, deploymentId),
    onSuccess: async () => {
      await invalidate();
      await qc.invalidateQueries({
        queryKey: [
          ...enterpriseKeys.item(params.tenantId, "policy", params.policyId),
          "deployments",
        ],
      });
    },
  }));

  const sync = useMutation(() => ({
    mutationFn: () => enterprise.syncPolicies(params.tenantId, [params.policyId!]),
  }));

  const configurations = () => Object.entries(row()?.configurations ?? {});

  return (
    <Page>
      <QueryError error={policy.error} onRetry={() => void policy.refetch()} />

      <PageHeader
        title={row()?.name ?? "Policy"}
        description="Configure what this policy deploys to its device scope."
        meta={
          <Show when={row()}>
            <Badge variant="outline" class="gap-1.5 text-muted-foreground">
              <SlidersHorizontal class="size-3" />
              {configurations().length} configuration{configurations().length === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline" class="gap-1.5 text-muted-foreground">
              Priority <span class="tabular-nums text-foreground">{row()?.priority ?? 0}</span>
            </Badge>
            <span class="text-[11.5px]">Updated {relativeTime(row()?.updatedAt)}</span>
          </Show>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
              {sync.isPending ? "Syncing…" : "Sync"}
            </Button>
            <Button variant="outline" onClick={() => dup.mutate()} disabled={dup.isPending}>
              Duplicate
            </Button>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              Delete
            </Button>
          </>
        }
      />

      <ViewTabs base={`/t/${params.tenantId}/policies/${params.policyId}`} active="overview" />

      <ErrorText error={sync.error} />
      <ErrorText error={dup.error} />

      <div class="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Panel title="Details" description="Metadata saved with this policy.">
          <form
            class="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <Field label="Name">
              <Input value={name()} onInput={(e) => setName(e.currentTarget.value)} />
            </Field>
            <Field label="Notes">
              <textarea
                class={textareaClass}
                value={notes()}
                onInput={(e) => setNotes(e.currentTarget.value)}
                placeholder="What does this policy do?"
              />
            </Field>
            <Field label="Conflict priority">
              <Input
                type="number"
                step="1"
                value={priority()}
                onInput={(e) => setPriority(e.currentTarget.value)}
              />
              <p class="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                Higher numbers win when included policies provide the same configuration kind.
                Direct device assignments beat group assignments first; ties fall back to the most
                recently updated policy, then the smallest id.
              </p>
            </Field>
            <ErrorText error={save.error} />
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </Panel>

        <Panel
          title="Configurations"
          description="Payloads delivered to devices in this policy's scope."
          actions={
            <div class="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" class="tabular-nums">
                {configurations().length}
              </Badge>
              <Button
                as="a"
                size="sm"
                variant="outline"
                href={`/t/${params.tenantId}/policies/${params.policyId}/editor`}
              >
                Policy editor
              </Button>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus class="mr-1 size-3.5" /> Add
              </Button>
            </div>
          }
        >
          <Show
            when={configurations().length > 0}
            fallback={
              <div class="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6">
                <p class="text-[12.5px] leading-relaxed text-muted-foreground">
                  Nothing is delivered yet. Add a Wi-Fi network or passcode rule, or open the policy
                  editor for the full catalogue.
                </p>
                <div class="flex gap-2">
                  <Button size="sm" onClick={() => setAddOpen(true)}>
                    <Plus class="mr-1 size-3.5" /> Add configuration
                  </Button>
                  <Button
                    as="a"
                    size="sm"
                    variant="outline"
                    href={`/t/${params.tenantId}/policies/${params.policyId}/editor`}
                  >
                    Policy editor
                  </Button>
                </div>
              </div>
            }
          >
            <div class="space-y-2">
              <Show
                when={configurations().some(([kind]) => kind.startsWith("mttx.android.policy"))}
              >
                <div class="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2.5 text-[12px] leading-relaxed text-warning-foreground">
                  <CircleAlert class="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Android delivery is not configured. This policy is saved, but no Android device
                    will receive it until the tenant is connected to Android Enterprise.
                  </span>
                </div>
              </Show>
              <For each={configurations()}>
                {([kind, data]) => (
                  <ConfigurationCard
                    kind={kind}
                    data={data}
                    tenantId={params.tenantId!}
                    policyId={params.policyId!}
                  />
                )}
              </For>
            </div>
          </Show>
          <ErrorText error={addConfigurations.error} />
        </Panel>

        <Panel
          class="lg:col-span-2"
          title="Deployment history"
          description="Every save produces a versioned deployment that can be restored."
          actions={
            <Badge variant="outline" class="gap-1.5 text-muted-foreground">
              <Activity class="size-3" />
              {deployments.data?.deployments.length ?? 0} version
              {(deployments.data?.deployments.length ?? 0) === 1 ? "" : "s"}
            </Badge>
          }
        >
          <Show
            when={(deployments.data?.deployments.length ?? 0) > 0}
            fallback={
              <p class="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-[12.5px] text-muted-foreground">
                No deployments yet.
              </p>
            }
          >
            <div class="divide-y divide-border/60 overflow-hidden rounded-lg border border-border">
              <For each={deployments.data?.deployments ?? []}>
                {(deployment) => (
                  <div class="flex flex-wrap items-center justify-between gap-3 bg-muted/10 px-3 py-2.5 text-[13px]">
                    <span class="flex min-w-0 items-center gap-2">
                      <Badge variant="secondary" class="text-[10px] tabular-nums">
                        Version {deployment.version}
                      </Badge>
                      <span class="truncate text-muted-foreground">
                        {formatDate(deployment.createdAt)}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={rollback.isPending}
                      onClick={() => rollback.mutate(deployment.id)}
                    >
                      Restore
                    </Button>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <ErrorText error={deployments.error || rollback.error} />
        </Panel>
      </div>

      <AddConfigurationDialog
        open={addOpen()}
        onOpenChange={setAddOpen}
        saving={addConfigurations.isPending}
        existing={configurations()}
        onAdd={(configurations) => addConfigurations.mutate(configurations)}
      />

      <Dialog open={deleteOpen()} onOpenChange={setDeleteOpen}>
        <DialogContent class="max-w-md rounded-lg p-6">
          <DialogHeader>
            <DialogTitle>Delete {row()?.name ?? "policy"}?</DialogTitle>
          </DialogHeader>
          <p class="text-sm text-muted-foreground">
            Type <span class="font-mono font-medium">{row()?.name}</span> to confirm.
          </p>
          <Input value={confirm()} onInput={(e) => setConfirm(e.currentTarget.value)} />
          <ErrorText error={del.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirm() !== row()?.name || del.isPending}
              onClick={() => del.mutate()}
            >
              Delete policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function ConfigurationCard(props: {
  kind: string;
  data: unknown;
  tenantId: string;
  policyId: string;
}) {
  const [opened, setOpened] = createSignal(false);
  const info = () => describe(props.kind, props.data);

  const content = () =>
    isRecord(props.data) && typeof props.data.content === "string" ? props.data.content : undefined;

  return (
    <details
      class="group overflow-hidden rounded-lg border border-border bg-muted/15"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-[13px] transition-colors hover:bg-muted/40">
        <span class="flex min-w-0 items-center gap-2.5">
          <span class="flex size-6 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03] text-muted-foreground">
            <Show
              when={props.kind.includes("wifi")}
              fallback={
                <Show
                  when={props.kind.includes("passcode")}
                  fallback={<SlidersHorizontal class="size-3.5" />}
                >
                  <ShieldCheck class="size-3.5" />
                </Show>
              }
            >
              <Wifi class="size-3.5" />
            </Show>
          </span>
          <span class="min-w-0">
            <span class="block truncate font-medium text-foreground">{info().title}</span>
            <span class="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
              {info().subtitle}
            </span>
          </span>
        </span>
        <span class="flex shrink-0 items-center gap-1.5">
          <For each={info().platforms}>
            {(platform) => (
              <Badge variant="outline" class="text-[10px] text-muted-foreground">
                {platformLabel(platform)}
              </Badge>
            )}
          </For>
        </span>
      </summary>
      <div class="space-y-3 border-t border-border bg-background/40 p-3">
        <Show when={info().collections.length > 0}>
          <div class="flex flex-wrap gap-1.5">
            <For each={info().collections.slice(0, 24)}>
              {(collection) => (
                <span class="inline-flex items-center gap-1.5 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1 text-[11px] text-foreground/85">
                  {collection.label}
                </span>
              )}
            </For>
            <Show when={info().collections.length > 24}>
              <span class="px-1 py-1 text-[11px] text-muted-foreground">
                +{info().collections.length - 24} more
              </span>
            </Show>
          </div>
        </Show>
        <Show when={opened() && content()}>
          {(value) => <MobileconfigPreview content={value()} />}
        </Show>
        <Show
          when={
            props.kind.includes("designer") ||
            (props.kind.startsWith("mttx.apple.declaration.") &&
              isRecord(props.data) &&
              props.data.designer === true)
          }
        >
          <div class="flex flex-wrap items-center gap-2">
            <Button
              as="a"
              size="sm"
              variant="outline"
              href={`/t/${props.tenantId}/policies/${props.policyId}/design`}
            >
              Edit in designer
            </Button>
            <Button
              as="a"
              size="sm"
              variant="ghost"
              href={`/t/${props.tenantId}/policies/${props.policyId}/editor`}
            >
              Open policy editor
            </Button>
          </div>
        </Show>
      </div>
    </details>
  );
}

function AddConfigurationDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  existing: Array<[string, unknown]>;
  onAdd: (configurations: Record<string, unknown>) => void;
}) {
  const [preset, setPreset] = createSignal<"wifi" | "passcode">("wifi");
  const [ssid, setSsid] = createSignal("");
  const [security, setSecurity] = createSignal<WifiSecurity>("wpa2");
  const [password, setPassword] = createSignal("");
  const [autoJoin, setAutoJoin] = createSignal(true);
  const [hidden, setHidden] = createSignal(false);
  const [apple, setApple] = createSignal(true);
  const [windows, setWindows] = createSignal(true);
  const [minimumLength, setMinimumLength] = createSignal(8);
  const [requireAlphanumeric, setRequireAlphanumeric] = createSignal(false);
  const [allowSimple, setAllowSimple] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  const reset = () => {
    setSsid("");
    setPassword("");
    setSecurity("wpa2");
    setAutoJoin(true);
    setHidden(false);
    setApple(true);
    setWindows(true);
    setMinimumLength(8);
    setRequireAlphanumeric(false);
    setAllowSimple(true);
    setError(null);
  };

  const submit = () => {
    setError(null);
    const next: Record<string, unknown> = Object.fromEntries(props.existing);

    if (preset() === "wifi") {
      if (!ssid().trim()) return setError("Enter the network name (SSID).");

      if (security() !== "open" && !password()) return setError("Enter the Wi-Fi password.");

      if (!apple() && !windows()) return setError("Choose at least one platform.");

      const value = {
        ssid: ssid().trim(),
        security: security(),
        password: password(),
        autoJoin: autoJoin(),
        hidden: hidden(),
      };

      if (apple()) {
        const config = appleWifiConfiguration(value);
        next[config.kind] = config.data;
      }

      if (windows()) {
        const config = windowsWifiConfiguration(value);
        next[config.kind] = config.data;
      }
    } else {
      const config = applePasscodeConfiguration({
        minimumLength: minimumLength(),
        requireAlphanumeric: requireAlphanumeric(),
        allowSimple: allowSimple(),
      });

      next[config.kind] = config.data;
    }

    props.onAdd(next);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open);

        if (!open) reset();
      }}
    >
      <DialogContent class="max-w-lg rounded-lg p-5">
        <DialogHeader>
          <DialogTitle class="text-base">Add a configuration</DialogTitle>
          <DialogDescription class="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Start with the basics. The policy editor exposes every platform setting if you need
            more.
          </DialogDescription>
        </DialogHeader>

        <div class="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setPreset("wifi")}
            class={
              preset() === "wifi"
                ? "rounded-lg border border-foreground/25 bg-white/[0.05] p-3 text-left"
                : "rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/40"
            }
          >
            <Wifi class="size-4 text-muted-foreground" />
            <span class="mt-2 block text-[13px] font-medium text-foreground">Wi-Fi network</span>
            <span class="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
              SSID, security and password for Apple and Windows.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setPreset("passcode")}
            class={
              preset() === "passcode"
                ? "rounded-lg border border-foreground/25 bg-white/[0.05] p-3 text-left"
                : "rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/40"
            }
          >
            <ShieldCheck class="size-4 text-muted-foreground" />
            <span class="mt-2 block text-[13px] font-medium text-foreground">Passcode</span>
            <span class="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
              Minimum length and complexity for Apple devices.
            </span>
          </button>
        </div>

        <Show when={preset() === "wifi"}>
          <div class="mt-4 space-y-3">
            <Field label="Network name (SSID)">
              <Input
                value={ssid()}
                onInput={(event) => setSsid(event.currentTarget.value)}
                placeholder="Staff Wi-Fi"
              />
            </Field>
            <div class="grid gap-3 sm:grid-cols-2">
              <Field label="Security">
                <select
                  class="h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] text-foreground"
                  value={security()}
                  onChange={(event) => setSecurity(event.currentTarget.value as WifiSecurity)}
                >
                  <option value="wpa2">WPA2 Personal</option>
                  <option value="wpa3">WPA3 Personal</option>
                  <option value="open">Open network</option>
                </select>
              </Field>
              <Show when={security() !== "open"}>
                <Field label="Password">
                  <Input
                    type="password"
                    value={password()}
                    onInput={(event) => setPassword(event.currentTarget.value)}
                  />
                </Field>
              </Show>
            </div>
            <div class="flex flex-wrap gap-4 text-[12.5px] text-muted-foreground">
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  class="size-3.5 accent-[var(--brand)]"
                  checked={autoJoin()}
                  onChange={(event) => setAutoJoin(event.currentTarget.checked)}
                />
                Join automatically
              </label>
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  class="size-3.5 accent-[var(--brand)]"
                  checked={hidden()}
                  onChange={(event) => setHidden(event.currentTarget.checked)}
                />
                Hidden network
              </label>
            </div>
            <div class="flex flex-wrap gap-4 text-[12.5px] text-muted-foreground">
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  class="size-3.5 accent-[var(--brand)]"
                  checked={apple()}
                  onChange={(event) => setApple(event.currentTarget.checked)}
                />
                Apple
              </label>
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  class="size-3.5 accent-[var(--brand)]"
                  checked={windows()}
                  onChange={(event) => setWindows(event.currentTarget.checked)}
                />
                Windows
              </label>
            </div>
          </div>
        </Show>

        <Show when={preset() === "passcode"}>
          <div class="mt-4 space-y-3">
            <Field label="Minimum length">
              <Input
                type="number"
                min="4"
                max="32"
                value={minimumLength()}
                onInput={(event) => setMinimumLength(Number(event.currentTarget.value) || 0)}
              />
            </Field>
            <div class="flex flex-col gap-2 text-[12.5px] text-muted-foreground">
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  class="size-3.5 accent-[var(--brand)]"
                  checked={requireAlphanumeric()}
                  onChange={(event) => setRequireAlphanumeric(event.currentTarget.checked)}
                />
                Require letters and numbers
              </label>
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  class="size-3.5 accent-[var(--brand)]"
                  checked={allowSimple()}
                  onChange={(event) => setAllowSimple(event.currentTarget.checked)}
                />
                Allow simple passcodes (e.g. 1111)
              </label>
            </div>
            <p class="text-[11.5px] leading-relaxed text-muted-foreground">
              Apple devices only. Windows Hello and Android use their own policy models.
            </p>
          </div>
        </Show>

        <Show when={error()}>
          {(message) => <p class="mt-3 text-[12.5px] text-destructive">{message()}</p>}
        </Show>

        <DialogFooter class="mt-5 flex-row justify-end gap-2 bg-transparent p-0">
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={props.saving}>
            {props.saving ? "Adding…" : "Add configuration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
