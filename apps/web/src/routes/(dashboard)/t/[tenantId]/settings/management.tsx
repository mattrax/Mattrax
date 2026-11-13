import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ErrorText, Field, Panel, QueryError } from "~/components/mdm/common";
import { errorMessage } from "~/lib/errors";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Boxes,
  CircleAlert,
  CheckCircle2,
  Download,
  MonitorSmartphone,
  RotateCcw,
  ShieldCheck,
  Smartphone,
} from "~/components/ui/icons";
import { enterprise, enterpriseKeys, type AutopilotProfileInfo } from "~/lib/enterprise";
import { arrayBufferToBase64, selectFile } from "~/lib/upload-file";
import { cn } from "~/lib/utils";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-white/[0.02] px-2.5 text-base text-foreground outline-none transition-colors focus-visible:border-ring sm:text-[13px] focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60";

const textareaClass =
  "min-h-28 w-full rounded-lg border border-input bg-white/[0.02] p-3 font-mono text-base text-foreground outline-none sm:text-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export default function ManagementSettingsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const apns = useQuery(() => ({
    queryKey: enterpriseKeys.apns(params.tenantId),
    queryFn: () => enterprise.getApns(params.tenantId),
  }));
  const android = useQuery(() => ({
    queryKey: enterpriseKeys.android(params.tenantId),
    queryFn: () => enterprise.getTenantAndroid(params.tenantId),
  }));
  const abm = useQuery(() => ({
    queryKey: enterpriseKeys.abm(params.tenantId),
    queryFn: () => enterprise.getAppleBusinessManager(params.tenantId),
  }));
  const vpp = useQuery(() => ({
    queryKey: enterpriseKeys.vpp(params.tenantId),
    queryFn: () => enterprise.getVpp(params.tenantId),
  }));
  const autopilot = useQuery(() => ({
    queryKey: enterpriseKeys.autopilot(params.tenantId),
    queryFn: () => enterprise.getAutopilotSettings(params.tenantId),
  }));
  const autopilotDevices = useQuery(() => ({
    queryKey: enterpriseKeys.autopilotDevices(params.tenantId),
    queryFn: () => enterprise.listAutopilotDevices(params.tenantId),
  }));
  const autopilotProfiles = useQuery(() => ({
    queryKey: enterpriseKeys.autopilotProfiles(params.tenantId),
    queryFn: () => enterprise.listAutopilotProfiles(params.tenantId),
  }));
  const connectAndroid = useMutation(() => ({
    mutationFn: () => enterprise.createAndroidSignup(params.tenantId),
    onSuccess: (result) => {
      window.location.href = result.url;
    },
  }));
  const syncAndroid = useMutation(() => ({
    mutationFn: () => enterprise.syncTenantAndroid(params.tenantId),
    onSuccess: () => qc.invalidateQueries({ queryKey: enterpriseKeys.android(params.tenantId) }),
  }));
  const toggleAndroid = useMutation(() => ({
    mutationFn: (enabled: boolean) => enterprise.patchTenantAndroid(params.tenantId, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: enterpriseKeys.android(params.tenantId) }),
  }));
  const [email, setEmail] = createSignal("");
  const [cert, setCert] = createSignal("");
  const [fileName, setFileName] = createSignal("");
  const [csrError, setCsrError] = createSignal<string>();
  const [step, setStep] = createSignal(1);

  const [abmContent, setAbmContent] = createSignal("");
  const [abmEncoding, setAbmEncoding] = createSignal<"text" | "base64">("text");
  const [abmFileName, setAbmFileName] = createSignal("");
  const [abmClientId, setAbmClientId] = createSignal("");
  const [abmKeyId, setAbmKeyId] = createSignal("");
  const [abmTeamId, setAbmTeamId] = createSignal("");
  const [vppContent, setVppContent] = createSignal("");
  const [vppEncoding, setVppEncoding] = createSignal<"text" | "base64">("text");
  const [vppFileName, setVppFileName] = createSignal("");

  const chooseAbmFile = async () => {
    try {
      const file = await selectFile(".pem,.p7m,.json,.txt");
      setAbmFileName(file.name);
      if (file.name.toLowerCase().endsWith(".p7m")) {
        setAbmContent(arrayBufferToBase64(await file.arrayBuffer()));
        setAbmEncoding("base64");
      } else {
        setAbmContent(await file.text());
        setAbmEncoding("text");
      }
    } catch {
      // User cancelled.
    }
  };

  const chooseVppFile = async () => {
    try {
      const file = await selectFile(".vpptoken,.txt,.json");
      setVppFileName(file.name);
      setVppContent(await file.text());
      setVppEncoding("text");
    } catch {
      // User cancelled.
    }
  };

  const uploadAbm = useMutation(() => ({
    mutationFn: () =>
      enterprise.uploadAppleBusinessManagerToken(params.tenantId, {
        content: abmContent(),
        encoding: abmEncoding(),
        fileName: abmFileName() || undefined,
        clientId: abmClientId() || undefined,
        keyId: abmKeyId() || undefined,
        teamId: abmTeamId() || undefined,
      }),
    onSuccess: async () => {
      setAbmContent("");
      setAbmFileName("");
      await qc.invalidateQueries({ queryKey: enterpriseKeys.abm(params.tenantId) });
    },
  }));
  const syncAbm = useMutation(() => ({
    mutationFn: () => enterprise.syncAppleBusinessManager(params.tenantId),
    onSuccess: () => qc.invalidateQueries({ queryKey: enterpriseKeys.abm(params.tenantId) }),
  }));
  const deleteAbm = useMutation(() => ({
    mutationFn: () => enterprise.deleteAppleBusinessManagerToken(params.tenantId),
    onSuccess: () => qc.invalidateQueries({ queryKey: enterpriseKeys.abm(params.tenantId) }),
  }));
  const uploadVpp = useMutation(() => ({
    mutationFn: () =>
      enterprise.uploadVppToken(params.tenantId, {
        content: vppContent(),
        encoding: vppEncoding(),
        fileName: vppFileName() || undefined,
      }),
    onSuccess: async () => {
      setVppContent("");
      setVppFileName("");
      await qc.invalidateQueries({ queryKey: enterpriseKeys.vpp(params.tenantId) });
    },
  }));
  const syncVpp = useMutation(() => ({
    mutationFn: () => enterprise.syncVpp(params.tenantId),
    onSuccess: () => qc.invalidateQueries({ queryKey: enterpriseKeys.vpp(params.tenantId) }),
  }));
  const deleteVpp = useMutation(() => ({
    mutationFn: () => enterprise.deleteVppToken(params.tenantId),
    onSuccess: () => qc.invalidateQueries({ queryKey: enterpriseKeys.vpp(params.tenantId) }),
  }));

  const [autopilotContent, setAutopilotContent] = createSignal("");
  const [autopilotFileName, setAutopilotFileName] = createSignal("");
  const [profileName, setProfileName] = createSignal("");
  const [profileDescription, setProfileDescription] = createSignal("");
  const [profileMode, setProfileMode] = createSignal<
    "userDriven" | "selfDeploying" | "preProvisioned"
  >("userDriven");
  const [profileJoinType, setProfileJoinType] = createSignal<
    "azureADJoin" | "azureADJoinUsingDeviceAuth" | "hybridAzureADJoin"
  >("azureADJoin");
  const [profileNameTemplate, setProfileNameTemplate] = createSignal("");
  const [profileLocale, setProfileLocale] = createSignal("");
  const [profileTimezone, setProfileTimezone] = createSignal("");
  const [profileDevicePreparation, setProfileDevicePreparation] = createSignal(false);
  const [profileGroupId, setProfileGroupId] = createSignal("");
  const [editingProfileId, setEditingProfileId] = createSignal<string | null>(null);

  const resetProfileForm = () => {
    setEditingProfileId(null);
    setProfileName("");
    setProfileDescription("");
    setProfileMode("userDriven");
    setProfileJoinType("azureADJoin");
    setProfileNameTemplate("");
    setProfileLocale("");
    setProfileTimezone("");
    setProfileDevicePreparation(false);
    setProfileGroupId("");
  };

  const invalidateAutopilot = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: enterpriseKeys.autopilot(params.tenantId) }),
      qc.invalidateQueries({ queryKey: enterpriseKeys.autopilotDevices(params.tenantId) }),
      qc.invalidateQueries({ queryKey: enterpriseKeys.autopilotProfiles(params.tenantId) }),
    ]);
  };

  const chooseAutopilotFile = async () => {
    try {
      const file = await selectFile(".csv,.txt");
      setAutopilotFileName(file.name);
      setAutopilotContent(await file.text());
    } catch {
      // User cancelled.
    }
  };

  const importAutopilot = useMutation(() => ({
    mutationFn: () =>
      enterprise.importAutopilotDevices(params.tenantId, {
        content: autopilotContent(),
        format: autopilotFileName().toLowerCase().endsWith(".csv") ? "csv" : "text",
      }),
    onSuccess: async (result) => {
      if (result.imported > 0) {
        setAutopilotContent("");
        setAutopilotFileName("");
      }
      await invalidateAutopilot();
    },
  }));
  const syncAutopilot = useMutation(() => ({
    mutationFn: () => enterprise.syncAutopilotDevices(params.tenantId),
    onSuccess: invalidateAutopilot,
  }));
  const deleteAutopilotDevice = useMutation(() => ({
    mutationFn: (serial: string) => enterprise.deleteAutopilotDevice(params.tenantId, serial),
    onSuccess: invalidateAutopilot,
  }));
  const saveAutopilotProfile = useMutation(() => ({
    mutationFn: () => {
      const payload = {
        name: profileName(),
        description: profileDescription() || null,
        deploymentMode: profileMode(),
        joinType: profileJoinType(),
        deviceNameTemplate: profileNameTemplate() || null,
        locale: profileLocale() || null,
        timezone: profileTimezone() || null,
        enableDevicePreparation: profileDevicePreparation(),
        assignedGroupId: profileGroupId() || null,
      };
      const editing = editingProfileId();
      return editing
        ? enterprise.updateAutopilotProfile(params.tenantId, editing, payload)
        : enterprise.createAutopilotProfile(params.tenantId, payload);
    },
    onSuccess: async () => {
      resetProfileForm();
      await invalidateAutopilot();
    },
  }));
  const assignAutopilotProfile = useMutation(() => ({
    mutationFn: (input: { profileId: string; groupId: string }) =>
      enterprise.assignAutopilotProfile(params.tenantId, input.profileId, input.groupId),
    onSuccess: invalidateAutopilot,
  }));

  const downloadCsr = async () => {
    setCsrError(undefined);
    try {
      const response = await fetch(`/api/v1/tenants/${params.tenantId}/apns/csr`, {
        credentials: "include",
        headers: { "x-effect-auth-csrf": "1" },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => undefined);
        throw new Error(errorMessage(body, `CSR request failed (${response.status})`));
      }
      const data = (await response.json()) as { plist?: string };
      if (!data.plist) throw new Error("The server did not return a CSR");
      const bytes = Uint8Array.from(atob(data.plist), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/x-plist" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "mattrax-push-csr.plist";
      link.click();
      URL.revokeObjectURL(url);
      setStep(2);
    } catch (error) {
      setCsrError(errorMessage(error, "Could not download the CSR"));
    }
  };

  const chooseCert = async () => {
    try {
      const file = await selectFile(".pem,.cer,.crt");
      setFileName(file.name);
      setCert(await file.text());
    } catch {
      // User cancelled.
    }
  };

  const upload = useMutation(() => ({
    mutationFn: () => enterprise.uploadApns(params.tenantId, { email: email(), cert: cert() }),
    onSuccess: async () => {
      setCert("");
      setFileName("");
      setStep(1);
      await qc.invalidateQueries({ queryKey: enterpriseKeys.apns(params.tenantId) });
    },
  }));

  return (
    <div class="grid gap-5 xl:grid-cols-2">
      <QueryError
        class="xl:col-span-2"
        error={apns.error ?? android.error}
        onRetry={() => {
          void apns.refetch();
          void android.refetch();
        }}
      />

      <Panel
        class="xl:col-span-2"
        title="Apple push notifications"
        description="APNs wakes enrolled Apple devices so policy and app changes apply immediately instead of waiting for the next poll."
      >
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Chip tone={apns.data?.configured ? "success" : "warning"}>
            {apns.data?.configured ? "Configured" : "Not configured"}
          </Chip>
          <Show when={apns.data?.topic}>
            <span class="break-all font-mono text-[11px] text-muted-foreground">
              {apns.data!.topic}
            </span>
          </Show>
          <Show when={apns.data?.email}>
            <span class="text-xs text-muted-foreground">· {apns.data!.email}</span>
          </Show>
          <Show when={apns.data?.expiresAt}>
            <span class="text-xs text-muted-foreground">
              · expires {new Date(apns.data!.expiresAt!).toLocaleDateString()}
            </span>
          </Show>
        </div>

        <Show
          when={!apns.data?.configured}
          fallback={
            <div class="mt-4 flex items-start gap-3 rounded-lg border border-success/25 bg-success/[0.06] p-4 text-[13px]">
              <CheckCircle2 class="mt-0.5 size-4 shrink-0 text-success-foreground" />
              <div>
                <p class="font-medium text-foreground">
                  Apple devices can receive push notifications
                </p>
                <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Renew the certificate before it expires to keep devices checking in promptly.
                </p>
              </div>
            </div>
          }
        >
          <div class="mt-4 flex items-start gap-3 rounded-lg border border-warning/25 bg-warning/[0.06] p-4 text-[13px]">
            <CircleAlert class="mt-0.5 size-4 shrink-0 text-warning-foreground" />
            <div>
              <p class="font-medium text-foreground">APNs setup required</p>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                Without APNs, enrolled Apple devices only apply changes when they next poll.
              </p>
            </div>
          </div>
        </Show>

        <ol class="mt-5 grid gap-3 md:grid-cols-3">
          <Step
            index={1}
            active={step() >= 1}
            title="Download a CSR"
            body="Mattrax generates a private key and certificate signing request."
          />
          <Step
            index={2}
            active={step() >= 2}
            title="Upload to Apple"
            body="Sign in to identity.apple.com/pushcert and upload the CSR."
          />
          <Step
            index={3}
            active={step() >= 3}
            title="Upload the certificate"
            body="Paste the signed .pem certificate below to finish setup."
          />
        </ol>

        <div class="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={downloadCsr}>
            <Download class="size-4" />
            Download CSR
          </Button>
          <Button variant="outline" onClick={() => setStep(3)}>
            I already have a certificate
          </Button>
        </div>
        <Show when={csrError()}>
          <p class="mt-3 text-[13px] text-destructive">{csrError()}</p>
        </Show>

        <Show when={step() >= 3 || apns.data?.configured}>
          <form
            class="mt-5 space-y-4 border-t border-white/[0.06] pt-5"
            onSubmit={(event) => {
              event.preventDefault();
              upload.mutate();
            }}
          >
            <Field label="Apple ID used for the certificate">
              <Input
                type="email"
                required
                placeholder="you@example.com"
                value={email()}
                onInput={(event) => setEmail(event.currentTarget.value)}
              />
            </Field>
            <Field label="Push certificate (.pem)">
              <div class="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={chooseCert}>
                  Choose file
                </Button>
                <Show when={fileName()}>
                  <span class="min-w-0 break-all text-xs text-muted-foreground">{fileName()}</span>
                </Show>
              </div>
            </Field>
            <Show when={cert()}>
              <pre class="max-h-32 overflow-auto rounded-lg border border-white/[0.07] bg-black/25 p-3 font-mono text-[11px] text-muted-foreground">
                {cert().slice(0, 600)}
                {cert().length > 600 ? "\n…" : ""}
              </pre>
            </Show>
            <ErrorText error={upload.error} />
            <Button type="submit" disabled={upload.isPending || !cert()}>
              {upload.isPending ? "Uploading…" : "Save certificate"}
            </Button>
          </form>
        </Show>
      </Panel>

      <Panel title="Windows">
        <div class="flex items-start gap-3 text-[13px]">
          <span class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04] text-muted-foreground">
            <MonitorSmartphone class="size-4" />
          </span>
          <div class="min-w-0">
            <p class="font-medium text-foreground">Windows MDM enrollment</p>
            <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
              Discovery, WSTEP enrollment and certificate issuance are implemented. Policy
              management is next.
            </p>
            <Chip tone="success" class="mt-3">
              Enrollment available
            </Chip>
          </div>
        </div>
      </Panel>

      <Panel title="Android">
        <div class="flex items-start gap-3 text-[13px]">
          <span class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04] text-muted-foreground">
            <Smartphone class="size-4" />
          </span>
          <div class="min-w-0 flex-1 space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-medium text-foreground">Android Enterprise</p>
              <Show when={android.data}>
                {(data) => (
                  <Chip
                    tone={
                      data().status === "active"
                        ? "success"
                        : data().configured
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {!data().configured ? "Not configured" : data().status}
                  </Chip>
                )}
              </Show>
            </div>
            <Show when={android.data} fallback={<p class="text-muted-foreground">Loading…</p>}>
              {(data) => (
                <>
                  <Show when={!data().configured}>
                    <p class="text-xs leading-relaxed text-muted-foreground">
                      Android Enterprise is not configured for this deployment. Set{" "}
                      <span class="break-all font-mono text-[11px]">
                        ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON
                      </span>{" "}
                      and restart the API. Android enrollment stays unavailable until then.
                    </p>
                  </Show>
                  <Show when={data().configured && !data().enterpriseName}>
                    <p class="text-xs leading-relaxed text-muted-foreground">
                      Connect a Google Cloud project so Mattrax can create an Android enterprise,
                      push policies and receive enrollment notifications. Google hosts the signup
                      flow; you return here automatically.
                    </p>
                    <Button
                      onClick={() => connectAndroid.mutate()}
                      disabled={connectAndroid.isPending}
                    >
                      {connectAndroid.isPending ? "Opening Google…" : "Connect Android Enterprise"}
                    </Button>
                  </Show>
                  <Show when={data().configured && data().enterpriseName}>
                    <div class="space-y-1 text-xs leading-relaxed text-muted-foreground">
                      <p class="break-all font-mono text-[11px] text-foreground">
                        {data().enterpriseName}
                      </p>
                      <Show when={data().pubsubTopic}>
                        <p class="break-all">Topic: {data().pubsubTopic}</p>
                      </Show>
                      <Show when={data().pubsubSubscription}>
                        <p class="break-all">Subscription: {data().pubsubSubscription}</p>
                      </Show>
                      <p>
                        {data().deviceCount} Android device
                        {data().deviceCount === 1 ? "" : "s"} linked
                        {data().lastSyncedAt
                          ? ` · last sync ${new Date(data().lastSyncedAt!).toLocaleString()}`
                          : " · not synced yet"}
                      </p>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <Show when={data().status !== "active"}>
                        <Button
                          variant="outline"
                          onClick={() => toggleAndroid.mutate(true)}
                          disabled={toggleAndroid.isPending}
                        >
                          Enable Android delivery
                        </Button>
                      </Show>
                      <Show when={data().status === "active"}>
                        <Button
                          variant="outline"
                          onClick={() => syncAndroid.mutate()}
                          disabled={syncAndroid.isPending}
                        >
                          <RotateCcw class="size-4" />
                          {syncAndroid.isPending ? "Syncing…" : "Sync policies"}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => toggleAndroid.mutate(false)}
                          disabled={toggleAndroid.isPending}
                        >
                          Disable
                        </Button>
                      </Show>
                    </div>
                  </Show>
                  <Show when={data().lastError}>
                    <p class="rounded-lg border border-warning/25 bg-warning/[0.06] p-3 text-xs leading-relaxed text-warning-foreground">
                      {data().lastError}
                    </p>
                  </Show>
                </>
              )}
            </Show>
            <ErrorText error={connectAndroid.error ?? syncAndroid.error ?? toggleAndroid.error} />
          </div>
        </div>
      </Panel>

      <Panel title="Apple Business Manager">
        <div class="flex items-start gap-3 text-[13px]">
          <span class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04] text-muted-foreground">
            <ShieldCheck class="size-4" />
          </span>
          <div class="min-w-0 flex-1 space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-medium text-foreground">Automated Device Enrollment</p>
              <Show when={abm.data}>
                {(data) => (
                  <Chip
                    tone={
                      data().status === "active"
                        ? "success"
                        : data().configured
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {!data().configured ? "Not configured" : data().status}
                  </Chip>
                )}
              </Show>
            </div>
            <Show when={abm.data} fallback={<p class="text-muted-foreground">Loading…</p>}>
              {(data) => (
                <>
                  <Show when={!data().configured}>
                    <p class="text-xs leading-relaxed text-muted-foreground">
                      Connect Apple Business Manager to see pre-enrollment devices and assign them
                      to Mattrax. Create an API account in Apple Business Manager → Settings → API,
                      download its private key, then upload it here with the Client ID and Key ID.
                    </p>
                  </Show>
                  <Show when={data().configured}>
                    <div class="space-y-1 text-xs leading-relaxed text-muted-foreground">
                      <Show when={data().appleOrgName}>
                        <p>{data().appleOrgName}</p>
                      </Show>
                      <Show when={data().appleOrgId}>
                        <p class="break-all font-mono text-[11px] text-foreground">
                          {data().appleOrgId}
                        </p>
                      </Show>
                      <Show when={data().credentialType === "legacy_dep"}>
                        <p class="rounded-lg border border-warning/25 bg-warning/[0.06] p-3 text-warning-foreground">
                          This tenant has a legacy DEP .p7m server token. Mattrax syncs through the
                          Apple Business API; create an API account and upload its .pem key with the
                          Client ID and Key ID to enable device sync and assignment.
                        </p>
                      </Show>
                      <p>
                        {data().deviceCount} ABM device{data().deviceCount === 1 ? "" : "s"} ·{" "}
                        {data().assignedCount} assigned
                        {data().lastSyncedAt
                          ? ` · last sync ${new Date(data().lastSyncedAt!).toLocaleString()}`
                          : " · not synced yet"}
                      </p>
                      <Show when={data().tokenExpiresAt}>
                        <p>
                          Credential expires {new Date(data().tokenExpiresAt!).toLocaleDateString()}
                        </p>
                      </Show>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => syncAbm.mutate()}
                        disabled={syncAbm.isPending || data().credentialType === "legacy_dep"}
                      >
                        <RotateCcw class="size-4" />
                        {syncAbm.isPending ? "Syncing…" : "Sync devices"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => deleteAbm.mutate()}
                        disabled={deleteAbm.isPending}
                      >
                        Remove token
                      </Button>
                    </div>
                    <Show when={data().lastError}>
                      <p class="rounded-lg border border-warning/25 bg-warning/[0.06] p-3 text-xs leading-relaxed text-warning-foreground">
                        {data().lastError}
                      </p>
                    </Show>
                  </Show>
                  <form
                    class="space-y-3 border-t border-white/[0.06] pt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      uploadAbm.mutate();
                    }}
                  >
                    <p class="text-xs leading-relaxed text-muted-foreground">
                      Upload the ABM API private key (.pem) with its Client ID and Key ID, or a
                      legacy .p7m server token. The credential is sealed with AUTH_SECRET.
                    </p>
                    <div class="grid gap-3 md:grid-cols-3">
                      <Field label="Client ID">
                        <Input
                          placeholder="BUSINESSAPI.…"
                          value={abmClientId()}
                          onInput={(event) => setAbmClientId(event.currentTarget.value)}
                        />
                      </Field>
                      <Field label="Key ID">
                        <Input
                          value={abmKeyId()}
                          onInput={(event) => setAbmKeyId(event.currentTarget.value)}
                        />
                      </Field>
                      <Field label="Team ID (optional)">
                        <Input
                          value={abmTeamId()}
                          onInput={(event) => setAbmTeamId(event.currentTarget.value)}
                        />
                      </Field>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        data-testid="abm-token-file"
                        onClick={chooseAbmFile}
                      >
                        Choose file
                      </Button>
                      <Show when={abmFileName()}>
                        <span class="min-w-0 break-all text-xs text-muted-foreground">
                          {abmFileName()}
                        </span>
                      </Show>
                    </div>
                    <ErrorText error={uploadAbm.error ?? syncAbm.error ?? deleteAbm.error} />
                    <Button type="submit" disabled={uploadAbm.isPending || !abmContent()}>
                      {uploadAbm.isPending ? "Validating…" : "Save ABM credential"}
                    </Button>
                  </form>
                </>
              )}
            </Show>
          </div>
        </div>
      </Panel>

      <Panel title="Apps and Books (VPP)">
        <div class="flex items-start gap-3 text-[13px]">
          <span class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04] text-muted-foreground">
            <Boxes class="size-4" />
          </span>
          <div class="min-w-0 flex-1 space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-medium text-foreground">Volume licences</p>
              <Show when={vpp.data}>
                {(data) => (
                  <Chip
                    tone={
                      data().status === "active"
                        ? "success"
                        : data().configured
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {!data().configured ? "Not configured" : data().status}
                  </Chip>
                )}
              </Show>
            </div>
            <Show when={vpp.data} fallback={<p class="text-muted-foreground">Loading…</p>}>
              {(data) => (
                <>
                  <Show when={!data().configured}>
                    <p class="text-xs leading-relaxed text-muted-foreground">
                      Upload an Apps and Books content token (.vpptoken) to install purchased apps
                      on devices with a consumed licence.
                    </p>
                  </Show>
                  <Show when={data().configured}>
                    <div class="space-y-1 text-xs leading-relaxed text-muted-foreground">
                      <Show when={data().appleOrgId}>
                        <p class="break-all font-mono text-[11px] text-foreground">
                          {data().appleOrgId}
                        </p>
                      </Show>
                      <p>
                        {data().assets} asset{data().assets === 1 ? "" : "s"} ·{" "}
                        {data().availableLicenses} available · {data().assignedLicenses} assigned
                        {data().lastSyncedAt
                          ? ` · last sync ${new Date(data().lastSyncedAt!).toLocaleString()}`
                          : " · not synced yet"}
                      </p>
                      <Show when={data().tokenExpiresAt}>
                        <p>Token expires {new Date(data().tokenExpiresAt!).toLocaleDateString()}</p>
                      </Show>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => syncVpp.mutate()}
                        disabled={syncVpp.isPending}
                      >
                        <RotateCcw class="size-4" />
                        {syncVpp.isPending ? "Syncing…" : "Sync licences"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => deleteVpp.mutate()}
                        disabled={deleteVpp.isPending}
                      >
                        Remove token
                      </Button>
                    </div>
                    <Show when={data().lastError}>
                      <p class="rounded-lg border border-warning/25 bg-warning/[0.06] p-3 text-xs leading-relaxed text-warning-foreground">
                        {data().lastError}
                      </p>
                    </Show>
                  </Show>
                  <form
                    class="space-y-3 border-t border-white/[0.06] pt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      uploadVpp.mutate();
                    }}
                  >
                    <p class="text-xs leading-relaxed text-muted-foreground">
                      Upload the .vpptoken content token from Apple Business Manager → Apps and
                      Books. The token is sealed with AUTH_SECRET.
                    </p>
                    <div class="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        data-testid="vpp-token-file"
                        onClick={chooseVppFile}
                      >
                        Choose file
                      </Button>
                      <Show when={vppFileName()}>
                        <span class="min-w-0 break-all text-xs text-muted-foreground">
                          {vppFileName()}
                        </span>
                      </Show>
                    </div>
                    <ErrorText error={uploadVpp.error ?? syncVpp.error ?? deleteVpp.error} />
                    <Button type="submit" disabled={uploadVpp.isPending || !vppContent()}>
                      {uploadVpp.isPending ? "Validating…" : "Save Apps and Books token"}
                    </Button>
                  </form>
                </>
              )}
            </Show>
          </div>
        </div>
      </Panel>

      <Panel
        class="xl:col-span-2"
        title="Windows Autopilot"
        description="Register hardware hashes and publish deployment profiles through Microsoft Graph."
      >
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <MonitorSmartphone class="size-4 text-muted-foreground" />
          <Chip tone={autopilot.data?.configured ? "success" : "warning"}>
            {autopilot.data?.configured ? "Connected to Microsoft Graph" : "Not configured"}
          </Chip>
          <Show when={autopilot.data?.azureTenantId}>
            <span class="break-all font-mono text-[11px] text-muted-foreground">
              {autopilot.data!.azureTenantId}
            </span>
          </Show>
          <Show when={autopilot.data?.federatedEnrollment.enabled}>
            <Chip tone="neutral">Federated Entra enrollment</Chip>
          </Show>
        </div>

        <Show
          when={autopilot.data}
          fallback={<p class="mt-3 text-[13px] text-muted-foreground">Loading…</p>}
        >
          {(data) => (
            <>
              <Show when={!data().graphConfigured}>
                <p class="mt-4 rounded-lg border border-warning/25 bg-warning/[0.06] p-3 text-xs leading-relaxed text-warning-foreground">
                  Microsoft Graph credentials are not configured for this deployment. Set{" "}
                  <span class="font-mono">AZURE_CLIENT_ID</span> and{" "}
                  <span class="font-mono">AZURE_CLIENT_SECRET</span>, then restart the API.
                </p>
              </Show>
              <Show when={data().graphConfigured && !data().azureTenantId}>
                <p class="mt-4 rounded-lg border border-warning/25 bg-warning/[0.06] p-3 text-xs leading-relaxed text-warning-foreground">
                  Connect Entra ID for this tenant in Settings → Identity. Autopilot imports and
                  profile assignment stay disabled until a tenant id is configured.
                </p>
              </Show>

              <div class="mt-4 grid gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 text-xs text-muted-foreground sm:grid-cols-3">
                <p>
                  <span class="font-medium text-foreground">{data().deviceCount}</span> Autopilot
                  device{data().deviceCount === 1 ? "" : "s"} · {data().linkedDeviceCount} linked
                </p>
                <p>
                  <span class="font-medium text-foreground">{data().profileCount}</span> deployment
                  profile{data().profileCount === 1 ? "" : "s"}
                </p>
                <p>
                  {data().lastSyncedAt
                    ? `Last synced ${new Date(data().lastSyncedAt!).toLocaleString()}`
                    : "Not synced yet"}
                </p>
              </div>

              <Show when={data().federatedEnrollment.enabled}>
                <p class="mt-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 text-xs leading-relaxed text-muted-foreground">
                  Windows discovery advertises <span class="font-mono">Federated</span> for this
                  tenant. Entra realm{" "}
                  <span class="break-all font-mono">{data().federatedEnrollment.realm}</span>;
                  policy and enrollment validate the Entra JWT against the tenant JWKS before
                  issuing a certificate.
                </p>
              </Show>
              <Show when={data().consentUrl}>
                <a
                  class="mt-3 inline-flex text-xs font-medium text-brand underline underline-offset-2 transition-colors hover:text-brand/80"
                  href={data().consentUrl!}
                  target="_blank"
                  rel="noreferrer"
                >
                  Grant Microsoft Graph admin consent
                </a>
              </Show>

              <div class="mt-5 grid gap-6 lg:grid-cols-2">
                <div class="space-y-3 border-t border-white/[0.06] pt-4">
                  <div>
                    <p class="text-[13px] font-medium text-foreground">Import hardware hashes</p>
                    <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Paste the Intune Autopilot CSV (`Device Serial Number`, `Hardware Hash`,
                      optional `Group Tag`) or one `serial,hash` pair per line. At most 500 rows.
                    </p>
                  </div>
                  <textarea
                    class={textareaClass}
                    aria-label="Autopilot CSV import"
                    placeholder={
                      "Device Serial Number,Hardware Hash,Group Tag\nABC123,base64hash...,Engineering"
                    }
                    value={autopilotContent()}
                    onInput={(event) => setAutopilotContent(event.currentTarget.value)}
                  />
                  <div class="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" onClick={chooseAutopilotFile}>
                      Choose CSV
                    </Button>
                    <Show when={autopilotFileName()}>
                      <span class="min-w-0 break-all text-xs text-muted-foreground">
                        {autopilotFileName()}
                      </span>
                    </Show>
                    <Button
                      onClick={() => importAutopilot.mutate()}
                      disabled={
                        importAutopilot.isPending ||
                        !autopilotContent().trim() ||
                        !data().configured
                      }
                    >
                      {importAutopilot.isPending ? "Importing…" : "Import hashes"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => syncAutopilot.mutate()}
                      disabled={syncAutopilot.isPending || !data().configured}
                    >
                      <RotateCcw class="size-4" />
                      {syncAutopilot.isPending ? "Syncing…" : "Sync from Graph"}
                    </Button>
                  </div>
                  <Show when={importAutopilot.data}>
                    {(result) => (
                      <div class="space-y-1 text-xs">
                        <p class="text-muted-foreground">
                          Imported {result().imported} device
                          {result().imported === 1 ? "" : "s"}
                          {result().skipped
                            ? ` · ${result().skipped} duplicate/over-limit rows`
                            : ""}
                        </p>
                        <Show when={result().errors.length}>
                          <ul class="max-h-28 list-disc overflow-auto pl-5 text-destructive">
                            <For each={result().errors}>{(error) => <li>{error}</li>}</For>
                          </ul>
                        </Show>
                      </div>
                    )}
                  </Show>
                  <ErrorText
                    error={
                      importAutopilot.error ?? syncAutopilot.error ?? deleteAutopilotDevice.error
                    }
                  />
                </div>

                <div class="space-y-3 border-t border-white/[0.06] pt-4">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-[13px] font-medium text-foreground">
                      {editingProfileId() ? "Edit deployment profile" : "Create deployment profile"}
                    </p>
                    <Show when={editingProfileId()}>
                      <Button variant="ghost" size="sm" onClick={resetProfileForm}>
                        Cancel
                      </Button>
                    </Show>
                  </div>
                  <form
                    class="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveAutopilotProfile.mutate();
                    }}
                  >
                    <Field label="Name">
                      <Input
                        required
                        value={profileName()}
                        onInput={(event) => setProfileName(event.currentTarget.value)}
                      />
                    </Field>
                    <Field label="Description (optional)">
                      <Input
                        value={profileDescription()}
                        onInput={(event) => setProfileDescription(event.currentTarget.value)}
                      />
                    </Field>
                    <div class="grid gap-3 sm:grid-cols-2">
                      <Field label="Deployment mode">
                        <select
                          class={selectClass}
                          value={profileMode()}
                          onChange={(event) =>
                            setProfileMode(
                              event.currentTarget.value as
                                | "userDriven"
                                | "selfDeploying"
                                | "preProvisioned",
                            )
                          }
                        >
                          <option value="userDriven">User driven</option>
                          <option value="selfDeploying">Self deploying</option>
                          <option value="preProvisioned">Pre-provisioned</option>
                        </select>
                      </Field>
                      <Field label="Join type">
                        <select
                          class={selectClass}
                          value={profileJoinType()}
                          onChange={(event) =>
                            setProfileJoinType(
                              event.currentTarget.value as
                                | "azureADJoin"
                                | "azureADJoinUsingDeviceAuth"
                                | "hybridAzureADJoin",
                            )
                          }
                        >
                          <option value="azureADJoin">Entra join (user)</option>
                          <option value="azureADJoinUsingDeviceAuth">
                            Entra join (device auth)
                          </option>
                          <option value="hybridAzureADJoin">Hybrid Entra join</option>
                        </select>
                      </Field>
                    </div>
                    <div class="grid gap-3 sm:grid-cols-2">
                      <Field label="Device name template">
                        <Input
                          placeholder="DESKTOP-%SERIAL%"
                          value={profileNameTemplate()}
                          onInput={(event) => setProfileNameTemplate(event.currentTarget.value)}
                        />
                      </Field>
                      <Field label="Locale">
                        <Input
                          placeholder="en-US"
                          value={profileLocale()}
                          onInput={(event) => setProfileLocale(event.currentTarget.value)}
                        />
                      </Field>
                    </div>
                    <div class="grid gap-3 sm:grid-cols-2">
                      <Field label="Timezone">
                        <Input
                          placeholder="Australia/Sydney"
                          value={profileTimezone()}
                          onInput={(event) => setProfileTimezone(event.currentTarget.value)}
                        />
                      </Field>
                      <Field label="Assigned Entra group id">
                        <Input
                          placeholder="00000000-0000-0000-0000-000000000000"
                          value={profileGroupId()}
                          onInput={(event) => setProfileGroupId(event.currentTarget.value)}
                        />
                      </Field>
                    </div>
                    <label class="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        class="size-3.5 accent-brand"
                        checked={profileDevicePreparation()}
                        onChange={(event) =>
                          setProfileDevicePreparation(event.currentTarget.checked)
                        }
                      />
                      Enable device preparation (pre-provisioning)
                    </label>
                    <ErrorText error={saveAutopilotProfile.error ?? assignAutopilotProfile.error} />
                    <Button
                      type="submit"
                      disabled={saveAutopilotProfile.isPending || !profileName().trim()}
                    >
                      {saveAutopilotProfile.isPending
                        ? "Saving…"
                        : editingProfileId()
                          ? "Update profile"
                          : "Create profile"}
                    </Button>
                  </form>
                </div>
              </div>

              <div class="mt-5 border-t border-white/[0.06] pt-4">
                <p class="text-[13px] font-medium text-foreground">Autopilot devices</p>
                <Show
                  when={(autopilotDevices.data?.devices.length ?? 0) > 0}
                  fallback={
                    <p class="mt-2 text-xs text-muted-foreground">
                      No Autopilot devices yet. Import hardware hashes or sync from Graph.
                    </p>
                  }
                >
                  <div class="mt-3 overflow-x-auto rounded-lg border border-white/[0.07]">
                    <table class="w-full min-w-[42rem] text-left text-xs">
                      <thead class="border-b border-white/[0.06] bg-white/[0.02] text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        <tr>
                          <th class="px-3 py-2 font-medium">Serial</th>
                          <th class="px-3 py-2 font-medium">Group tag</th>
                          <th class="px-3 py-2 font-medium">Profile</th>
                          <th class="px-3 py-2 font-medium">Enrollment</th>
                          <th class="px-3 py-2 font-medium">Device</th>
                          <th class="px-3 py-2 font-medium" />
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-white/[0.05]">
                        <For each={autopilotDevices.data?.devices ?? []}>
                          {(device) => (
                            <tr class="transition-colors hover:bg-white/[0.02]">
                              <td class="px-3 py-2 font-mono text-[11px]">{device.serial}</td>
                              <td class="px-3 py-2 text-muted-foreground">
                                {device.groupTag ?? "—"}
                              </td>
                              <td class="px-3 py-2 text-muted-foreground">
                                {device.profileStatus}
                              </td>
                              <td class="px-3 py-2 text-muted-foreground">
                                {device.enrollmentState}
                              </td>
                              <td class="px-3 py-2">
                                {device.deviceId ? (
                                  <a
                                    class="text-brand underline underline-offset-2 transition-colors hover:text-brand/80"
                                    href={`/t/${params.tenantId}/devices/${device.deviceId}`}
                                  >
                                    Linked
                                  </a>
                                ) : (
                                  <span class="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td class="px-3 py-2 text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={deleteAutopilotDevice.isPending}
                                  onClick={() => deleteAutopilotDevice.mutate(device.serial)}
                                >
                                  Remove
                                </Button>
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
              </div>

              <div class="mt-5 border-t border-white/[0.06] pt-4">
                <p class="text-[13px] font-medium text-foreground">Deployment profiles</p>
                <Show
                  when={(autopilotProfiles.data?.profiles.length ?? 0) > 0}
                  fallback={
                    <p class="mt-2 text-xs text-muted-foreground">
                      No profiles yet. Create one above, then assign it to an Entra group.
                    </p>
                  }
                >
                  <div class="mt-3 space-y-3">
                    <For each={autopilotProfiles.data?.profiles ?? []}>
                      {(profile) => (
                        <AutopilotProfileRow
                          profile={profile}
                          onEdit={() => {
                            setEditingProfileId(profile.id);
                            setProfileName(profile.name);
                            setProfileDescription(profile.description ?? "");
                            setProfileMode(profile.deploymentMode);
                            setProfileJoinType(profile.joinType);
                            setProfileNameTemplate(profile.deviceNameTemplate ?? "");
                            setProfileLocale(profile.locale ?? "");
                            setProfileTimezone(profile.timezone ?? "");
                            setProfileDevicePreparation(profile.enableDevicePreparation);
                            setProfileGroupId(profile.assignedGroupId ?? "");
                          }}
                          onAssign={(groupId) =>
                            assignAutopilotProfile.mutate({ profileId: profile.id, groupId })
                          }
                          assigning={assignAutopilotProfile.isPending}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </>
          )}
        </Show>
      </Panel>
    </div>
  );
}

function AutopilotProfileRow(props: {
  profile: AutopilotProfileInfo;
  onEdit: () => void;
  onAssign: (groupId: string) => void;
  assigning: boolean;
}) {
  const [groupId, setGroupId] = createSignal(props.profile.assignedGroupId ?? "");
  return (
    <div class="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
      <div class="flex flex-wrap items-center gap-2">
        <p class="text-[13px] font-medium text-foreground">{props.profile.name}</p>
        <Chip tone={props.profile.status === "active" ? "success" : "neutral"}>
          {props.profile.status}
        </Chip>
        <span class="text-xs text-muted-foreground">
          {props.profile.deploymentMode} · {props.profile.joinType}
        </span>
        <Button variant="ghost" size="sm" class="ml-auto" onClick={props.onEdit}>
          Edit
        </Button>
      </div>
      <Show when={props.profile.description}>
        <p class="mt-1 text-xs text-muted-foreground">{props.profile.description}</p>
      </Show>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <Input
          class="w-full sm:max-w-xs"
          placeholder="Entra group id"
          value={groupId()}
          onInput={(event) => setGroupId(event.currentTarget.value)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={props.assigning || !groupId().trim()}
          onClick={() => props.onAssign(groupId().trim())}
        >
          Assign to group
        </Button>
        <Show when={props.profile.assignedGroupId}>
          <span class="break-all font-mono text-[11px] text-muted-foreground">
            {props.profile.assignedGroupId}
          </span>
        </Show>
      </div>
    </div>
  );
}

function Step(props: { index: number; active: boolean; title: string; body: string }) {
  return (
    <li class="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3.5">
      <span
        class={cn(
          "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold",
          props.active
            ? "bg-brand text-brand-foreground shadow-[inset_0_1px_0_rgba(255,255,255,.2)]"
            : "bg-white/[0.05] text-muted-foreground",
        )}
      >
        {props.index}
      </span>
      <p class="mt-3 text-[13px] font-medium text-foreground">{props.title}</p>
      <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{props.body}</p>
    </li>
  );
}

const chipTones = {
  neutral: "border-white/[0.08] bg-white/[0.03] text-muted-foreground",
  success: "border-success/25 bg-success/10 text-success-foreground",
  warning: "border-warning/25 bg-warning/10 text-warning-foreground",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
} as const;

function Chip(props: { tone: keyof typeof chipTones; children: JSX.Element; class?: string }) {
  return (
    <span
      class={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
        chipTones[props.tone],
        props.class,
      )}
    >
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {props.children}
    </span>
  );
}
