export type ErrorVariant =
  | "auth"
  | "permission"
  | "not-found"
  | "validation"
  | "rate-limit"
  | "server"
  | "network";

export type ErrorPresentation = {
  readonly title: string;
  readonly message: string;
  readonly variant: ErrorVariant;
  readonly tag?: string;
};

const TAG_PATTERN =
  /^(?:Enterprise|Platform|Password|Session|StaleAuthentication|PendingAuthentication|Email|Sso|NewPassword|Proof|Hook|Auth|R2|Stripe)[A-Za-z0-9_]*$/;

const TITLES: Record<ErrorVariant, string> = {
  auth: "Sign in required",
  permission: "Not allowed",
  "not-found": "Not found",
  validation: "Check your details",
  "rate-limit": "Too many attempts",
  server: "Something went wrong",
  network: "Connection problem",
};

type Mapping = {
  readonly message: string;
  readonly variant: ErrorVariant;
};

const TAGS: Record<string, Mapping> = {
  EnterpriseUnauthorized: {
    message: "Your session has expired. Sign in again to continue.",
    variant: "auth",
  },
  EnterpriseForbidden: {
    message: "You don't have permission to do that.",
    variant: "permission",
  },
  EnterpriseNotFound: {
    message: "We couldn't find that. It may have been deleted or moved.",
    variant: "not-found",
  },
  EnterpriseBadRequest: { message: "That request couldn't be completed.", variant: "validation" },
  EnterpriseTenantHasMembers: {
    message: "This workspace still has other members. Remove them before deleting it.",
    variant: "validation",
  },
  EnterpriseLastTenantUser: {
    message: "You can't remove the last owner of a workspace.",
    variant: "validation",
  },
  EnterpriseStripeError: {
    message: "Billing is temporarily unavailable. Try again shortly.",
    variant: "server",
  },
  EnterpriseNotConfigured: {
    message: "This feature is not configured for this deployment.",
    variant: "server",
  },
  EnterpriseUpstreamError: {
    message: "The provider is temporarily unavailable. Try again shortly.",
    variant: "server",
  },
  EnterpriseR2FileNotFound: {
    message: "That file is no longer available.",
    variant: "not-found",
  },
  EnterpriseR2InternalError: {
    message: "File storage is temporarily unavailable. Try again shortly.",
    variant: "server",
  },
  EnterpriseDbError: {
    message: "Something went wrong on our side. Try again shortly.",
    variant: "server",
  },
  PlatformUnauthorized: { message: "Your session has expired. Sign in again.", variant: "auth" },
  PlatformBadRequest: { message: "That request couldn't be completed.", variant: "validation" },
  PlatformNotFound: { message: "We couldn't find that instance.", variant: "not-found" },
  PasswordRejected: {
    message: "Incorrect email or password. Check your details and try again.",
    variant: "auth",
  },
  PasswordUnavailable: {
    message:
      "We couldn't sign you in with those details. Check your email and password, or use an email sign-in code.",
    variant: "auth",
  },
  PasswordActionRequired: {
    message: "Additional verification is required. Check your email to continue.",
    variant: "auth",
  },
  PasswordMethodUnsupported: {
    message: "Password sign-in isn't available for this account. Use email sign-in instead.",
    variant: "auth",
  },
  PasswordCheckUnavailable: {
    message: "We couldn't check that password right now. Try again shortly.",
    variant: "server",
  },
  NewPasswordRejected: {
    message: "Choose a stronger password and try again.",
    variant: "validation",
  },
  EmailRejected: {
    message: "That code is invalid or has expired. Request a new one.",
    variant: "validation",
  },
  EmailUnavailable: {
    message: "We couldn't send that email right now. Try again shortly.",
    variant: "server",
  },
  EmailMethodUnsupported: {
    message: "Email sign-in isn't available for this account.",
    variant: "auth",
  },
  EmailActionRequired: {
    message: "Check your email to continue.",
    variant: "auth",
  },
  SessionInvalid: {
    message: "Your session has expired. Sign in again to continue.",
    variant: "auth",
  },
  SessionUnavailable: {
    message: "Your session has expired. Sign in again to continue.",
    variant: "auth",
  },
  StaleAuthentication: {
    message: "Your session changed. Sign in again to continue.",
    variant: "auth",
  },
  SessionConflict: {
    message: "This session was replaced by another sign-in.",
    variant: "auth",
  },
  SessionStepUpInvalid: {
    message: "Confirm your identity and try again.",
    variant: "auth",
  },
  SessionSignOutUnavailable: {
    message: "You were signed out here, but other sessions may still be active.",
    variant: "auth",
  },
  PendingAuthenticationInvalid: {
    message: "That sign-in attempt has expired. Start again.",
    variant: "auth",
  },
  ProofInvalid: {
    message: "This link is invalid or has expired. Request a new one.",
    variant: "validation",
  },
  ProofIngressDenied: {
    message: "This link is invalid or has expired. Request a new one.",
    variant: "validation",
  },
  ProofCapabilityUnsupported: {
    message: "This link can't be used on this device.",
    variant: "validation",
  },
  HookDenied: {
    message: "Sign-in was blocked by a security policy.",
    variant: "permission",
  },
  SsoRejected: {
    message: "Single sign-on was rejected. Try again or contact your administrator.",
    variant: "auth",
  },
};

