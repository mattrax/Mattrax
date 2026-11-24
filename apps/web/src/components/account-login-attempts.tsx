import { isServer } from "@solidjs/web";
import { useQuery } from "@tanstack/solid-query";
import { LOGIN_ATTEMPT_FAILURES } from "@mattrax/enterprise-domain/client";
import type {
  LoginAttemptFactor,
  LoginAttemptFailure,
  LoginAttemptInfo,
  LoginAttemptMethod,
  LoginAttemptsResponse,
} from "@mattrax/enterprise-domain/client";
import { For, Show } from "solid-js";
import { ErrorText, Panel } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

const METHOD_LABELS: Record<LoginAttemptMethod, string> = {
  passkey: "Passkey",
  totp: "Authenticator code",
  sso: "Single sign-on",
  recovery: "Account recovery",
  "api-token": "API token",
};

const FACTOR_LABELS: Record<LoginAttemptFactor, string> = {
  passkey: "passkey",
  totp: "authenticator code",
  recovery: "recovery code",
  sso: "single sign-on",
};

const isLoginAttemptFailure = (reason: string): reason is LoginAttemptFailure =>
  LOGIN_ATTEMPT_FAILURES.some((value) => value === reason);

const FAILURE_LABELS = new Map<LoginAttemptFailure, string>([
  ["invalid_code", "Incorrect code"],
  ["unknown_account", "Unknown account"],
  ["expired", "Expired challenge"],
  ["disabled", "Account disabled"],
  ["mfa_failed", "Second factor rejected"],
  ["passkey_rejected", "Passkey rejected"],
  ["sso_rejected", "Single sign-on rejected"],
  ["recovery_rejected", "Recovery link rejected"],
  ["rate_limited", "Too many attempts"],
  ["not_member", "Not a member of the organisation"],
  ["failed", "Rejected"],
]);

const formatDate = (value: string) => {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const deviceLabel = (attempt: LoginAttemptInfo) => {
  const parts = [attempt.browser, attempt.platform].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" on ") : "Unrecognised device";
};

/**
 * Name the primary proof and, when it differs, the step that completed the
 * sign-in: a passkey finished with an authenticator recovery code reads as
 * "Passkey + recovery code".
 */
const factorLabel = (attempt: LoginAttemptInfo): string | null => {
  const factor = attempt.factor;

  if (!factor || factor === attempt.method) return null;

  switch (factor) {
    case "passkey":
    case "totp":
    case "recovery":
    case "sso":
      return FACTOR_LABELS[factor];
    default:
      return null;
  }
};

const methodLabel = (attempt: LoginAttemptInfo) => {
  const primary = METHOD_LABELS[attempt.method];
  const factor = factorLabel(attempt);

  return factor === null ? primary : `${primary} + ${factor}`;
};

const failureLabel = (reason: string | null | undefined) =>
  reason === null || reason === undefined
    ? null
    : isLoginAttemptFailure(reason)
      ? (FAILURE_LABELS.get(reason) ?? reason.replaceAll("_", " "))
      : reason.replaceAll("_", " ");

/**
 * Account → Login attempts.
 *
 * A compact view of the account's own sign-in history. Every stored rejection
 * is attributed to this account; unattributable failures are never written, so
 * the list is complete for the rows it can show.
 */
export function AccountLoginAttempts(props: { userId: string | undefined }) {
  const attempts = useQuery<LoginAttemptsResponse>(() => ({
    queryKey: enterpriseKeys.loginAttempts(props.userId),
    queryFn: () => enterprise.listLoginAttempts(),
    // The request needs the browser cookie; SSR runs without it.
    enabled: Boolean(props.userId) && !isServer,
  }));

  const rows = () => attempts.data?.attempts ?? [];

  return (
    <Panel
      title="Login attempts"
      description="Successful and rejected sign-ins for your account, newest first. Only you can see this history; networks are shown as approximate prefixes. Rejections with no identified account are not stored."
    >
      <Show when={attempts.isPending}>
        <p class="text-[13px] text-muted-foreground">Loading sign-in history…</p>
      </Show>

      <Show when={attempts.error}>{(error) => <ErrorText error={error()} />}</Show>

      <Show when={!attempts.isPending && !attempts.error}>
        <Show
          when={rows().length > 0}
          fallback={
            <p class="text-[13px] text-muted-foreground">
              No sign-in attempts recorded yet. The next time you sign in, it will appear here.
            </p>
          }
        >
          <ul class="divide-y divide-border rounded-lg border border-border">
            <For each={rows()}>
              {(attempt) => (
                <li class="px-3 py-2.5">
                  <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p class="flex flex-wrap items-center gap-2 text-[13px] font-medium text-foreground">
                      <span>{methodLabel(attempt)}</span>
                      <Show
                        when={attempt.success}
                        fallback={<Badge variant="destructive">Failed</Badge>}
                      >
                        <Badge
                          variant="outline"
                          class="border-success/25 bg-success/10 text-success"
                        >
                          Signed in
                        </Badge>
                      </Show>
                    </p>
                    <time
                      class="text-[11px] text-muted-foreground"
                      datetime={attempt.createdAt}
                      title={new Date(attempt.createdAt).toISOString()}
                    >
                      {formatDate(attempt.createdAt)}
                    </time>
                  </div>
                  <p class="mt-0.5 break-words text-[11px] leading-relaxed text-muted-foreground">
                    {deviceLabel(attempt)}
                    <Show when={attempt.ip}>
                      {(ip) => (
                        <>
                          {" · "}
                          Network {ip()}
                        </>
                      )}
                    </Show>
                    <Show when={failureLabel(attempt.failureReason)}>
                      {(reason) => (
                        <>
                          {" · "}
                          <span class="text-destructive">{reason()}</span>
                        </>
                      )}
                    </Show>
                  </p>
                </li>
              )}
            </For>
          </ul>
          <p class="mt-3 text-xs text-muted-foreground">
            {rows().length} attempt{rows().length === 1 ? "" : "s"} · newest first
          </p>
        </Show>
      </Show>
    </Panel>
  );
}
