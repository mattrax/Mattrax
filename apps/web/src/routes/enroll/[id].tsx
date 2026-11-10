import { Meta, Title } from "@solidjs/meta";
import { useParams, useSearchParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { QrCode } from "~/components/mdm/qr-code";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  enterprise,
  type EnrollmentResponse,
  type PlatformEnrollment,
  type WindowsEnrollment,
} from "~/lib/enterprise";

export default function EnrollPage() {
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const searchCode = () => (Array.isArray(search.code) ? search.code[0] : search.code);
  const [code, setCode] = createSignal(searchCode() ?? "");
  const enrollment = useQuery(() => ({
    queryKey: ["enterprise", "public-enrollment", params.id, searchCode()],
    queryFn: () => enterprise.getEnrollment(params.id, searchCode()),
    retry: false,
  }));

  const submitCode = (event: SubmitEvent) => {
    event.preventDefault();
    setSearch({ code: code() });
  };
  const enrollmentUrl = createMemo(
    () => `${globalThis.location?.origin ?? ""}/enroll/${params.id}`,
  );

  return (
    <main class="min-h-svh bg-stone-950 px-4 py-10 text-stone-950">
      <Title>Enroll in Mattrax</Title>
      <Meta name="robots" content="noindex" />
      <div class="mx-auto flex min-h-[calc(100svh-5rem)] max-w-md items-center">
        <Card class="w-full bg-white">
          <CardHeader class="text-center">
            <CardTitle>Enroll in Mattrax</CardTitle>
            <CardDescription>
              <Show when={enrollment.data} fallback="Verifying enrollment link...">
                {(data) => (
                  <>
                    Enroll a device into{" "}
                    <span class="font-medium text-stone-900">{data().name}</span>.
                  </>
                )}
              </Show>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Show when={enrollment.isError}>
              <div class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                This enrollment link is invalid or unavailable. Contact your administrator.
              </div>
            </Show>

            <Show when={enrollment.data?.authenticated === false}>
              <form class="space-y-3" onSubmit={submitCode}>
                <p class="text-sm text-muted-foreground">
                  Your administrator has set an enrollment password.
                </p>
                <Input
                  value={code()}
                  onInput={(event) => setCode(event.currentTarget.value)}
                  placeholder="Enrollment password"
                  autofocus
                />
                <Button type="submit" class="w-full">
                  Continue
                </Button>
                <Show when={searchCode()}>
                  <p class="text-center text-sm text-red-600">
                    The enrollment password is invalid.
                  </p>
                </Show>
              </form>
            </Show>

            <Show when={enrollment.data?.authenticated === true}>
              <EnrollmentOptions
                enrollment={enrollment.data as Extract<EnrollmentResponse, { authenticated: true }>}
                id={params.id}
                code={searchCode() ?? ""}
              />
              <div class="mt-6 flex flex-col items-center gap-2 border-t pt-5">
                <p class="text-sm font-medium text-stone-800">Scan to open this page</p>
                <QrCode value={enrollmentUrl()} label="QR code for this enrollment link" />
                <p class="max-w-xs text-center text-xs text-muted-foreground">
                  This QR code contains the enrollment link only.
                  <Show when={searchCode()}> It does not include the enrollment password.</Show>
                </p>
              </div>
            </Show>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

type Platform = "apple" | "windows" | "android";

const isAvailable = (value: PlatformEnrollment | WindowsEnrollment) =>
  value === "available" ||
  (typeof value === "object" && ("profile" in value || "discoveryUrl" in value));

function EnrollmentOptions(props: {
  id: string | undefined;
  code: string;
  enrollment: Extract<EnrollmentResponse, { authenticated: true }>;
}) {
  // Always show every platform tab so an administrator can explain why a
  // platform is unavailable (the payload carries the backend error).
  const platforms = (): Platform[] => ["apple", "windows", "android"];
  const firstAvailable = () =>
    (
      [
        ["apple", props.enrollment.apple],
        ["windows", props.enrollment.windows],
        ["android", props.enrollment.android],
      ] as const
    ).find(([, value]) => isAvailable(value))?.[0] ?? "apple";
  const [tab, setTab] = createSignal<Platform>(firstAvailable());
  const active = () => tab();
  return (
    <div class="space-y-4">
      <div class="flex justify-center gap-1 rounded-lg bg-stone-100 p-1">
        <For each={platforms()}>
          {(platform) => (
            <TabButton active={active() === platform} onClick={() => setTab(platform)}>
              {platform === "apple" ? "Apple" : platform === "windows" ? "Windows" : "Android"}
            </TabButton>
          )}
        </For>
      </div>
      <Switch>
        <Match when={active() === "apple"}>
          <ApplePane apple={props.enrollment.apple} id={props.id} code={props.code} />
        </Match>
        <Match when={active() === "windows"}>
          <WindowsPane windows={props.enrollment.windows} />
        </Match>
        <Match when={active() === "android"}>
          <AndroidPane id={props.id} android={props.enrollment.android} />
        </Match>
      </Switch>
    </div>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={
        props.active
          ? "rounded-md bg-white px-3 py-2 text-sm font-medium shadow-sm"
          : "rounded-md px-3 py-2 text-sm text-stone-600"
      }
    >
      {props.children}
    </button>
  );
}

function ApplePane(props: { apple: PlatformEnrollment; id: string | undefined; code: string }) {
  if (typeof props.apple === "object" && "error" in props.apple)
    return <p class="text-center text-sm text-red-600">{props.apple.error}</p>;
  if (typeof props.apple !== "object" || !("profile" in props.apple))
    return (
      <p class="text-center text-sm text-muted-foreground">Apple enrollment is unavailable.</p>
    );
  const downloadUrl = createMemo(() => {
    const base = `/api/v1/enrollment/${encodeURIComponent(props.id ?? "")}/apple.mobileconfig`;
    return props.code ? `${base}?code=${encodeURIComponent(props.code)}` : base;
  });
  return (
    <div class="space-y-4">
      <Button as="a" href={downloadUrl()} class="w-full">
        Install Apple profile
      </Button>
      <p class="text-center text-xs text-muted-foreground">
        Opens the signed `.mobileconfig`. On iPhone or iPad, tap the download, then install it from
        Settings &gt; General &gt; VPN &amp; Device Management.
      </p>
      <ol class="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Install the enrollment profile.</li>
        <li>Wait for the device to check in with Mattrax.</li>
        <li>Return here and follow the setup steps for your platform.</li>
      </ol>
      <p class="text-center text-xs text-muted-foreground">
        On macOS, open the file from Downloads. If your browser blocks the download, copy this link
        into Safari: <span class="break-all font-mono">{downloadUrl()}</span>
      </p>
    </div>
  );
}

function WindowsPane(props: { windows: WindowsEnrollment }) {
  if (typeof props.windows === "object" && "error" in props.windows)
    return <p class="text-center text-sm text-red-600">{props.windows.error}</p>;
  if (typeof props.windows !== "object" || !("discoveryUrl" in props.windows))
    return (
      <p class="text-center text-sm text-muted-foreground">Windows enrollment is unavailable.</p>
    );
  const url = props.windows.discoveryUrl;
  const [copied, setCopied] = createSignal(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the input is selectable as a fallback.
    }
  };
  return (
    <div class="space-y-3">
      <p class="text-sm text-muted-foreground">
        Add this discovery URL to your Windows provisioning package or Autopilot profile.
      </p>
      <div class="flex gap-2">
        <Input readonly value={url} onClick={(event) => event.currentTarget.select()} />
        <Button variant="outline" onClick={copy}>
          {copied() ? "Copied" : "Copy"}
        </Button>
      </div>
      <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        Windows discovery is deployment-wide: the request carries no tenant identity, so this
        deployment must pin Windows enrollment to a single tenant. Per-tenant Windows routing is not
        supported yet.
      </p>
      <p class="text-sm text-muted-foreground">
        On the device, open Settings &gt; Accounts &gt; Access work or school &gt; Connect and use
        the URL above.
      </p>
    </div>
  );
}

function AndroidPane(props: { id: string | undefined; android: PlatformEnrollment }) {
  if (typeof props.android === "object" && "error" in props.android)
    return <p class="text-center text-sm text-red-600">{props.android.error}</p>;
  return (
    <div class="space-y-3 text-center text-sm text-muted-foreground">
      <p>
        Android enrollment isn't available yet. Ask your administrator for an Apple or Windows
        device.
      </p>
    </div>
  );
}
