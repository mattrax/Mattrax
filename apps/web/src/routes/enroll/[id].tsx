import { Meta, Title } from "@solidjs/meta";
import { query, type RouteProps } from "@solidjs/router";
import { defineFileRoute } from "@solidjs/router/fs";
import { DEFAULT_BRAND_COLOR, DEFAULT_SUPPORT_EMAIL } from "@mattrax/enterprise-domain/client";
import { Match as EffectMatch, Schema } from "effect";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import type { JSX } from "@solidjs/web";
import { getRequestEvent, isServer } from "@solidjs/web";
import { QrCode } from "~/components/mdm/qr-code";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { PasswordInput } from "~/components/ui/password-input";
import { Label } from "~/components/ui/label";
import {
  type AndroidEnrollment,
  type EnrollmentResponse,
  type PlatformEnrollment,
  type WindowsEnrollment,
} from "~/lib/enterprise";
import { lookupPublicEnrollment } from "~/lib/enrollment.server";
import { DEVICE_LIMIT_REACHED_TITLE, deviceLimitReachedMessage } from "~/lib/plan-limits";

const isAuthenticatedEnrollment = (
  value: EnrollmentResponse | undefined,
): value is Extract<EnrollmentResponse, { authenticated: true }> => value?.authenticated === true;

const AppleReady = Schema.Struct({ profile: Schema.String });

const WindowsReady = Schema.Struct({ discoveryUrl: Schema.String });

const AndroidReady = Schema.Struct({
  qrCode: Schema.optional(Schema.NullOr(Schema.String)),
  enrollmentToken: Schema.String,
  policyName: Schema.optional(Schema.NullOr(Schema.String)),
  expiresAt: Schema.optional(Schema.NullOr(Schema.String)),
});

const ErrorEnrollment = Schema.Struct({ error: Schema.String });

const codeFromQuery = (query: Record<string, string | string[] | undefined>) => {
  const value = query.code;

  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
};

const getEnrollment = query(lookupPublicEnrollment, "public-enrollment");

/**
 * Warm the enrollment lookup before render. The component reads the same
 * query with `deferStream`, so the first HTML response already contains the
 * password form or the platform instructions; JavaScript only enhances it.
 */
export const route = defineFileRoute("/enroll/:id", {
  preload: ({ params, location }) => getEnrollment(params.id, codeFromQuery(location.query)),
});

