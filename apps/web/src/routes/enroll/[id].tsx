import { Meta, Title } from "@solidjs/meta";
import { query } from "@solidjs/router";
import type { RouteProps } from "@solidjs/router";
import { defineFileRoute } from "@solidjs/router/fs";
import { DEFAULT_BRAND_COLOR, DEFAULT_SUPPORT_EMAIL } from "@mattrax/enterprise-domain/client";
import { createMemo, createSignal, Show } from "solid-js";
import { getRequestEvent, isServer } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { EnrollmentDetails } from "~/components/enrollment/enrollment-details";
import {
  EnrollmentNotice,
  EnrollmentQrPanel,
  EnrollmentSupport,
} from "~/components/enrollment/enrollment-feedback";
import { EnrollmentOptions } from "~/components/enrollment/enrollment-platforms";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { PasswordInput } from "~/components/ui/password-input";
import { Label } from "~/components/ui/label";
import { ChevronRight, KeyRound, ShieldCheck } from "~/components/ui/icons";
import type { EnrollmentResponse } from "~/lib/enterprise";
import { lookupPublicEnrollment } from "~/lib/enrollment.server";
import { enrollmentLinkProblemCopy } from "~/lib/enrollment-presentation";
import type { EnrollmentLinkProblemStatus } from "~/lib/enrollment-presentation";
import { DEVICE_LIMIT_REACHED_TITLE, deviceLimitReachedMessage } from "~/lib/plan-limits";

const isAuthenticatedEnrollment = (
  value: EnrollmentResponse | undefined,
): value is Extract<EnrollmentResponse, { authenticated: true }> => value?.authenticated === true;

const codeFromQuery = (query: Record<string, string | string[] | undefined>) => {
  const value = query.code;

  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
};

const getEnrollment = query(lookupPublicEnrollment, "public-enrollment");

