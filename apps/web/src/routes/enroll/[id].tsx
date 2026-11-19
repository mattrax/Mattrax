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
import {
  ENROLLMENT_PLATFORMS,
  ENROLLMENT_PLATFORM_ATTRIBUTE,
  ENROLLMENT_PLATFORM_PAGE_ATTRIBUTE,
  resolveInitialEnrollmentPlatform,
  type EnrollmentPlatform,
} from "~/lib/enrollment-platform";
import { lookupPublicEnrollment, submitPublicEnrollmentAnswers } from "~/lib/enrollment.server";
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
  provisioningMode: Schema.Literals(["work-profile", "fully-managed", "dedicated"]),
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

  const reloadHref = () => {
    const base = `/enroll/${encodeURIComponent(props.id)}`;

    return props.code ? `${base}?code=${encodeURIComponent(props.code)}` : base;
  };

  const cardDescription = () => {
    const status = data().status;

    if (status === "found") return "Choose how to enroll this device.";

    return linkProblemCopy(status).description;
  };

  const branding = () => found()?.branding;

  const authenticated = () => {
    const value = found();

    return isAuthenticatedEnrollment(value) ? value : undefined;
  };

  const brandName = () => branding()?.displayName ?? "Mattrax";
  const brandColor = () => branding()?.brandColor ?? DEFAULT_BRAND_COLOR;
  const supportEmail = () => branding()?.supportEmail ?? DEFAULT_SUPPORT_EMAIL;

  const [detailsSaved, setDetailsSaved] = createSignal(false);

  const needsDetails = () => {
    const value = authenticated();

    return value ? (value.questions?.length ?? 0) > 0 || value.assetTag : false;
  };

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
            <CardDescription>{cardDescription()}</CardDescription>
          </CardHeader>
          <CardContent>
            <Show when={data().status === "expired"}>
              <EnrollmentLinkProblem
                status="expired"
                reloadHref={reloadHref()}
                supportEmail={supportEmail()}
              />
            </Show>

            <Show when={data().status === "invalid"}>
              <EnrollmentLinkProblem
                status="invalid"
                reloadHref={reloadHref()}
                supportEmail={supportEmail()}
              />
            </Show>

            <Show when={data().status === "unavailable"}>
              <EnrollmentLinkProblem
                status="unavailable"
                reloadHref={reloadHref()}
                supportEmail={supportEmail()}
              />
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
                  <Show
                    when={!needsDetails() || detailsSaved()}
                    fallback={
                      <EnrollmentDetails
                        enrollment={authenticatedEnrollment()}
                        id={props.id}
                        code={props.code}
                        onSaved={() => setDetailsSaved(true)}
                      />
                    }
                  >
                    <EnrollmentOptions
                      enrollment={authenticatedEnrollment()}
                      id={props.id}
                      code={props.code}
                      brandColor={brandColor()}
                    />
                  </Show>
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

const attributeInputType = (type: string): "text" | "number" | "date" => {
  if (type === "number") return "number";

  if (type === "date") return "date";

  return "text";
};

type EnrollmentLinkProblemStatus = "expired" | "invalid" | "unavailable";

const linkProblemCopy = (status: EnrollmentLinkProblemStatus) => {
  if (status === "unavailable")
    return {
      description: "Enrollment is temporarily unavailable.",
      title: "Try again in a moment",
      message:
        "Check your connection, then reload this page. Your administrator can confirm the link still works.",
      action: "reload" as const,
    };

  if (status === "expired")
    return {
      description: "This enrollment link has expired.",
      title: "Ask your administrator for a new link",
      message:
        "Expired links cannot be used to enroll. Request a fresh link, then open it on this device.",
      action: "contact" as const,
    };

  return {
    description: "This enrollment link is no longer valid.",
    title: "Ask your administrator for a new link",
    message: "It may have been reset or replaced. Open the current link on this device.",
    action: "contact" as const,
  };
};

