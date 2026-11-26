import { Schema } from "effect";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import type { JSX } from "@solidjs/web";
import { getRequestEvent, isServer } from "@solidjs/web";
import QrCode from "~/components/mdm/qr-code";
import { Button } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";
import {
  ChevronRight,
  CircleAlert,
  CheckCircle2,
  Info,
  Monitor,
  Smartphone,
  TabletSmartphone,
} from "~/components/ui/icons";
import type {
  AndroidEnrollment,
  EnrollmentResponse,
  PlatformEnrollment,
  WindowsEnrollment,
} from "~/lib/enterprise";
import {
  ENROLLMENT_PLATFORMS,
  ENROLLMENT_PLATFORM_ATTRIBUTE,
  ENROLLMENT_PLATFORM_PAGE_ATTRIBUTE,
  resolveInitialEnrollmentPlatform,
} from "~/lib/enrollment-platform";
import type { EnrollmentPlatform } from "~/lib/enrollment-platform";
import {
  accessibleBrandForeground,
  AndroidReady,
  AppleReady,
  enrollmentPlatformAvailable,
  enrollmentPlatformLabel,
  enrollmentPlatformUnavailableCopy,
  formatEnrollmentDate,
  WindowsReady,
} from "~/lib/enrollment-presentation";
import { EnrollmentNotice, EnrollmentStatus, EnrollmentSteps } from "./enrollment-feedback";

type AuthenticatedEnrollment = Extract<EnrollmentResponse, { authenticated: true }>;
type PlatformValue = PlatformEnrollment | WindowsEnrollment | AndroidEnrollment;

export default function EnrollmentOptions(props: {
  id: string | undefined;
  code: string;
  brandColor: string;
  supportEmail: string;
  enrollment: AuthenticatedEnrollment;
}) {
  // Every platform stays reachable so the page can explain why it is not ready.
  const platforms = (): EnrollmentPlatform[] => [...ENROLLMENT_PLATFORMS];
  const valueFor = (platform: EnrollmentPlatform): PlatformValue =>
    platform === "apple"
      ? props.enrollment.apple
      : platform === "windows"
        ? props.enrollment.windows
        : props.enrollment.android;

  const firstAvailable = () =>
    platforms().find((platform) => enrollmentPlatformAvailable(platform, valueFor(platform))) ??
    "apple";

  // The server resolves the tab from the request's user agent and writes it
  // onto the tab list. During hydration the client reads that marker rather
  // than asking a user agent that might disagree; only a client-side navigation
  // (no server marker) falls back to navigator.userAgent.
  const initial = (() => {
    const fallback = firstAvailable();

    if (isServer)
      return resolveInitialEnrollmentPlatform({
        userAgent: getRequestEvent()?.request.headers.get("user-agent"),
        fallback,
      });

    const marker = document
      .querySelector(
        "[" +
          ENROLLMENT_PLATFORM_ATTRIBUTE +
          "][" +
          ENROLLMENT_PLATFORM_PAGE_ATTRIBUTE +
          '="' +
          CSS.escape(props.id ?? "") +
          '"]',
      )
      ?.getAttribute(ENROLLMENT_PLATFORM_ATTRIBUTE);

    return resolveInitialEnrollmentPlatform({
      marker,
      userAgent: navigator.userAgent,
      fallback,
    });
  })();

  const [tab, setTab] = createSignal<EnrollmentPlatform>(initial);
  const active = () => tab();
  const tabRefs = new Map<EnrollmentPlatform, HTMLButtonElement>();

  const selectTab = (next: EnrollmentPlatform) => {
    setTab(next);
    tabRefs.get(next)?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;

    const order = platforms();
    const current = order.indexOf(active());
    const last = order.length - 1;
    let next: EnrollmentPlatform | undefined;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = order[current === last ? 0 : current + 1];
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = order[current === 0 ? last : current - 1];
        break;
      case "Home":
        next = order[0];
        break;
      case "End":
        next = order[last];
        break;
      default:
        return;
    }

    event.preventDefault();
    selectTab(next);
  };

  return (
    <div>
      <div class="mb-5">
        <p class="label-caps">Choose your platform</p>
        <h2
          id="enrollment-platform-heading"
          tabindex={-1}
          class="mt-1 text-xl font-semibold text-foreground outline-none"
        >
          What are you setting up?
        </h2>
        <p class="mt-1 text-sm leading-6 text-muted-foreground">
          Select your device type and follow the steps. Unavailable platforms explain what to do
          next.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Enrollment platform"
        aria-orientation="horizontal"
        tabindex={-1}
        data-enrollment-platform={initial}
        data-enrollment-for={props.id}
        class="grid grid-cols-3 gap-1 rounded-xl border border-border bg-muted p-1"
        onKeyDown={handleTabKeyDown}
      >
        <For each={platforms()}>
          {(platform) => (
            <TabButton
              platform={platform}
              active={active() === platform}
              available={enrollmentPlatformAvailable(platform, valueFor(platform))}
              onSelect={() => selectTab(platform)}
              ref={(element) => tabRefs.set(platform, element)}
            />
          )}
        </For>
      </div>

      <TabPanel platform="apple" active={active() === "apple"}>
        <ApplePane
          apple={props.enrollment.apple}
          id={props.id}
          code={props.code}
          brandColor={props.brandColor}
          supportEmail={props.supportEmail}
        />
      </TabPanel>
      <TabPanel platform="windows" active={active() === "windows"}>
        <WindowsPane windows={props.enrollment.windows} supportEmail={props.supportEmail} />
      </TabPanel>
      <TabPanel platform="android" active={active() === "android"}>
        <AndroidPane android={props.enrollment.android} supportEmail={props.supportEmail} />
      </TabPanel>
    </div>
  );
}