/**
 * Warm the enrollment lookup before render. The component reads the same
 * query with deferStream, so the first HTML response already contains the
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
    const path = "/enroll/" + encodeURIComponent(props.id);

    if (isServer) {
      const request = getRequestEvent()?.request;

      return request ? new URL(path, request.url).toString() : path;
    }

    return window.location.origin + path;
  });

  const reloadHref = () => {
    const base = "/enroll/" + encodeURIComponent(props.id);

    return props.code ? base + "?code=" + encodeURIComponent(props.code) : base;
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
  const [passwordEdited, setPasswordEdited] = createSignal(false);
  const passwordInvalid = () => Boolean(props.code) && !passwordEdited();
  const needsDetails = () => {
    const value = authenticated();

    return value ? (value.questions?.length ?? 0) > 0 || value.assetTag : false;
  };
  const deviceLimit = () => {
    const value = found();

    return value?.authenticated === true ? value.deviceLimit : undefined;
  };

  const cardDescription = () => {
    const status = data().status;

    if (status !== "found") return enrollmentLinkProblemCopy(status).description;
    if (!authenticated()) return "Enter the enrollment password from your administrator.";
    if (needsDetails() && !detailsSaved()) return "First, tell us which device you are enrolling.";

    return "Choose your device type, then follow the setup steps.";
  };

  const pageWidth = () => {
    if (!authenticated()) return "max-w-xl";
    if (deviceLimit()?.reached) return "max-w-xl";

    return needsDetails() && !detailsSaved() ? "max-w-2xl" : "max-w-4xl";
  };

  return (
    <main
      class="enrollment-page flex min-h-svh flex-col justify-start bg-background px-4 py-6 text-foreground sm:justify-center sm:px-6 sm:py-10"
      style={{ "--enrollment-brand": brandColor() } as JSX.CSSProperties}
    >
      <Meta name="color-scheme" content="light dark" />
      <Title>Enroll in {brandName()}</Title>
      <Meta name="robots" content="noindex" />

      <div class={"mx-auto flex w-full flex-col justify-center " + pageWidth()}>
        <Card data-enrollment-card class="w-full overflow-hidden bg-card shadow-panel">
          <div class="h-1 w-full" style={{ "background-color": brandColor() }} />
          <CardHeader class="px-5 pb-6 pt-7 text-center sm:px-8 sm:pt-8">
            <Show when={branding()?.logo}>
              {(logo) => (
                <img
                  src={logo()}
                  alt=""
                  width="922"
                  height="142"
                  class="mx-auto mb-4 h-11 w-auto max-w-[12rem] object-contain sm:h-12"
                />
              )}
            </Show>
            <p class="mb-2 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ShieldCheck class="size-4 text-brand" aria-hidden="true" />
              Secure device enrollment
            </p>
            <CardTitle class="break-words text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">
              <h1 class="break-words">Enroll in {brandName()}</h1>
            </CardTitle>
            <CardDescription class="mx-auto mt-2 max-w-xl text-sm leading-6">
              {cardDescription()}
            </CardDescription>
          </CardHeader>

          <CardContent class="border-t border-border bg-surface/40 px-5 py-6 sm:px-8 sm:py-7">
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
                class="mx-auto max-w-sm space-y-4"
                method="get"
                action={"/enroll/" + encodeURIComponent(props.id)}
                aria-labelledby="enrollment-password-label"
              >
                <div class="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
                  <KeyRound class="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
                  <p class="text-sm leading-6 text-muted-foreground">
                    Your administrator has set an enrollment password.
                  </p>
                </div>
                <div class="space-y-1.5">
                  <Label id="enrollment-password-label" for="enrollment-password">
                    Enrollment password
                  </Label>
                  <PasswordInput
                    id="enrollment-password"
                    name="code"
                    autocomplete="off"
                    autocapitalize="none"
                    spellcheck={false}
                    class="h-12 pr-12 text-base sm:text-sm [&>button]:size-11"
                    aria-invalid={passwordInvalid() ? "true" : undefined}
                    aria-describedby={
                      passwordInvalid()
                        ? "enrollment-password-hint enrollment-password-error"
                        : "enrollment-password-hint"
                    }
                    onInput={() => setPasswordEdited(true)}
                    autofocus
                  />
                  <p id="enrollment-password-hint" class="text-xs leading-5 text-muted-foreground">
                    Enter the password provided by your administrator.
                  </p>
                  <Show when={passwordInvalid()}>
                    <p
                      id="enrollment-password-error"
                      role="alert"
                      class="text-sm font-medium text-destructive"
                    >
                      The enrollment password is invalid. Check it and try again.
                    </p>
                  </Show>
                </div>
                <Button type="submit" class="min-h-11 w-full">
                  Continue
                  <ChevronRight class="size-4" aria-hidden="true" />
                </Button>
              </form>
            </Show>

            <Show when={authenticated()}>
              {(authenticatedEnrollment) => (
                <>
                  <Show when={deviceLimit()?.reached}>
                    <EnrollmentNotice
                      tone="warning"
                      title={DEVICE_LIMIT_REACHED_TITLE}
                      message={deviceLimitReachedMessage(deviceLimit()?.limit)}
                      action={{
                        href: "mailto:" + supportEmail(),
                        label: "Contact administrator",
                      }}
                    />
                  </Show>

                  <Show when={!deviceLimit()?.reached}>
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
                      <Show when={detailsSaved()}>
                        <div class="mb-5">
                          <EnrollmentNotice
                            tone="info"
                            title="Device details saved"
                            message="Now choose the platform you are setting up."
                          />
                        </div>
                      </Show>
                      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
                        <EnrollmentOptions
                          enrollment={authenticatedEnrollment()}
                          id={props.id}
                          code={props.code}
                          brandColor={brandColor()}
                          supportEmail={supportEmail()}
                        />
                        <EnrollmentQrPanel
                          value={enrollmentUrl()}
                          hasPassword={Boolean(props.code)}
                        />
                      </div>
                    </Show>
                  </Show>
                </>
              )}
            </Show>
          </CardContent>
        </Card>

        <EnrollmentSupport email={supportEmail()} brandName={brandName()} />
      </div>
    </main>
  );
}

function EnrollmentLinkProblem(props: {
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

export default function EnrollRoute(props: RouteProps<typeof route>) {
  return <EnrollPage id={props.params.id ?? ""} code={codeFromQuery(props.location.query)} />;
}
