import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import { ErrorText, Field, QueryError } from "~/components/mdm/common";
import { errorMessage } from "~/lib/errors";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  Boxes,
  CircleAlert,
  CheckCircle2,
  Download,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  MonitorSmartphone,
} from "~/components/ui/icons";
import { enterprise, enterpriseKeys, type AutopilotProfileInfo } from "~/lib/enterprise";
import { arrayBufferToBase64, selectFile } from "~/lib/upload-file";

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
    <div class="grid gap-6 xl:grid-cols-2">
      <QueryError
        class="xl:col-span-2"
        error={apns.error ?? android.error}
        onRetry={() => {
          void apns.refetch();
          void android.refetch();
        }}
      />
      <Card class="xl:col-span-2">
        <CardHeader>
          <CardTitle>Apple push notifications</CardTitle>
        </CardHeader>
        <CardContent class="space-y-5">
          <div class="flex flex-wrap items-center gap-3">
            <Badge variant={apns.data?.configured ? "default" : "outline"}>
              {apns.data?.configured ? "Configured" : "Not configured"}
            </Badge>
            <Show when={apns.data?.topic}>
              <span class="font-mono text-xs text-muted-foreground">{apns.data!.topic}</span>
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
              <div class="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                <CheckCircle2 class="mt-0.5 size-4 shrink-0" />
                <div>
                  <p class="font-medium">Apple devices can receive push notifications</p>
                  <p class="mt-1 text-green-700">
                    Renew the certificate before it expires to keep devices checking in promptly.
                  </p>
                </div>
              </div>
            }
          >
            <div class="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <CircleAlert class="mt-0.5 size-4 shrink-0" />
              <div>
                <p class="font-medium">APNs setup required</p>
                <p class="mt-1 text-amber-700">
                  Without APNs, enrolled Apple devices only apply changes when they next poll.
                </p>
              </div>
            </div>
          </Show>

          <ol class="grid gap-3 md:grid-cols-3">
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

          <div class="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadCsr}>
              <Download class="size-4" />
              Download CSR
            </Button>
            <Button variant="outline" onClick={() => setStep(3)}>
              I already have a certificate
            </Button>
          </div>
          <Show when={csrError()}>
            <p class="text-sm text-red-600">{csrError()}</p>
          </Show>

          <Show when={step() >= 3 || apns.data?.configured}>
            <form
              class="space-y-4 border-t pt-5"
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
                <div class="flex gap-2">
                  <Button type="button" variant="outline" onClick={chooseCert}>
                    Choose file
                  </Button>
                  <Show when={fileName()}>
                    <span class="self-center text-sm text-muted-foreground">{fileName()}</span>
                  </Show>
                </div>
              </Field>
              <Show when={cert()}>
                <pre class="max-h-32 overflow-auto rounded-lg bg-stone-100 p-3 font-mono text-[11px] text-stone-600">
                  {cert().slice(0, 600)}
                  {cert().length > 600 ? "\n…" : ""}
                </pre>
              </Show>
              <ErrorText error={upload.error} />
              <Button disabled={upload.isPending || !cert()}>
                {upload.isPending ? "Uploading…" : "Save certificate"}
              </Button>
            </form>
          </Show>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Windows</CardTitle>
        </CardHeader>
        <CardContent class="flex items-start gap-3 text-sm">
          <MonitorSmartphone class="mt-0.5 size-4 text-muted-foreground" />
          <div>
            <p class="font-medium">Windows MDM enrollment</p>
            <p class="mt-1 text-muted-foreground">
              Discovery, WSTEP enrollment and certificate issuance are implemented. Policy
              management is next.
            </p>
            <Badge variant="secondary" class="mt-3">
              Enrollment available
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Android</CardTitle>
        </CardHeader>
        <CardContent class="flex items-start gap-3 text-sm">
          <Smartphone class="mt-0.5 size-4 text-muted-foreground" />
          <div class="min-w-0 flex-1 space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-medium">Android Enterprise</p>
              <Show when={android.data}>
                {(data) => (
                  <Badge
                    variant={data().status === "active" ? "default" : "outline"}
                    class="capitalize"
                  >
                    {!data().configured ? "Not configured" : data().status}
                  </Badge>
                )}
              </Show>
            </div>
            <Show when={android.data} fallback={<p class="text-muted-foreground">Loading…</p>}>
              {(data) => (
                <>
                  <Show when={!data().configured}>
                    <p class="text-muted-foreground">
                      Android Enterprise is not configured for this deployment. Set{" "}
                      <span class="font-mono text-xs">ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON</span>{" "}
                      and restart the API. Android enrollment stays unavailable until then.
                    </p>
                  </Show>
                  <Show when={data().configured && !data().enterpriseName}>
                    <p class="text-muted-foreground">
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
                    <div class="space-y-1 text-muted-foreground">
                      <p class="break-all font-mono text-xs text-stone-700">
                        {data().enterpriseName}
                      </p>
                      <Show when={data().pubsubTopic}>
                        <p class="break-all text-xs">Topic: {data().pubsubTopic}</p>
                      </Show>
                      <Show when={data().pubsubSubscription}>
                        <p class="break-all text-xs">Subscription: {data().pubsubSubscription}</p>
                      </Show>
                      <p class="text-xs">
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
                    <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      {data().lastError}
                    </p>
                  </Show>
                </>
              )}
            </Show>
            <ErrorText error={connectAndroid.error ?? syncAndroid.error ?? toggleAndroid.error} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Apple Business Manager</CardTitle>
        </CardHeader>
        <CardContent class="flex items-start gap-3 text-sm">
          <ShieldCheck class="mt-0.5 size-4 text-muted-foreground" />
          <div class="min-w-0 flex-1 space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-medium">Automated Device Enrollment</p>
              <Show when={abm.data}>
                {(data) => (
                  <Badge
                    variant={data().status === "active" ? "default" : "outline"}
                    class="capitalize"
                  >
                    {!data().configured ? "Not configured" : data().status}
                  </Badge>
                )}
              </Show>
            </div>
            <Show when={abm.data} fallback={<p class="text-muted-foreground">Loading…</p>}>
              {(data) => (
                <>
                  <Show when={!data().configured}>
                    <p class="text-muted-foreground">
                      Connect Apple Business Manager to see pre-enrollment devices and assign them
                      to Mattrax. Create an API account in Apple Business Manager → Settings → API,
                      download its private key, then upload it here with the Client ID and Key ID.
                    </p>
                  </Show>
                  <Show when={data().configured}>
                    <div class="space-y-1 text-muted-foreground">
                      <Show when={data().appleOrgName}>
                        <p class="text-xs">{data().appleOrgName}</p>
                      </Show>
                      <Show when={data().appleOrgId}>
                        <p class="break-all font-mono text-xs text-stone-700">
                          {data().appleOrgId}
                        </p>
                      </Show>
                      <Show when={data().credentialType === "legacy_dep"}>
                        <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                          This tenant has a legacy DEP .p7m server token. Mattrax syncs through the
                          Apple Business API; create an API account and upload its .pem key with the
                          Client ID and Key ID to enable device sync and assignment.
                        </p>
                      </Show>
                      <p class="text-xs">
                        {data().deviceCount} ABM device{data().deviceCount === 1 ? "" : "s"} ·{" "}
                        {data().assignedCount} assigned
                        {data().lastSyncedAt
                          ? ` · last sync ${new Date(data().lastSyncedAt!).toLocaleString()}`
                          : " · not synced yet"}
                      </p>
                      <Show when={data().tokenExpiresAt}>
                        <p class="text-xs">
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
                      <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                        {data().lastError}
                      </p>
                    </Show>
                  </Show>
                  <form
                    class="space-y-3 border-t pt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      uploadAbm.mutate();
                    }}
                  >
                    <p class="text-xs text-muted-foreground">
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
                        <span class="text-sm text-muted-foreground">{abmFileName()}</span>
                      </Show>
                    </div>
                    <ErrorText error={uploadAbm.error ?? syncAbm.error ?? deleteAbm.error} />
                    <Button disabled={uploadAbm.isPending || !abmContent()}>
                      {uploadAbm.isPending ? "Validating…" : "Save ABM credential"}
                    </Button>
                  </form>
                </>
              )}
            </Show>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Apps and Books (VPP)</CardTitle>
        </CardHeader>
        <CardContent class="flex items-start gap-3 text-sm">
          <Boxes class="mt-0.5 size-4 text-muted-foreground" />
          <div class="min-w-0 flex-1 space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-medium">Volume licences</p>
              <Show when={vpp.data}>
                {(data) => (
                  <Badge
                    variant={data().status === "active" ? "default" : "outline"}
                    class="capitalize"
                  >
                    {!data().configured ? "Not configured" : data().status}
                  </Badge>
                )}
              </Show>
            </div>
            <Show when={vpp.data} fallback={<p class="text-muted-foreground">Loading…</p>}>
              {(data) => (
                <>
                  <Show when={!data().configured}>
                    <p class="text-muted-foreground">
                      Upload an Apps and Books content token (.vpptoken) to install purchased apps
                      on devices with a consumed licence.
                    </p>
                  </Show>
                  <Show when={data().configured}>
                    <div class="space-y-1 text-muted-foreground">
                      <Show when={data().appleOrgId}>
                        <p class="break-all font-mono text-xs text-stone-700">
                          {data().appleOrgId}
                        </p>
                      </Show>
                      <p class="text-xs">
                        {data().assets} asset{data().assets === 1 ? "" : "s"} ·{" "}
                        {data().availableLicenses} available · {data().assignedLicenses} assigned
                        {data().lastSyncedAt
                          ? ` · last sync ${new Date(data().lastSyncedAt!).toLocaleString()}`
                          : " · not synced yet"}
                      </p>
                      <Show when={data().tokenExpiresAt}>
                        <p class="text-xs">
                          Token expires {new Date(data().tokenExpiresAt!).toLocaleDateString()}
                        </p>
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
                      <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                        {data().lastError}
                      </p>
                    </Show>
                  </Show>
                  <form
                    class="space-y-3 border-t pt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      uploadVpp.mutate();
                    }}
                  >
                    <p class="text-xs text-muted-foreground">
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
                        <span class="text-sm text-muted-foreground">{vppFileName()}</span>
                      </Show>
                    </div>
                    <ErrorText error={uploadVpp.error ?? syncVpp.error ?? deleteVpp.error} />
                    <Button disabled={uploadVpp.isPending || !vppContent()}>
                      {uploadVpp.isPending ? "Validating…" : "Save Apps and Books token"}
                    </Button>
                  </form>
                </>
              )}
            </Show>
          </div>
        </CardContent>
      </Card>

      <Card class="xl:col-span-2">
        <CardHeader>
          <CardTitle>Windows Autopilot</CardTitle>
        </CardHeader>
        <CardContent class="space-y-5 text-sm">
          <div class="flex flex-wrap items-center gap-3">
            <MonitorSmartphone class="size-4 text-muted-foreground" />
            <Badge variant={autopilot.data?.configured ? "default" : "outline"}>
              {autopilot.data?.configured ? "Connected to Microsoft Graph" : "Not configured"}
            </Badge>
            <Show when={autopilot.data?.azureTenantId}>
              <span class="font-mono text-xs text-muted-foreground">
                {autopilot.data!.azureTenantId}
              </span>
            </Show>
            <Show when={autopilot.data?.federatedEnrollment.enabled}>
              <Badge variant="secondary">Federated Entra enrollment</Badge>
            </Show>
          </div>

          <Show when={autopilot.data} fallback={<p class="text-muted-foreground">Loading…</p>}>
            {(data) => (
              <>
                <Show when={!data().graphConfigured}>
                  <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    Microsoft Graph credentials are not configured for this deployment. Set{" "}
                    <span class="font-mono">AZURE_CLIENT_ID</span> and{" "}
                    <span class="font-mono">AZURE_CLIENT_SECRET</span>, then restart the API.
                  </p>
                </Show>
                <Show when={data().graphConfigured && !data().azureTenantId}>
                  <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    Connect Entra ID for this tenant in Settings → Identity. Autopilot imports and
                    profile assignment stay disabled until a tenant id is configured.
                  </p>
                </Show>
                <div class="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                  <p>
                    <span class="font-medium text-stone-800">{data().deviceCount}</span> Autopilot
                    device{data().deviceCount === 1 ? "" : "s"} · {data().linkedDeviceCount} linked
                  </p>
                  <p>
                    <span class="font-medium text-stone-800">{data().profileCount}</span> deployment
                    profile{data().profileCount === 1 ? "" : "s"}
                  </p>
                  <p>
                    {data().lastSyncedAt
                      ? `Last synced ${new Date(data().lastSyncedAt!).toLocaleString()}`
                      : "Not synced yet"}
                  </p>
                </div>
                <Show when={data().federatedEnrollment.enabled}>
                  <p class="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
                    Windows discovery advertises <span class="font-mono">Federated</span> for this
                    tenant. Entra realm{" "}
                    <span class="font-mono">{data().federatedEnrollment.realm}</span>; policy and
                    enrollment validate the Entra JWT against the tenant JWKS before issuing a
                    certificate.
                  </p>
                </Show>
                <Show when={data().consentUrl}>
                  <a
                    class="inline-flex text-xs font-medium text-blue-700 underline"
                    href={data().consentUrl!}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Grant Microsoft Graph admin consent
                  </a>
                </Show>

                <div class="grid gap-6 lg:grid-cols-2">
                  <div class="space-y-3 border-t pt-4">
                    <div>
                      <p class="font-medium">Import hardware hashes</p>
                      <p class="mt-1 text-xs text-muted-foreground">
                        Paste the Intune Autopilot CSV (`Device Serial Number`, `Hardware Hash`,
                        optional `Group Tag`) or one `serial,hash` pair per line. At most 500 rows.
                      </p>
                    </div>
                    <textarea
                      class="min-h-28 w-full rounded-lg border p-3 font-mono text-xs"
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
                        <span class="text-xs text-muted-foreground">{autopilotFileName()}</span>
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
                          <p class="text-stone-700">
                            Imported {result().imported} device
                            {result().imported === 1 ? "" : "s"}
                            {result().skipped
                              ? ` · ${result().skipped} duplicate/over-limit rows`
                              : ""}
                          </p>
                          <Show when={result().errors.length}>
                            <ul class="max-h-28 list-disc overflow-auto pl-5 text-red-600">
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

                  <div class="space-y-3 border-t pt-4">
                    <div class="flex items-center justify-between gap-2">
                      <p class="font-medium">
                        {editingProfileId()
                          ? "Edit deployment profile"
                          : "Create deployment profile"}
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
                            class="h-9 w-full rounded-lg border bg-white px-3 text-sm"
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
                            class="h-9 w-full rounded-lg border bg-white px-3 text-sm"
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
                          checked={profileDevicePreparation()}
                          onChange={(event) =>
                            setProfileDevicePreparation(event.currentTarget.checked)
                          }
                        />
                        Enable device preparation (pre-provisioning)
                      </label>
                      <ErrorText
                        error={saveAutopilotProfile.error ?? assignAutopilotProfile.error}
                      />
                      <Button disabled={saveAutopilotProfile.isPending || !profileName().trim()}>
                        {saveAutopilotProfile.isPending
                          ? "Saving…"
                          : editingProfileId()
                            ? "Update profile"
                            : "Create profile"}
                      </Button>
                    </form>
                  </div>
                </div>

                <div class="border-t pt-4">
                  <p class="font-medium">Autopilot devices</p>
                  <Show
                    when={(autopilotDevices.data?.devices.length ?? 0) > 0}
                    fallback={
                      <p class="mt-2 text-xs text-muted-foreground">
                        No Autopilot devices yet. Import hardware hashes or sync from Graph.
                      </p>
                    }
                  >
                    <div class="mt-2 overflow-x-auto">
                      <table class="w-full text-left text-xs">
                        <thead class="text-muted-foreground">
                          <tr>
                            <th class="py-2 pr-3 font-medium">Serial</th>
                            <th class="py-2 pr-3 font-medium">Group tag</th>
                            <th class="py-2 pr-3 font-medium">Profile</th>
                            <th class="py-2 pr-3 font-medium">Enrollment</th>
                            <th class="py-2 pr-3 font-medium">Device</th>
                            <th class="py-2 font-medium" />
                          </tr>
                        </thead>
                        <tbody>
                          <For each={autopilotDevices.data?.devices ?? []}>
                            {(device) => (
                              <tr class="border-t">
                                <td class="py-2 pr-3 font-mono">{device.serial}</td>
                                <td class="py-2 pr-3">{device.groupTag ?? "—"}</td>
                                <td class="py-2 pr-3">{device.profileStatus}</td>
                                <td class="py-2 pr-3">{device.enrollmentState}</td>
                                <td class="py-2 pr-3">
                                  {device.deviceId ? (
                                    <a
                                      class="text-blue-700 underline"
                                      href={`/t/${params.tenantId}/devices/${device.deviceId}`}
                                    >
                                      Linked
                                    </a>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td class="py-2 text-right">
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

                <div class="border-t pt-4">
                  <p class="font-medium">Deployment profiles</p>
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
        </CardContent>
      </Card>
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
    <div class="rounded-lg border p-3">
      <div class="flex flex-wrap items-center gap-2">
        <p class="font-medium">{props.profile.name}</p>
        <Badge variant={props.profile.status === "active" ? "default" : "outline"}>
          {props.profile.status}
        </Badge>
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
          class="max-w-xs"
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
          <span class="font-mono text-[11px] text-muted-foreground">
            {props.profile.assignedGroupId}
          </span>
        </Show>
      </div>
    </div>
  );
}

function Step(props: { index: number; active: boolean; title: string; body: string }) {
  return (
    <li class="rounded-lg border p-4">
      <span
        class={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${
          props.active ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-500"
        }`}
      >
        {props.index}
      </span>
      <p class="mt-3 text-sm font-medium">{props.title}</p>
      <p class="mt-1 text-xs text-muted-foreground">{props.body}</p>
    </li>
  );
}
