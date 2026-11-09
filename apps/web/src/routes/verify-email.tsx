import { useSearchParams } from "@solidjs/router";
import { createSignal, onSettled, Show } from "solid-js";
import { authClient } from "~/lib/auth";

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = createSignal<"pending" | "ok" | "error">("pending");
  const [message, setMessage] = createSignal("Verifying your email address…");

  onSettled(() => {
    const token = Array.isArray(searchParams.token) ? searchParams.token[0] : searchParams.token;
    if (!token) {
      setStatus("error");
      setMessage("This verification link is missing its token.");
      return;
    }
    void (async () => {
      const result = await authClient.verifyEmail({ token });
      if (result.error) {
        setStatus("error");
        setMessage(result.error.message ?? "This verification link is invalid or expired.");
        return;
      }
      setStatus("ok");
      setMessage("Your email address is verified.");
    })();
  });

  return (
    <div class="min-h-screen flex items-center justify-center bg-stone-50">
      <div class="w-full max-w-sm rounded-xl border bg-white p-6 text-center shadow-sm">
        <a href="/" class="mb-6 inline-flex items-center gap-2">
          <span class="font-semibold tracking-tight text-lg">Mattrax</span>
        </a>
        <h1 class="text-xl font-semibold text-stone-900">
          {status() === "ok"
            ? "Email verified"
            : status() === "error"
              ? "Verification failed"
              : "Verifying email"}
        </h1>
        <p class="mt-2 text-sm text-stone-500">{message()}</p>
        <Show when={status() !== "pending"}>
          <a
            href="/dashboard"
            class="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
          >
            Continue to dashboard
          </a>
        </Show>
      </div>
    </div>
  );
}
