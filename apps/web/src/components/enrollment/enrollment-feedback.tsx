import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import QrCode from "~/components/mdm/qr-code";
import { Button } from "~/components/ui/button";
import { CheckCircle2, CircleAlert, Info } from "~/components/ui/icons";
import { enrollmentLinkProblemCopy } from "~/lib/enrollment-presentation";
import type {
  EnrollmentLinkProblemStatus,
  EnrollmentNoticeTone,
} from "~/lib/enrollment-presentation";
import { DEVICE_LIMIT_REACHED_TITLE, deviceLimitReachedMessage } from "~/lib/plan-limits";

const noticeTone = {
  info: {
    container: "border-info/30 bg-info/10",
    icon: "text-info",
  },
  warning: {
    container: "border-warning/30 bg-warning/10",
    icon: "text-warning",
  },
  danger: {
    container: "border-destructive/30 bg-destructive/10",
    icon: "text-destructive",
  },
} satisfies Record<EnrollmentNoticeTone, { container: string; icon: string }>;

export function EnrollmentNotice(props: {
  title: string;
  message: JSX.Element;
  tone?: EnrollmentNoticeTone;
  action?: { href: string; label: string };
}) {
  const tone = () => noticeTone[props.tone ?? "info"];
  const urgent = () => props.tone === "danger" || props.tone === "warning";

  return (
    <div
      role={props.tone === "danger" || props.tone === "warning" ? "alert" : "status"}
      data-tone={props.tone ?? "info"}
      class={`rounded-xl border p-4 ${tone().container}`}
    >
      <div class="flex items-start gap-3">
        <Show
          when={urgent()}
          fallback={<span class={`shrink-0 ${tone().icon}`}><Info class="size-5" aria-hidden="true" /></span>}
        >
          <span class={`shrink-0 ${tone().icon}`}><CircleAlert class="size-5" aria-hidden="true" /></span>
        </Show>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-foreground">{props.title}</p>
          <p class="mt-1 text-sm leading-6 text-muted-foreground">{props.message}</p>
          <Show when={props.action}>
            {(action) => (
              <Button as="a" href={action().href} variant="outline" class="mt-3 min-h-11">
                {action().label}
              </Button>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}

export function EnrollmentStatus(props: { available: boolean; label: string }) {
  return (
    <span
      class="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground"
      data-available={props.available ? "true" : "false"}
    >
      <Show
        when={props.available}
        fallback={<CircleAlert class="size-3.5" aria-hidden="true" />}
      >
        <CheckCircle2 class="size-3.5" aria-hidden="true" />
      </Show>
      {props.available ? `Ready to enroll` : `${props.label} unavailable`}
    </span>
  );
}

export function EnrollmentLinkProblem(props: {
  status: EnrollmentLinkProblemStatus;
  reloadHref: string;
  supportEmail: string;
}) {
  const copy = () => enrollmentLinkProblemCopy(props.status);

  return (
    <EnrollmentNotice
      tone={copy().tone}
      title={copy().title}
      message={copy().message}
      action={{
        href: copy().action === "reload" ? props.reloadHref : "mailto:" + props.supportEmail,
        label: copy().actionLabel,
      }}
    />
  );
}

export function EnrollmentDeviceLimitNotice(props: { limit?: number; supportEmail: string }) {
  return (
    <EnrollmentNotice
      tone="warning"
      title={DEVICE_LIMIT_REACHED_TITLE}
      message={deviceLimitReachedMessage(props.limit)}
      action={{ href: "mailto:" + props.supportEmail, label: "Contact administrator" }}
    />
  );
}

export function EnrollmentQrPanel(props: { value: string; hasPassword: boolean }) {
  return (
    <aside
      aria-labelledby="enrollment-qr-heading"
      class="h-fit rounded-xl border border-border bg-muted/30 p-4"
    >
      <h2 id="enrollment-qr-heading" class="text-sm font-semibold text-foreground">
        Scan to open this page
      </h2>
      <p class="mt-1 text-xs leading-5 text-muted-foreground">
        Open the camera on the device you want to enroll and point it at this code.
      </p>
      <div class="mt-4 flex justify-center">
        <QrCode value={props.value} label="QR code for this enrollment link" size={176} />
      </div>
      <p class="mt-3 text-center text-xs leading-4 text-muted-foreground">
        This QR code contains the enrollment link only.
        <Show when={props.hasPassword}> It does not include the enrollment password.</Show>
      </p>
    </aside>
  );
}

export function EnrollmentSupport(props: { email: string; brandName: string }) {
  return (
    <footer class="mt-5 text-center text-xs leading-5 text-muted-foreground">
      Need help?{" "}
      <a
        href={`mailto:${props.email}`}
        class="font-medium text-foreground underline decoration-border-strong underline-offset-4 transition-colors hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        Contact <span class="break-all">{props.email}</span>
      </a>
      <span class="mx-2 text-border-strong" aria-hidden="true">
        ·
      </span>{" "}
      {props.brandName} device enrollment
    </footer>
  );
}

export function EnrollmentSteps(props: { steps: JSX.Element[] }) {
  return (
    <ol class="list-decimal space-y-3 ps-5 text-sm leading-6 text-muted-foreground marker:font-medium marker:text-foreground">
      <For each={props.steps}>{(step) => <li>{step}</li>}</For>
    </ol>
  );
}
