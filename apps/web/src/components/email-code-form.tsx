import { useQueryClient } from "@tanstack/solid-query";
import { createSignal, onCleanup, onSettled, Show } from "solid-js";
import { authClient } from "~/lib/auth";
import { enterpriseKeys } from "~/lib/enterprise";
import { errorMessage } from "~/lib/errors";

/**
 * Six-digit email verification shared by registration and the standalone
 * verification screen. Codes are single-use and expire after 15 minutes.
 */
export function EmailCodeForm(props: {
  email: string;
  /** Send a code as soon as the form mounts. */
  autoSend?: boolean;
  /** A code was already sent by the caller (registration does this). */
  sentInitially?: boolean;
  /** Signed challenge that belongs to the initially sent code. */
  initialChallenge?: string;
  /** A failure from the caller's initial send attempt. */
  initialError?: string | null;
  onVerified: () => void | Promise<void>;
  onBack?: () => void;
  backLabel?: string;
}) {
  const queryClient = useQueryClient();
  const [challenge, setChallenge] = createSignal(props.initialChallenge ?? "");
  const [code, setCode] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(props.initialError ?? null);

  const [notice, setNotice] = createSignal<string | null>(
    props.sentInitially ? "A verification code is on its way." : null,
  );

  const [cooldown, setCooldown] = createSignal(props.sentInitially ? 30 : 0);
  let timer: ReturnType<typeof setInterval> | undefined;

  const startCooldown = () => {
    clearInterval(timer);
    setCooldown(30);
    timer = setInterval(() => {
      setCooldown((value) => {
        if (value <= 1) {
          clearInterval(timer);

          return 0;
        }

        return value - 1;
      });
    }, 1000);
  };

  onCleanup(() => clearInterval(timer));

  const send = async () => {
    if (sending() || cooldown() > 0) return;
    setSending(true);
    setError(null);
    setNotice(null);
    const result = await authClient.requestEmailVerification();
    setSending(false);

    if (result.error) {
      setError(errorMessage(result.error, "Could not send a verification code."));

      return;
    }

    setChallenge(result.data?.challenge ?? "");
    setNotice("A new verification code has been sent.");
    startCooldown();
  };

  onSettled(() => {
    if (props.autoSend) void send();
    else if (props.sentInitially) startCooldown();
  });

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!/^\d{6}$/.test(code())) {
      setError("Enter the six-digit code from the email.");

      return;
    }

    if (!challenge()) {
      setError("Request a code, then enter the six digits from the email.");

      return;
    }

    setPending(true);
    const result = await authClient.verifyEmail({ code: code(), challenge: challenge() });
    setPending(false);

    if (result.error) {
      setError(errorMessage(result.error, "That code is invalid or has expired."));

      return;
    }

    await queryClient.invalidateQueries({ queryKey: enterpriseKeys.me() });
    await props.onVerified();
  };

  return (
    <div class="space-y-5">
      <div class="text-center">
        <h1 class="text-2xl font-semibold text-stone-900">Verify your email</h1>
        <p class="mt-1 text-sm text-stone-500">
          Enter the six-digit code we sent to{" "}
          <span class="font-medium text-stone-700">{props.email}</span>.
        </p>
      </div>

      <form onSubmit={submit} class="space-y-4">
        <div class="space-y-1.5">
          <label for="verification-code" class="text-sm font-medium text-stone-700">
            Verification code
          </label>
          <input
            id="verification-code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]{6}"
            maxlength="6"
            required
            autofocus
            placeholder="000000"
            value={code()}
            onInput={(event) => setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
            class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-center text-2xl tracking-[0.4em] text-stone-900 placeholder:tracking-[0.4em] placeholder:text-stone-300 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors"
          />
        </div>

        <Show when={error()}>{(message) => <p class="text-sm text-red-600">{message()}</p>}</Show>
        <Show when={notice()}>
          {(message) => <p class="text-sm text-emerald-600">{message()}</p>}
        </Show>

        <button
          type="submit"
          disabled={pending()}
          class="w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 transition-colors"
        >
          {pending() ? "Verifying…" : "Verify email"}
        </button>
      </form>

      <div class="flex items-center justify-between gap-3 text-xs text-stone-500">
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending() || cooldown() > 0}
          class="font-medium text-stone-700 underline underline-offset-2 hover:text-stone-900 disabled:no-underline disabled:opacity-60"
        >
          {sending()
            ? "Sending…"
            : cooldown() > 0
              ? `Resend code in ${cooldown()}s`
              : "Resend code"}
        </button>
        <Show when={props.onBack}>
          <button
            type="button"
            onClick={() => props.onBack?.()}
            class="font-medium text-stone-700 underline underline-offset-2 hover:text-stone-900"
          >
            {props.backLabel ?? "Back"}
          </button>
        </Show>
      </div>
    </div>
  );
}
