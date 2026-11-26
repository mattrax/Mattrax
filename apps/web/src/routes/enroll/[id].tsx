import { Meta, Title } from "@solidjs/meta";
import { query } from "@solidjs/router";
import type { RouteProps } from "@solidjs/router";
import { defineFileRoute } from "@solidjs/router/fs";
import { DEFAULT_BRAND_COLOR, DEFAULT_SUPPORT_EMAIL } from "@mattrax/enterprise-domain/client";
import { createMemo, createSignal, Show } from "solid-js";
import { getRequestEvent, isServer } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import EnrollmentDetails from "~/components/enrollment/enrollment-details";
import {
  EnrollmentDeviceLimitNotice,
  EnrollmentLinkProblem,
  EnrollmentNotice,
  EnrollmentQrPanel,
  EnrollmentSupport,
} from "~/components/enrollment/enrollment-feedback";
import EnrollmentOptions from "~/components/enrollment/enrollment-platforms";
import EnrollmentPasswordInput from "~/components/enrollment/enrollment-password-input";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import Label from "~/components/ui/label";
import { ChevronRight, KeyRound, ShieldCheck } from "~/components/ui/icons";
import type { EnrollmentResponse } from "~/lib/enterprise";
import { lookupPublicEnrollment } from "~/lib/enrollment.server";
import {
  deviceLimitCardDescription,
  enrollmentLinkProblemCopy,
} from "~/lib/enrollment-presentation";

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

function EnrollPage(props: { id: string; code: string; codeProvided: boolean }) {
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
  // `code` is only echoed back once the server has seen it, so an explicitly
  // empty value (`?code=`) still means "an attempt was made and rejected".
  const passwordInvalid = () => (Boolean(props.code) || props.codeProvided) && !passwordEdited();
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
    if (deviceLimit()?.reached) return deviceLimitCardDescription();
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
        <div class="w-full rounded-xl shadow-panel">
          <Card data-enrollment-card class="w-full overflow-hidden">
          <div class="h-1 w-full bg-(--enrollment-stripe)" style={{ "--enrollment-stripe": brandColor() } as JSX.CSSProperties} />
          <CardHeader class="text-center">
            <Show when={branding()?.logo}>
              {(logo) => (
                <img
                  src={logo()}
                  alt=""
                  width="922"
                  height="142"
                  class="mx-auto mb-4 h-11 w-auto max-w-48 object-contain sm:h-12"
                />
              )}
            </Show>
            <p class="mb-2 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span class="text-brand"><ShieldCheck class="size-4" aria-hidden="true" /></span>
              Secure device enrollment
            </p>
            <CardTitle class="break-words">
              <h1 class="break-words">Enroll in {brandName()}</h1>
            </CardTitle>
            <CardDescription class="mx-auto mt-2 max-w-xl">
              {cardDescription()}
            </CardDescription>
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
                class="mx-auto max-w-sm space-y-4"
                method="get"
                action={"/enroll/" + encodeURIComponent(props.id)}
              >
                <div class="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
                  <span class="mt-0.5 text-brand"><KeyRound class="size-4 shrink-0" aria-hidden="true" /></span>
                  <p class="text-sm leading-6 text-muted-foreground">
                    Your administrator has set an enrollment password.
                  </p>
                </div>
                <div class="space-y-1.5">
                  <Label for="enrollment-password">Enrollment password</Label>
                  <EnrollmentPasswordInput
                    id="enrollment-password"
                    name="code"
                    required
                    autocomplete="off"
                    autocapitalize="none"
                    spellcheck={false}
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
                    <EnrollmentDeviceLimitNotice
                      limit={deviceLimit()?.limit}
                      supportEmail={supportEmail()}
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
                          onSaved={() => {
                            setDetailsSaved(true);
                            // The details form is replaced in place, so send
                            // focus to the step that appeared instead of
                            // dropping it on <body>.
                            if (!isServer)
                              queueMicrotask(() =>
                                document.getElementById("enrollment-platform-heading")?.focus(),
                              );
                          }}
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
                      <div class="grid items-start gap-6 lg:grid-cols-2">
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
        </div>

        <EnrollmentSupport email={supportEmail()} brandName={brandName()} />
      </div>
    </main>
  );
}

export default function EnrollRoute(props: RouteProps<typeof route>) {
  return (
    <EnrollPage
      id={props.params.id ?? ""}
      code={codeFromQuery(props.location.query)}
      codeProvided={props.location.query.code !== undefined}
    />
  );
}