function EnrollmentLinkProblem(props: {
  status: EnrollmentLinkProblemStatus;
  reloadHref: string;
  supportEmail: string;
}) {
  const copy = () => linkProblemCopy(props.status);

  return (
    <div
      role="alert"
      class="space-y-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
    >
      <div>
        <p class="font-medium">{copy().title}</p>
        <p class="mt-1 text-xs leading-relaxed">{copy().message}</p>
      </div>
      <Show
        when={copy().action === "reload"}
        fallback={
          <Button
            as="a"
            href={`mailto:${props.supportEmail}`}
            variant="outline"
            size="sm"
            class="w-full"
          >
            Contact administrator
          </Button>
        }
      >
        <Button as="a" href={props.reloadHref} variant="outline" size="sm" class="w-full">
          Reload page
        </Button>
      </Show>
    </div>
  );
}

const attributeOptionLabel = (type: string, option: string) => {
  if (type !== "boolean") return option;

  return option === "true" ? "Yes" : "No";
};

/**
 * Device details collected before enrollment.
 *
 * Apple and Windows do not identify a device until its first MDM check-in, so
 * the serial is the link: answers are stored against it and claimed by the
 * device when it appears. Questions are validated by the API exactly as the
 * dashboard validates device values.
 */
function EnrollmentDetails(props: {
  id: string | undefined;
  code: string;
  enrollment: Extract<EnrollmentResponse, { authenticated: true }>;
  onSaved: () => void;
}) {
  const questions = () => props.enrollment.questions ?? [];
  const [serial, setSerial] = createSignal("");
  const [name, setName] = createSignal("");
  const [assetTag, setAssetTag] = createSignal("");
  const [answers, setAnswers] = createSignal<Record<string, string>>({});
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  const setAnswer = (key: string, value: string) => setAnswers({ ...answers(), [key]: value });

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();

    if (!props.id) {
      setError("This enrollment link is invalid.");

      return;
    }

    if (!serial().trim()) {
      setError("Enter this device's serial number.");

      return;
    }

    for (const question of questions()) {
      const value = (answers()[question.key] ?? "").trim();

      if (question.required && !value) {
        setError(`${question.label} is required.`);

        return;
      }
    }

    setSaving(true);
    setError(null);

    const result = await submitPublicEnrollmentAnswers(props.id, {
      code: props.code || undefined,
      serial: serial().trim(),
      name: name().trim() || undefined,
      assetTag: assetTag().trim() || undefined,
      answers: answers(),
    });

    setSaving(false);

    if (!result.ok) {
      setError(result.message);

      return;
    }

    props.onSaved();
  };

  return (
    <form class="space-y-4" onSubmit={(event) => void submit(event)}>
      <div class="space-y-1">
        <h2 class="text-sm font-semibold text-stone-900">Device details</h2>
        <p class="text-xs text-muted-foreground">
          Your administrator asks for these details before enrollment. They are applied when this
          device checks in.
        </p>
      </div>
      <div class="space-y-1.5">
        <Label for="enrollment-serial" class="text-sm text-stone-700">
          Serial number
        </Label>
        <Input
          id="enrollment-serial"
          autocomplete="off"
          required
          value={serial()}
          onInput={(event) => setSerial(event.currentTarget.value)}
        />
      </div>
      <Show when={props.enrollment.assetTag}>
        <div class="space-y-1.5">
          <Label for="enrollment-name" class="text-sm text-stone-700">
            Device name <span class="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="enrollment-name"
            autocomplete="off"
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </div>
        <div class="space-y-1.5">
          <Label for="enrollment-asset-tag" class="text-sm text-stone-700">
            Asset tag <span class="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="enrollment-asset-tag"
            autocomplete="off"
            value={assetTag()}
            onInput={(event) => setAssetTag(event.currentTarget.value)}
          />
        </div>
      </Show>
      <For each={questions()}>
        {(question) => (
          <div class="space-y-1.5">
            <Label for={`enrollment-question-${question.key}`} class="text-sm text-stone-700">
              {question.label}
              <Show when={question.required}>
                <span class="ml-1 text-red-600" aria-hidden="true">
                  *
                </span>
              </Show>
            </Label>
            <Show
              when={question.type === "select" || question.type === "boolean"}
              fallback={
                <Input
                  id={`enrollment-question-${question.key}`}
                  type={attributeInputType(question.type)}
                  required={question.required}
                  value={answers()[question.key] ?? ""}
                  onInput={(event) => setAnswer(question.key, event.currentTarget.value)}
                />
              }
            >
              <select
                id={`enrollment-question-${question.key}`}
                required={question.required}
                class="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={answers()[question.key] ?? ""}
                onChange={(event) => setAnswer(question.key, event.currentTarget.value)}
              >
                <option value="">Choose…</option>
                <For
                  each={question.type === "boolean" ? ["true", "false"] : (question.options ?? [])}
                >
                  {(option) => (
                    <option value={option}>{attributeOptionLabel(question.type, option)}</option>
                  )}
                </For>
              </select>
            </Show>
          </div>
        )}
      </For>
      <Show when={error()}>
        <p role="alert" class="text-sm text-red-600">
          {error()}
        </p>
      </Show>
      <Button type="submit" class="w-full" disabled={saving()}>
        {saving() ? "Saving…" : "Continue to enrollment"}
      </Button>
    </form>
  );
}

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
  const platforms = (): EnrollmentPlatform[] => [...ENROLLMENT_PLATFORMS];

  const firstAvailable = () =>
    (
      [
        ["apple", props.enrollment.apple],
        ["windows", props.enrollment.windows],
        ["android", props.enrollment.android],
      ] as const
    ).find(([, value]) => isAvailable(value))?.[0] ?? "apple";

  // The server resolves the tab from the request's user agent and writes it
  // onto the tab list. During hydration the client reads that marker rather
  // than asking a user agent that might disagree; only a client-side navigation
  // (no server marker) falls back to `navigator.userAgent`.
  const initial = (() => {
    const fallback = firstAvailable();

    if (isServer)
      return resolveInitialEnrollmentPlatform({
        userAgent: getRequestEvent()?.request.headers.get("user-agent"),
        fallback,
      });

    const marker = document
      .querySelector(
        `[${ENROLLMENT_PLATFORM_ATTRIBUTE}][${ENROLLMENT_PLATFORM_PAGE_ATTRIBUTE}="${CSS.escape(
          props.id ?? "",
        )}"]`,
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
        data-enrollment-platform={initial}
        data-enrollment-for={props.id}
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

function TabPanel(props: { platform: EnrollmentPlatform; children: JSX.Element }) {
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
  platform: EnrollmentPlatform;
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
      <p class="rounded-lg border border-border bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-600">
        {EffectMatch.value(android.provisioningMode).pipe(
          EffectMatch.when(
            "fully-managed",
            () =>
              "This enrollment creates a fully managed device. Use a company-owned device: Android removes personal accounts and the personal profile, and the device must be factory reset to enroll.",
          ),
          EffectMatch.when(
            "dedicated",
            () =>
              "This enrollment creates a dedicated device with no user account, for a kiosk or shared device.",
          ),
          EffectMatch.orElse(
            () =>
              "This enrollment creates a work profile, so the person keeps their personal apps and data while Mattrax manages a separate work profile.",
          ),
        )}
      </p>
      <ol class="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Turn on a new or factory-reset Android device and connect it to Wi-Fi.</li>
        {android.provisioningMode === "fully-managed" ? (
          <li>Choose to set the device up as a company-owned device when the wizard asks.</li>
        ) : (
          <li>
            On the welcome screen, tap six times to open the QR scanner and scan the code above.
          </li>
        )}
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
