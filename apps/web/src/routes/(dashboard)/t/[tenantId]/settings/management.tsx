import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, Show } from "solid-js";
import { ErrorText, Field, QueryError } from "~/components/mdm/common";
import { errorMessage } from "~/lib/errors";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  CircleAlert,
  CheckCircle2,
  Download,
  RotateCcw,
  Smartphone,
  MonitorSmartphone,
} from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { selectFile } from "~/lib/upload-file";

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