const GENERIC_SERVER_MESSAGES = new Set([
  "Forbidden",
  "Unauthenticated",
  "Internal Server Error",
  "Request failed",
  "Something went wrong",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const messageOf = (error: unknown): string | undefined => {
  if (typeof error === "string") return error.trim() || undefined;
  if (error instanceof Error) return error.message.trim() || undefined;
  if (isRecord(error)) {
    const message = error.message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return undefined;
};

const parseJson = (value: string): unknown => {
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

export const errorTag = (error: unknown): string | undefined => {
  if (typeof error === "string") {
    const parsed = parseJson(error);
    if (parsed !== undefined) return errorTag(parsed);
    return TAG_PATTERN.test(error.trim()) ? error.trim() : undefined;
  }
  if (!isRecord(error)) return undefined;
  const tag = error._tag;
  if (typeof tag === "string") return tag;
  const nested = error.error;
  if (isRecord(nested) && typeof nested._tag === "string") return nested._tag;
  return undefined;
};

const isTechnical = (message: string) =>
  /^(Decode error|HttpClientError|TypeError|FiberFailure|Error:)/i.test(message) ||
  /undeclared status code|https?:\/\/|at .+\(.+:\d+:\d+\)/i.test(message);

export const errorPresentation = (
  error: unknown,
  fallback = "Something went wrong. Try again.",
): ErrorPresentation => {
  const directTag = errorTag(error);
  const rawMessage = messageOf(error) ?? (typeof error === "string" ? error : undefined);
  const parsed = rawMessage ? parseJson(rawMessage) : undefined;
  const tag = directTag ?? errorTag(parsed) ?? (rawMessage ? errorTag(rawMessage) : undefined);
  const reason = isRecord(error) && typeof error.reason === "string" ? error.reason : undefined;
  if (tag === "NewPasswordRejected" && reason) {
    const message =
      reason === "too-short"
        ? "Use at least 15 characters for your password."
        : reason === "too-long"
          ? "That password is too long. Use a shorter passphrase."
          : reason === "compromised"
            ? "This password has appeared in a data breach. Choose another."
            : reason === "common"
              ? "This password is too common. Choose something less predictable."
              : "Choose a stronger, less predictable password.";
    return { title: TITLES.validation, message, variant: "validation", tag };
  }
  const mapped = tag ? TAGS[tag] : undefined;

  if (tag && mapped) {
    const serverMessage = rawMessage && !TAG_PATTERN.test(rawMessage) ? rawMessage : undefined;
    const canUseServerMessage =
      serverMessage &&
      !GENERIC_SERVER_MESSAGES.has(serverMessage) &&
      !isTechnical(serverMessage) &&
      [
        "EnterpriseBadRequest",
        "EnterpriseNotFound",
        "EnterpriseForbidden",
        "EnterpriseNotConfigured",
        "EnterpriseUpstreamError",
      ].includes(tag);
    return {
      title: TITLES[mapped.variant],
      message: canUseServerMessage ? serverMessage : mapped.message,
      variant: mapped.variant,
      tag,
    };
  }

  if (rawMessage) {
    if (/too many requests|rate limit|status 429|with 429/i.test(rawMessage))
      return {
        title: TITLES["rate-limit"],
        message: "Too many attempts. Wait a minute and try again.",
        variant: "rate-limit",
      };
    if (/failed to fetch|network|connection|offline|load failed/i.test(rawMessage))
      return {
        title: TITLES.network,
        message: "Can't reach the server. Check your connection and try again.",
        variant: "network",
      };
    if (/decode error|undeclared status code|unexpected response/i.test(rawMessage))
      return {
        title: TITLES.server,
        message: "The server returned an unexpected response. Try again shortly.",
        variant: "server",
      };
    if (!isTechnical(rawMessage) && !GENERIC_SERVER_MESSAGES.has(rawMessage))
      return { title: TITLES.validation, message: rawMessage, variant: "validation" };
  }

  return { title: TITLES.server, message: fallback, variant: "server" };
};

export const errorMessage = (error: unknown, fallback?: string): string =>
  errorPresentation(error, fallback).message;