function PlatformIcon(props: { platform: EnrollmentPlatform }) {
  return (
    <Switch>
      <Match when={props.platform === "apple"}>
        <TabletSmartphone class="size-5" aria-hidden="true" />
      </Match>
      <Match when={props.platform === "windows"}>
        <Monitor class="size-5" aria-hidden="true" />
      </Match>
      <Match when={props.platform === "android"}>
        <Smartphone class="size-5" aria-hidden="true" />
      </Match>
    </Switch>
  );
}

function TabPanel(props: { platform: EnrollmentPlatform; active: boolean; children: JSX.Element }) {
  return (
    <div
      role="tabpanel"
      id={"enrollment-panel-" + props.platform}
      aria-labelledby={"enrollment-tab-" + props.platform}
      hidden={!props.active}
      tabindex={props.active ? 0 : -1}
      class="mt-5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
    >
      {props.children}
    </div>
  );
}

function TabButton(props: {
  platform: EnrollmentPlatform;
  active: boolean;
  available: boolean;
  onSelect: () => void;
  ref?: (element: HTMLButtonElement) => void;
}) {
  const label = () => enrollmentPlatformLabel(props.platform);

  return (
    <Button
      ref={(element: HTMLButtonElement | HTMLAnchorElement) => props.ref?.(element as HTMLButtonElement)}
      type="button"
      role="tab"
      id={"enrollment-tab-" + props.platform}
      aria-label={label()}
      aria-selected={props.active ? "true" : "false"}
      aria-controls={"enrollment-panel-" + props.platform}
      aria-describedby={"enrollment-tab-" + props.platform + "-status"}
      tabindex={props.active ? 0 : -1}
      data-available={props.available ? "true" : "false"}
      onClick={props.onSelect}
      variant={props.active ? "outline" : "ghost"}
      class="min-h-14"
    >
      <span class="flex items-center gap-1.5">
        <PlatformIcon platform={props.platform} />
        {label()}
      </span>
      <span
        id={"enrollment-tab-" + props.platform + "-status"}
        class={
          "flex items-center gap-1 text-[10px] font-normal " +
          (props.active ? "text-muted-foreground" : "text-subtle-foreground")
        }
      >
        <Show
          when={props.available}
          fallback={<CircleAlert class="size-3" />}
        >
          <CheckCircle2 class="size-3" />
        </Show>
        {props.available ? "Ready" : "Unavailable"}
      </span>
    </Button>
  );
}

function UnavailablePlatform(props: {
  platform: EnrollmentPlatform;
  value: PlatformValue;
  supportEmail: string;
}) {
  const copy = () => enrollmentPlatformUnavailableCopy(props.platform, props.value);

  return (
    <div class="space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-semibold text-foreground">
          {enrollmentPlatformLabel(props.platform)} enrollment
        </h2>
        <EnrollmentStatus available={false} label={enrollmentPlatformLabel(props.platform)} />
      </div>
      <EnrollmentNotice
        tone={copy().tone}
        title={copy().title}
        message={copy().message}
        action={{ href: "mailto:" + props.supportEmail, label: "Contact administrator" }}
      />
      <p class="text-sm leading-6 text-muted-foreground">
        You do not need to erase or reset your device. Wait until your administrator confirms that
        enrollment is ready.
      </p>
    </div>
  );
}