function EnrollPage(props: { id: string; code: string }) {
  const enrollment = createMemo(() => getEnrollment(props.id, props.code), {
    deferStream: true,
  });

  const data = () => enrollment();

  const found = () => {
    const value = data();

    return value.status === "found" ? value.enrollment : undefined;
  };

  const enrollmentUrl = createMemo(() => {
    const path = `/enroll/${encodeURIComponent(props.id)}`;

    if (isServer) {
      const request = getRequestEvent()?.request;

      return request ? new URL(path, request.url).toString() : path;
    }

    return `${window.location.origin}${path}`;
  });

  const branding = () => found()?.branding;

  const authenticated = () => {
    const value = found();

    return isAuthenticatedEnrollment(value) ? value : undefined;
  };

  const brandName = () => branding()?.displayName ?? "Mattrax";
  const brandColor = () => branding()?.brandColor ?? DEFAULT_BRAND_COLOR;
  const supportEmail = () => branding()?.supportEmail ?? DEFAULT_SUPPORT_EMAIL;

  const deviceLimit = () => {
    const value = found();

    return value?.authenticated === true ? value.deviceLimit : undefined;
  };

  return (
    <main
      class="min-h-svh bg-stone-950 px-4 py-10 text-stone-950"
      style={{ "color-scheme": "light" }}
    >
      <Title>Enroll in {brandName()}</Title>
      <Meta name="robots" content="noindex" />
      <div class="mx-auto flex min-h-[calc(100svh-5rem)] max-w-md items-center">
        <Card class="theme-light w-full overflow-hidden bg-background">
          <div class="h-1.5" style={{ "background-color": brandColor() }} />
          <CardHeader class="text-center">
            <Show when={branding()?.logo}>
              {(logo) => (
                <img
                  src={logo()}
                  alt=""
                  width="922"
                  height="142"
                  class="mx-auto mb-2 h-12 w-auto max-w-[12rem] object-contain"
                />
              )}
            </Show>
            <CardTitle>
              <h1>Enroll in {brandName()}</h1>
            </CardTitle>
            <CardDescription>Choose how to enroll this device.</CardDescription>
          </CardHeader>
          <CardContent>
            <Show when={data().status === "invalid"}>
              <div
                role="alert"
                class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              >
                This enrollment link is invalid or unavailable. Contact your administrator.
              </div>
            </Show>

            <Show when={data().status === "unavailable"}>
              <div
                role="alert"
                class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              >
                Enrollment is temporarily unavailable. Check your connection and try again.
              </div>
            </Show>

            <Show when={found()?.authenticated === false}>
              <form
                class="space-y-3"
                method="get"
                action={`/enroll/${encodeURIComponent(props.id)}`}
              >
                <p class="text-sm text-muted-foreground">
                  Your administrator has set an enrollment password.
                </p>
                <div class="space-y-1.5">
                  <Label for="enrollment-password" class="text-sm text-stone-700">
                    Enrollment password
                  </Label>
                  <PasswordInput
                    id="enrollment-password"
                    name="code"
                    autocomplete="off"
                    aria-invalid={props.code ? "true" : undefined}
                    aria-describedby={
                      props.code
                        ? "enrollment-password-hint enrollment-password-error"
                        : "enrollment-password-hint"
                    }
                    autofocus
                  />
                  <p id="enrollment-password-hint" class="text-xs text-muted-foreground">
                    Enter the password provided by your administrator.
                  </p>
                </div>
                <Button type="submit" class="w-full">
                  Continue
                </Button>
                <Show when={props.code}>
                  <p
                    id="enrollment-password-error"
                    role="alert"
                    class="text-center text-sm text-red-600"
                  >
                    The enrollment password is invalid.
                  </p>
                </Show>
              </form>
            </Show>

            <Show when={authenticated()}>
              {(authenticatedEnrollment) => (
                <>
                  <Show when={deviceLimit()}>
                    {(deviceLimit) => (
                      <Show when={deviceLimit().reached}>
                        <div
                          role="alert"
                          class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                        >
                          <p class="font-medium">{DEVICE_LIMIT_REACHED_TITLE}</p>
                          <p class="mt-1">{deviceLimitReachedMessage(deviceLimit().limit)}</p>
                        </div>
                      </Show>
                    )}
                  </Show>
                  <EnrollmentOptions
                    enrollment={authenticatedEnrollment()}
                    id={props.id}
                    code={props.code}
                    brandColor={brandColor()}
                  />
                  <div class="mt-6 flex flex-col items-center gap-2 border-t pt-5">
                    <p class="text-sm font-medium text-stone-800">Scan to open this page</p>
                    <QrCode value={enrollmentUrl()} label="QR code for this enrollment link" />
                    <p class="max-w-xs text-center text-xs text-muted-foreground">
                      This QR code contains the enrollment link only.
                      <Show when={props.code}> It does not include the enrollment password.</Show>
                    </p>
                  </div>
                </>
              )}
            </Show>

            <div class="mt-5 border-t pt-4 text-center text-xs text-muted-foreground">
              Need help?{" "}
              <a
                class="font-medium text-stone-600 underline decoration-stone-400 underline-offset-2 hover:text-stone-900"
                href={`mailto:${supportEmail()}`}
              >
                Contact {supportEmail()}
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

type Platform = "apple" | "windows" | "android";

const isAvailable = (value: PlatformEnrollment | WindowsEnrollment | AndroidEnrollment) =>
  value === "available" ||
  Schema.is(AppleReady)(value) ||
  Schema.is(WindowsReady)(value) ||
  Schema.is(AndroidReady)(value);

function EnrollmentOptions(props: {
  id: string | undefined;
  code: string;
  brandColor: string;
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

  const tabRefs = new Map<Platform, HTMLButtonElement>();

  const selectTab = (next: Platform) => {
    setTab(next);
    tabRefs.get(next)?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    const order = platforms();
    const current = order.indexOf(active());
    const last = order.length - 1;

    const next = EffectMatch.value(event.key).pipe(
      EffectMatch.when("ArrowRight", () => order[current === last ? 0 : current + 1]),
      EffectMatch.when("ArrowDown", () => order[current === last ? 0 : current + 1]),
      EffectMatch.when("ArrowLeft", () => order[current === 0 ? last : current - 1]),
      EffectMatch.when("ArrowUp", () => order[current === 0 ? last : current - 1]),
      EffectMatch.when("Home", () => order[0]),
      EffectMatch.when("End", () => order[last]),
      EffectMatch.orElse(() => undefined),
    );

    if (!next) return;
    event.preventDefault();
    selectTab(next);
  };

  return (
    <div class="space-y-4">
      <div
        role="tablist"
        aria-label="Enrollment platform"
        tabindex={-1}
        class="flex justify-center gap-1 rounded-lg bg-stone-100 p-1"
        onKeyDown={handleTabKeyDown}
      >
        <For each={platforms()}>
          {(platform) => (
            <TabButton
              platform={platform}
              active={active() === platform}
              onSelect={() => selectTab(platform)}
              ref={(element) => tabRefs.set(platform, element)}
            >
              {EffectMatch.value(platform).pipe(
                EffectMatch.when("apple", () => "Apple"),
                EffectMatch.when("windows", () => "Windows"),
                EffectMatch.orElse(() => "Android"),
              )}
            </TabButton>
          )}
        </For>
      </div>
      <Switch>
        <Match when={active() === "apple"}>
          <TabPanel platform="apple">
            <ApplePane
              apple={props.enrollment.apple}
              id={props.id}
              code={props.code}
              brandColor={props.brandColor}
            />
          </TabPanel>
        </Match>
        <Match when={active() === "windows"}>
          <TabPanel platform="windows">
            <WindowsPane windows={props.enrollment.windows} />
          </TabPanel>
        </Match>
        <Match when={active() === "android"}>
          <TabPanel platform="android">
            <AndroidPane id={props.id} android={props.enrollment.android} />
          </TabPanel>
        </Match>
      </Switch>
    </div>
  );
}

function TabPanel(props: { platform: Platform; children: JSX.Element }) {
  return (
    <div
      role="tabpanel"
      id={`enrollment-panel-${props.platform}`}
      aria-labelledby={`enrollment-tab-${props.platform}`}
      tabindex={0}
      class="outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
    >
      {props.children}
    </div>
  );
}

function TabButton(props: {
  platform: Platform;
  active: boolean;
  onSelect: () => void;
  ref?: (element: HTMLButtonElement) => void;
  children: string;
}) {
  return (
    <button
      ref={props.ref}
      type="button"
      role="tab"
      id={`enrollment-tab-${props.platform}`}
      aria-selected={props.active ? "true" : "false"}
      aria-controls={props.active ? `enrollment-panel-${props.platform}` : undefined}
      tabindex={props.active ? 0 : -1}
      onClick={props.onSelect}
      class={
        props.active
          ? "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm"
          : "rounded-md px-3 py-2 text-sm text-stone-600 hover:bg-stone-100 hover:text-stone-900"
      }
    >
      {props.children}
    </button>
  );
}

function ApplePane(props: {
  apple: PlatformEnrollment;
  id: string | undefined;
  code: string;
  brandColor: string;
}) {
  if (Schema.is(ErrorEnrollment)(props.apple))
    return <p class="text-center text-sm text-red-600">{props.apple.error}</p>;

  if (!Schema.is(AppleReady)(props.apple))
    return (
      <p class="text-center text-sm text-muted-foreground">Apple enrollment is unavailable.</p>
    );

  const downloadUrl = createMemo(() => {
    const base = `/api/v1/enrollment/${encodeURIComponent(props.id ?? "")}/apple.mobileconfig`;

    return props.code ? `${base}?code=${encodeURIComponent(props.code)}` : base;
  });

  return (
    <div class="space-y-4">
      <Button
        as="a"
        href={downloadUrl()}
        class="w-full text-brand-foreground"
        style={{ "background-color": props.brandColor }}
      >
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
  if (Schema.is(ErrorEnrollment)(props.windows))
    return <p class="text-center text-sm text-red-600">{props.windows.error}</p>;

  if (!Schema.is(WindowsReady)(props.windows))
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

  const autopilot = props.windows.autopilot;

  return (
    <div class="space-y-3">
      <p class="text-sm text-muted-foreground">
        Add this discovery URL to your Windows provisioning package or Autopilot profile.
      </p>
      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2">
          <Label for="windows-discovery-url" class="sr-only">
            Windows discovery URL
          </Label>
          <code
            id="windows-discovery-url"
            class="block break-all font-mono text-[11px] leading-5 text-stone-700"
          >
            {url}
          </code>
        </div>
        <Button variant="outline" aria-label="Copy Windows discovery URL" onClick={copy}>
          {copied() ? "Copied" : "Copy"}
        </Button>
      </div>
      <p class="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
        This link is scoped to this tenant by a signed token. It expires
        {props.windows.expiresAt
          ? ` on ${new Date(props.windows.expiresAt).toLocaleString()}`
          : " after a short period"}
        ; reload this page to generate a fresh one.
      </p>
      <Show when={autopilot?.configured}>
        <div class="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
          <p class="font-medium">Autopilot is configured for this tenant</p>
          <p class="mt-1">
            Register the device hardware hash in Settings → Management, assign an Autopilot
            deployment profile, then reset the device. Autopilot will use this tenant's enrollment
            endpoint during OOBE.
          </p>
          <Show when={autopilot?.federated}>
            <p class="mt-1">
              Entra federated sign-in is enabled for realm{" "}
              <span class="font-mono">{autopilot?.realm}</span>. The device must obtain an Entra
              token for this tenant; Mattrax validates its issuer, audience, tenant and signature
              before issuing an MDM certificate.
            </p>
          </Show>
        </div>
      </Show>
      <p class="text-sm text-muted-foreground">
        On the device, open Settings &gt; Accounts &gt; Access work or school &gt; Connect and use
        the URL above. Reopen this page if the device reports that the enrollment link has expired.
      </p>
    </div>
  );
}

function AndroidPane(props: { id: string | undefined; android: AndroidEnrollment }) {
  if (Schema.is(ErrorEnrollment)(props.android))
    return <p class="text-center text-sm text-red-600">{props.android.error}</p>;

  if (!Schema.is(AndroidReady)(props.android))
    return (
      <div class="space-y-3 text-center text-sm text-muted-foreground">
        <p>
          Android enrollment is not connected yet. Ask your administrator to connect Android
          Enterprise before enrolling this device.
        </p>
      </div>
    );
  const [copied, setCopied] = createSignal(false);
  const android = props.android;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(android.enrollmentToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the input is selectable as a fallback.
    }
  };

  return (
    <div class="space-y-4">
      <Show when={android.qrCode}>
        {(qrCode) => (
          <div class="flex flex-col items-center gap-2">
            <QrCode value={qrCode()} label="Android enrollment QR code" />
            <p class="text-center text-xs text-muted-foreground">
              Scan this code from the Android setup wizard.
            </p>
          </div>
        )}
      </Show>
      <div class="space-y-2">
        <Label for="android-enrollment-token" class="text-sm font-medium text-stone-800">
          Enrollment token
        </Label>
        <div class="flex gap-2">
          <Input
            id="android-enrollment-token"
            readonly
            value={android.enrollmentToken}
            onClick={(event) => event.currentTarget.select()}
          />
          <Button variant="outline" aria-label="Copy Android enrollment token" onClick={copy}>
            {copied() ? "Copied" : "Copy"}
          </Button>
        </div>
        <Show when={android.expiresAt}>
          {(expiresAt) => (
            <p class="text-xs text-muted-foreground">
              This token expires {new Date(expiresAt()).toLocaleString()}.
            </p>
          )}
        </Show>
      </div>
      <ol class="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Turn on a new or factory-reset Android device and connect it to Wi-Fi.</li>
        <li>
          On the welcome screen, tap six times to open the QR scanner and scan the code above.
        </li>
        <li>
          If you cannot scan, choose to sign in with a Google account, enter{" "}
          <span class="font-mono">afw#setup</span>, then enter the enrollment token.
        </li>
        <li>Follow the prompts to finish provisioning. The device appears in Mattrax shortly.</li>
      </ol>
    </div>
  );
}

export default function EnrollRoute(props: RouteProps<typeof route>) {
  return <EnrollPage id={props.params.id ?? ""} code={codeFromQuery(props.location.query)} />;
}
