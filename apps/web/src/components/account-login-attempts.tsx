import { isServer } from "@solidjs/web";
import { Option, Schema } from "effect";
import { createSignal, For, onSettled, Show } from "solid-js";
import { Panel } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { errorMessage, raisedFailure } from "~/lib/errors";

const LoginAttempts = Schema.Struct({
  attempts: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      createdAt: Schema.String,
      success: Schema.Boolean,
      method: Schema.Literals(["passkey", "totp", "sso", "recovery", "api-token"]),
      failureReason: Schema.optional(Schema.NullOr(Schema.String)),
      ip: Schema.optional(Schema.NullOr(Schema.String)),
      browser: Schema.optional(Schema.NullOr(Schema.String)),
      platform: Schema.optional(Schema.NullOr(Schema.String)),
      deviceType: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});

type LoginAttempts = typeof LoginAttempts.Type;

type LoginAttempt = LoginAttempts["attempts"][number];

const METHOD_LABELS: Record<LoginAttempt["method"], string> = {
  passkey: "Passkey",
  totp: "Authenticator code",
  sso: "Single sign-on",
  recovery: "Account recovery",
  "api-token": "API token",
};

const FAILURE_LABELS = new Map<string, string>([
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

const deviceLabel = (attempt: LoginAttempt) => {
  const parts = [attempt.browser, attempt.platform].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" on ") : "Unrecognised device";
};

const failureLabel = (reason: string | null | undefined) =>
  reason ? (FAILURE_LABELS.get(reason) ?? reason.replaceAll("_", " ")) : null;

/**
 * Account → Login attempts.
 *
 * A compact view of the account's own sign-in history: successful sessions and
 * rejected attempts the server could attribute to this account. Discoverable
 * passkey rejections carry no identity, so they stay unattributed and are not
 * shown here.
 */
export function AccountLoginAttempts(props: { userId: string | undefined }) {
  const [attempts, setAttempts] = createSignal<LoginAttempts>();
  const [error, setError] = createSignal<string | null>(null);

  const refetch = async () => {
    setError(null);

    try {
      const response = await fetch("/api/v1/account/login-attempts", {
        credentials: "include",
      });

      if (!response.ok) {
        setError(errorMessage({ message: `Request failed with ${response.status}` }));

        return;
      }

      const body = Option.getOrUndefined(
        Schema.decodeUnknownOption(LoginAttempts)(await response.json()),
      );

      if (body === undefined) throw new Error("Unexpected login attempts response");

      setAttempts(body);
    } catch (cause) {
      setError(errorMessage(raisedFailure(cause)));
    }
  };

  onSettled(() => {
    if (!isServer && props.userId) void refetch();
  });

  const rows = () => attempts()?.attempts ?? [];

  return (
    <Panel
      title="Login attempts"
      description="Successful and rejected sign-ins for your account, newest first. Only you can see this history; networks are shown as approximate prefixes. Rejections that cannot be tied to an account are not listed."
    >
      <Show when={error()}>
        {(message) => (
          <p role="alert" class="text-[12.5px] text-destructive">
            {message()}
          </p>
        )}
      </Show>

      <Show
        when={rows().length > 0}
        fallback={
          <p class="text-[13px] text-muted-foreground">
            {attempts() === undefined
              ? "Loading sign-in history…"
              : "No sign-in attempts recorded yet. The next time you sign in, it will appear here."}
          </p>
        }
      >
        <ul class="divide-y divide-border rounded-lg border border-border">
          <For each={rows()}>
            {(attempt) => (
              <li class="px-3 py-2.5">
                <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p class="flex flex-wrap items-center gap-2 text-[13px] font-medium text-foreground">
                    <span>{METHOD_LABELS[attempt.method]}</span>
                    <Show
                      when={attempt.success}
                      fallback={<Badge variant="destructive">Failed</Badge>}
                    >
                      <Badge
                        variant="outline"
                        class="border-success/25 bg-success/10 text-success-foreground"
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
    </Panel>
  );
}
