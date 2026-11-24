export type PasskeySignInFailureTag =
  | "PasskeyCancelled"
  | "PasskeyNotAllowed"
  | "PasskeyNoAuthenticator"
  | "PasskeyUnsupported"
  | "PasskeyBlocked";

export class PasskeySignInError extends Error {
  readonly tag: PasskeySignInFailureTag;

  constructor(tag: PasskeySignInFailureTag, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PasskeySignInError";
    this.tag = tag;
  }
}

/** WebAuthn is gated by both the browser API and a secure context. */
export const passkeyEnvironmentAvailable = () =>
  typeof window !== "undefined" &&
  window.isSecureContext &&
  window.PublicKeyCredential !== undefined &&
  typeof navigator !== "undefined" &&
  typeof navigator.credentials?.get === "function";

export const passkeyEnvironmentFailure = (): PasskeySignInError | null => {
  if (passkeyEnvironmentAvailable()) return null;

  return new PasskeySignInError(
    "PasskeyUnsupported",
    "This browser can't use passkeys. Open Mattrax over HTTPS in a current browser and try again.",
  );
};

const errorCause = (cause: unknown): Error | undefined => {
  let current: unknown = cause;

  // SimpleWebAuthn preserves the original DOMException on cause and mirrors
  // its name. Inspect the cause, but never put browser/provider text on screen.
  for (let depth = 0; depth < 3; depth += 1) {
    if (!(current instanceof Error)) return undefined;
    if (!(current.cause instanceof Error)) return current;

    current = current.cause;
  }

  return current instanceof Error ? current : undefined;
};

const errorName = (cause: unknown) => errorCause(cause)?.name;

const errorText = (cause: unknown) => errorCause(cause)?.message ?? "";

const noAuthenticator = (cause: unknown) => {
  const text = errorText(cause);

  return (
    /no (?:available |matching )?authenticator/i.test(text) ||
    /authenticator (?:is )?not (?:available|found|supported)/i.test(text) ||
    /no (?:matching )?credentials?(?: were)? found/i.test(text) ||
    /no passkey (?:is )?available/i.test(text)
  );
};

const cancelled = (cause: unknown) =>
  /\bcancel(?:l)?ed\b|\bdismiss(?:ed)?\b|timed?\s*out|\btimeout\b|user (?:denied|declined) (?:the )?(?:request|prompt)/i.test(
    errorText(cause),
  );

/** Map overloaded WebAuthn failures without claiming a credential was rejected. */
export const passkeyAuthenticationFailure = (cause: unknown): PasskeySignInError => {
  const name = errorName(cause);
  const text = errorText(cause);

  if (name === "NotSupportedError" || /webauthn is not supported/i.test(text))
    return new PasskeySignInError(
      "PasskeyUnsupported",
      "This browser can't use passkeys. Open Mattrax over HTTPS in a current browser and try again.",
      { cause },
    );

  if (name === "SecurityError")
    return new PasskeySignInError(
      "PasskeyBlocked",
      "This browser blocked passkey sign-in. Open Mattrax directly in a current browser and allow passkeys, then try again.",
      { cause },
    );

  if (name === "NotAllowedError") {
    if (noAuthenticator(cause))
      return new PasskeySignInError(
        "PasskeyNoAuthenticator",
        "No passkey option was available. Set up a passkey in your device settings or password manager, then try again.",
        { cause },
      );

    if (cancelled(cause))
      return new PasskeySignInError(
        "PasskeyCancelled",
        "Passkey sign-in was cancelled or timed out. Try again.",
        { cause },
      );

    // Safari and password-manager extensions overload NotAllowedError. When
    // the browser gives no reliable reason, cover both a dismissed prompt and
    // a prompt that never appeared instead of blaming the credential.
    return new PasskeySignInError(
      "PasskeyNotAllowed",
      "Passkey sign-in wasn't completed. If a prompt appeared, approve it and try again. If no prompt appeared, check that your browser or password manager offers a passkey.",
      { cause },
    );
  }

  if (name === "AbortError")
    return new PasskeySignInError("PasskeyCancelled", "Passkey sign-in was cancelled. Try again.", {
      cause,
    });

  if (name === "UnknownError")
    return new PasskeySignInError(
      "PasskeyNoAuthenticator",
      "The authenticator couldn't complete passkey sign-in. Try another authenticator, or restart your browser and try again.",
      { cause },
    );

  return new PasskeySignInError(
    "PasskeyUnsupported",
    "Mattrax couldn't start the passkey prompt. Try a current browser with passkeys enabled, then try again.",
    { cause },
  );
};

/** Safe copy for tagged server failures; raw provider messages never reach the page. */
export const passkeySignInFailureMessage = (tag: string | undefined): string => {
  switch (tag) {
    case "PasskeyCancelled":
      return "Passkey sign-in was cancelled or timed out. Try again, or use the email recovery link below.";
    case "PasskeyNotAllowed":
      return "Passkey sign-in wasn't completed. If no prompt appeared, check that your browser or password manager offers a passkey, or use the email recovery link below.";
    case "PasskeyNoAuthenticator":
      return "No passkey option was available. Set up a passkey in your device settings or password manager, or use the email recovery link below.";
    case "PasskeyUnsupported":
      return "This browser can't use passkeys. Open Mattrax over HTTPS in a current browser, or use the email recovery link below.";
    case "PasskeyBlocked":
      return "This browser blocked passkey sign-in. Open Mattrax directly in a current browser and allow passkeys, or use the email recovery link below.";
    case "PasskeyProtocolRejected":
      return "That passkey couldn't be verified. If your password manager saved it, remove it and try another passkey, or use the email recovery link below.";
    case "PasskeyRejected":
      return "That passkey wasn't accepted. Try again, or use the email recovery link below.";
    case "PasskeyUnavailable":
      return "Mattrax couldn't complete the passkey step. Try again, or use the email recovery link below.";
    default:
      return "We couldn't complete passkey sign-in. Try again, or use the email recovery link below.";
  }
};