function ApplePane(props: {
  apple: PlatformEnrollment;
  id: string | undefined;
  code: string;
  brandColor: string;
  supportEmail: string;
}) {
  if (!Schema.is(AppleReady)(props.apple))
    return (
      <UnavailablePlatform platform="apple" value={props.apple} supportEmail={props.supportEmail} />
    );

  const downloadUrl = () => {
    const base = "/api/v1/enrollment/" + encodeURIComponent(props.id ?? "") + "/apple.mobileconfig";

    return props.code ? base + "?code=" + encodeURIComponent(props.code) : base;
  };

  return (
    <div class="space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-semibold text-foreground">Enroll an Apple device</h2>
        <EnrollmentStatus available label="Apple" />
      </div>
      <p class="text-sm leading-6 text-muted-foreground">
        Install a signed enrollment profile. Your device will use it to register securely with your
        organization.
      </p>
      <Button
        as="a"
        href={downloadUrl()}
        class="min-h-12 w-full"
        style={{
          "--enroll-button-bg": props.brandColor,
          "--enroll-button-fg": accessibleBrandForeground(props.brandColor),
        }}
      >
        Install Apple profile
        <ChevronRight class="size-4" aria-hidden="true" />
      </Button>
      <EnrollmentSteps
        steps={[
          <>
            Tap <strong class="font-medium text-foreground">Install Apple profile</strong> and allow
            the download.
          </>,
          <>
            On iPhone or iPad, open <strong class="font-medium text-foreground">Settings</strong> →
            General → VPN &amp; Device Management, then install the downloaded profile.
          </>,
          <>Follow the prompts to finish. The device appears in Mattrax after it checks in.</>,
        ]}
      />
      <details class="rounded-xl border border-border bg-muted/30 px-4 py-3">
        <summary class="flex min-h-11 cursor-pointer items-center text-sm font-medium text-foreground">
          Using a Mac, or the profile did not open?
        </summary>
        <div class="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
          <p>On macOS, open the downloaded file from Downloads and double-click it.</p>
          <p>
            If your browser blocks the download, copy this link into Safari:
            <code class="mt-1 block break-all rounded-lg bg-card p-2 font-mono text-foreground">
              {downloadUrl()}
            </code>
          </p>
        </div>
      </details>
    </div>
  );
}

