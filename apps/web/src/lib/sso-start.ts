import { Effect, Fiber, Scope } from "effect";
import { FetchHttpClient } from "effect/http";

export type OrganisationSsoResult =
  | { readonly kind: "redirect"; readonly url: string }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error"; readonly message: string };

const timeoutMessage = "Organisation sign-in took too long. Check your connection and try again.";
const unreachableMessage =
  "We couldn't reach organisation sign-in. Check your connection and try again.";
const unavailableMessage =
  "Organisation sign-in is temporarily unavailable. Try again in a moment.";
const genericError = "We couldn't start organisation sign-in. Try again.";
const lookupTimeoutMs = 10_000;

type SsoStartPayload = { readonly url?: unknown };

const ssoPayload = (value: unknown): SsoStartPayload | undefined => {
  if (typeof value !== "object" || value === null) return undefined;

  return { url: "url" in value ? value.url : undefined };
};

/** Only browser navigation schemes are valid destinations for an SSO start. */
export const ssoRedirectUrl = (value: unknown, origin: string): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value, origin);
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);

    return url.protocol === "https:" || localHttp ? value : null;
  } catch {
    return null;
  }
};

/** Leave Mattrax for the organisation's identity provider. */
export const redirectToProvider = (url: string): void => {
  window.location.assign(url);
};

/**
 * Start the email-first SSO lookup without flattening a provider outage into
 * "this address has no organisation". A 404 is the ordinary passkey path; a
 * malformed success or upstream failure must remain retryable.
 *
 * The fetch port is provided by the caller; the Promise adapter below uses the
 * browser global, while tests supply a fake via `Effect.provideService`.
 */
export const startOrganisationSsoEffect = (
  email: string,
  returnTo?: string,
): Effect.Effect<OrganisationSsoResult, never, Scope.Scope> =>
  Effect.gen(function* () {
    const query = new URLSearchParams({ email });

    if (returnTo) query.set("returnTo", returnTo);

    const fetchImpl = yield* FetchHttpClient.Fetch;
    // The fetch port needs a signal that can be aborted at an exact deadline,
    // independently of the scope's lifetime.
    // oxlint-disable-next-line effecttsgo/abort-controller-in-effect
    const controller = new AbortController();
    const deadline = yield* Effect.forkScoped(
      Effect.sleep(lookupTimeoutMs).pipe(Effect.andThen(Effect.sync(() => controller.abort()))),
    );

    yield* Effect.addFinalizer(() => Fiber.interrupt(deadline));

    const response = yield* Effect.tryPromise({
      try: () =>
        fetchImpl("/api/v1/sso/azure/start?" + query.toString(), {
          credentials: "include",
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: controller.signal,
        }),
      catch: (error) => error,
    });
    const payload = yield* Effect.promise(() =>
      (response.json() as Promise<unknown>).catch(() => undefined),
    );

    // A body read can also be interrupted by the lookup deadline.
    if (controller.signal.aborted) return { kind: "error", message: timeoutMessage } as const;

    if (response.ok) {
      const origin = yield* Effect.try({
        try: () => window.location.origin,
        catch: (error) => error,
      });
      const url = ssoRedirectUrl(ssoPayload(payload)?.url, origin);

      return url
        ? ({ kind: "redirect", url } as const)
        : ({ kind: "error", message: genericError } as const);
    }

    // No verified domain, membership, or enabled tenant maps to this address.
    // Stay silent so the lookup does not disclose whether an account exists.
    if (response.status === 404) return { kind: "unavailable" } as const;

    // A deployment without SSO configured keeps the normal passkey path. The
    // route only answers 503 in that case, so do not depend on body wording.
    if (response.status === 503) return { kind: "unavailable" } as const;

    if (response.status === 429)
      return {
        kind: "error",
        message: "Too many sign-in attempts. Wait a minute and try again.",
      } as const;

    if (response.status === 408) return { kind: "error", message: timeoutMessage } as const;

    if (response.status === 401 || response.status === 403)
      return {
        kind: "error",
        message: "Organisation sign-in was refused. Contact your administrator.",
      } as const;

    if (response.status >= 500) return { kind: "error", message: unavailableMessage } as const;

    if (response.status === 400 || response.status === 422)
      return {
        kind: "error",
        message:
          "That email address couldn't be used for organisation sign-in. Check it and try again.",
      } as const;

    return { kind: "error", message: genericError } as const;
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed<OrganisationSsoResult>(
        error instanceof DOMException && error.name === "AbortError"
          ? { kind: "error", message: timeoutMessage }
          : { kind: "error", message: unreachableMessage },
      ),
    ),
  );

/** Promise adapter for browser callers; browser fetch is the default port. */
export const startOrganisationSso = (
  email: string,
  returnTo?: string,
): Promise<OrganisationSsoResult> =>
  Effect.runPromise(startOrganisationSsoEffect(email, returnTo).pipe(Effect.scoped));