function WindowsPane(props: { windows: WindowsEnrollment; supportEmail: string }) {
  if (!Schema.is(WindowsReady)(props.windows))
    return (
      <UnavailablePlatform
        platform="windows"
        value={props.windows}
        supportEmail={props.supportEmail}
      />
    );

  const windows = props.windows as Extract<WindowsEnrollment, { discoveryUrl: string }>;
  const url = windows.discoveryUrl;
  const [copied, setCopied] = createSignal(false);
  const expiresAt = () => formatEnrollmentDate(windows.expiresAt);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the URL remains selectable as a fallback.
    }
  };

  const autopilot = windows.autopilot;

  return (
    <div class="space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-semibold text-foreground">Enroll a Windows device</h2>
        <EnrollmentStatus available label="Windows" />
      </div>
      <p class="text-sm leading-6 text-muted-foreground">
        Use this secure enrollment link on the Windows device you want to set up.
      </p>

      <div class="space-y-2">
        <div class="flex flex-col gap-2 sm:flex-row">
          <figure class="m-0 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-3">
            <figcaption id="windows-discovery-label" class="text-xs font-medium text-foreground">
              Windows enrollment link
            </figcaption>
            <code
              id="windows-discovery-url"
              class="mt-1 block break-all font-mono text-xs leading-5 text-foreground"
            >
              {url}
            </code>
          </figure>
          <Button
            variant="outline"
            aria-label="Copy Windows discovery URL"
            class="min-h-11 sm:w-auto"
            onClick={copy}
          >
            <span aria-live="polite">{copied() ? "Copied" : "Copy"}</span>
          </Button>
        </div>
        <p class="text-xs leading-5 text-muted-foreground">
          This link is scoped to your organization by a signed token.
          <Show when={expiresAt()}>{(value) => <> It expires {value()}.</>}</Show>
          {!expiresAt() ? " It expires after a short period." : ""} Reload this page to generate a
          fresh one.
        </p>
      </div>

      <EnrollmentSteps
        steps={[
          <>
            On the Windows device, open{" "}
            <strong class="font-medium text-foreground">Settings</strong> → Accounts → Access work
            or school → Connect.
          </>,
          <>Enter the enrollment link above and sign in with your work account.</>,
          <>Follow the setup prompts. The device appears in Mattrax shortly.</>,
        ]}
      />

      <Show when={autopilot?.configured}>
        <div class="rounded-xl border border-info/30 bg-info/10 p-4">
          <div class="flex items-start gap-3">
            <Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <p class="text-sm font-medium text-foreground">Autopilot is ready for this tenant</p>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">
                Your administrator can register the device hardware hash, assign an Autopilot
                deployment profile, and reset the device. Windows will use this enrollment endpoint
                during setup.
              </p>
              <Show when={autopilot?.federated}>
                <p class="mt-2 text-xs leading-5 text-muted-foreground">
                  Entra federated sign-in is enabled for realm{" "}
                  <span class="font-mono text-foreground">{autopilot?.realm}</span>.
                </p>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

function AndroidPane(props: { android: AndroidEnrollment; supportEmail: string }) {
  if (!Schema.is(AndroidReady)(props.android))
    return (
      <UnavailablePlatform
        platform="android"
        value={props.android}
        supportEmail={props.supportEmail}
      />
    );

  const [copied, setCopied] = createSignal(false);
  const android = props.android;
  const expiresAt = () => formatEnrollmentDate(android.expiresAt);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(android.enrollmentToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the input is selectable as a fallback.
    }
  };

  const provisioningDescription = () => {
    if (android.provisioningMode === "fully-managed")
      return "This enrollment creates a fully managed device. Use a company-owned device: Android removes personal accounts and the personal profile, and the device must be factory reset to enroll.";
    if (android.provisioningMode === "dedicated")
      return "This enrollment creates a dedicated device with no user account, for a kiosk or shared device.";

    return "This enrollment creates a work profile, so the person keeps their personal apps and data while Mattrax manages a separate work profile.";
  };

  return (
    <div class="space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-semibold text-foreground">Enroll an Android device</h2>
        <EnrollmentStatus available label="Android" />
      </div>
      <p class="text-sm leading-6 text-muted-foreground">{provisioningDescription()}</p>

      <Show when={android.qrCode}>
        {(qrCode) => (
          <div class="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/30 p-4">
            <QrCode value={qrCode()} label="Android enrollment QR code" size={196} />
            <p class="text-center text-xs leading-5 text-muted-foreground">
              Scan this code from the Android setup wizard.
            </p>
          </div>
        )}
      </Show>

      <Show when={!android.qrCode}>
        <EnrollmentNotice
          tone="info"
          title="Use the enrollment token below"
          message="A QR code is not available for this enrollment token. You can still finish setup by entering the token manually."
        />
      </Show>

      <div class="space-y-2">
        <Label for="android-enrollment-token">Enrollment token</Label>
        <div class="flex flex-col gap-2 sm:flex-row">
          <Input
            id="android-enrollment-token"
            readonly
            value={android.enrollmentToken}
            onClick={(event) => event.currentTarget.select()}
          />
          <Button
            variant="outline"
            aria-label="Copy Android enrollment token"
            class="min-h-11 sm:w-auto"
            onClick={copy}
          >
            <span aria-live="polite">{copied() ? "Copied" : "Copy"}</span>
          </Button>
        </div>
        <Show when={expiresAt()}>
          {(value) => <p class="text-xs text-muted-foreground">This token expires {value()}.</p>}
        </Show>
      </div>

      <EnrollmentSteps
        steps={[
          <>Turn on a new or factory-reset Android device and connect it to Wi-Fi.</>,
          android.provisioningMode === "fully-managed" ? (
            <>Choose to set the device up as a company-owned device, then scan the QR code.</>
          ) : android.provisioningMode === "dedicated" ? (
            <>Choose to set up this device for work, then scan the QR code.</>
          ) : (
            <>On the welcome screen, tap six times to open the QR scanner and scan the code.</>
          ),
          <>Follow the prompts to finish provisioning. The device appears in Mattrax shortly.</>,
        ]}
      />

      <details class="rounded-xl border border-border bg-muted/30 px-4 py-3">
        <summary class="flex min-h-11 cursor-pointer items-center text-sm font-medium text-foreground">
          Can't scan the QR code?
        </summary>
        <div class="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
          <p>
            Choose to sign in with a Google account, enter{" "}
            <code class="rounded bg-card px-1 py-0.5 font-mono text-foreground">afw#setup</code>,
            then enter the enrollment token above.
          </p>
          <Show when={android.policyName}>
            {(policyName) => <p>Work policy: {policyName()}.</p>}
          </Show>
        </div>
      </details>
    </div>
  );
}
