import { Match, Option, Schema } from "effect";

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

/**
 * A failure after it has crossed an I/O boundary: either a thrown `Error` or a
 * JSON envelope/message decoded from a response body.
 */
export type RaisedFailure = Error | Schema.Json;

const isError = Schema.is(Schema.instanceOf(Error));

const isJson = Schema.is(Schema.Json);

const isRaisedFailure = (cause: unknown): cause is RaisedFailure => isError(cause) || isJson(cause);

/** Decode an arbitrary catch binding into the failure domain. */
export const raisedFailure = (cause: unknown): RaisedFailure | undefined =>
  isRaisedFailure(cause) ? cause : undefined;

const TAG_PATTERN =
  /^(?:Enterprise|Platform|Password|Session|StaleAuthentication|PendingAuthentication|Email|Sso|NewPassword|Proof|Hook|Auth|R2|Stripe|StepUp|Approval)[A-Za-z0-9_]*$/;

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

const TAGS = {
  EnterpriseUnauthorized: {
    message: "Your session has expired. Sign in again to continue.",
    variant: "auth",
  },
  EnterpriseForbidden: {
    message: "You don't have permission to do that.",
    variant: "permission",
  },
  ApprovalRequired: {
    message: "Another administrator must approve this action first.",
    variant: "permission",
  },
  EnterprisePermissionDenied: {
    message: "Your role does not allow that action.",
    variant: "permission",
  },
  EnterpriseNotFound: {
    message: "We couldn't find that. It may have been deleted or moved.",
    variant: "not-found",
  },
  EnterpriseBadRequest: { message: "That request couldn't be completed.", variant: "validation" },
  EnterpriseConflict: {
    message: "That change conflicts with something that already exists.",
    variant: "validation",
  },
  EnterprisePreconditionFailed: {
    message: "Someone else changed this. Reload the latest version and try again.",
    variant: "validation",
  },
  EnterpriseTenantHasMembers: {
    message: "This tenant still has other members. Remove them before deleting it.",
    variant: "validation",
  },
  EnterpriseLastTenantAccount: {
    message: "You can't remove the last owner of a tenant.",
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
  EnterpriseInternal: {
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
  StepUpRequired: {
    message: "Confirm your identity to continue.",
    variant: "auth",
  },
  StepUpUnavailable: {
    message: "That confirmation method isn't available. Choose another way to confirm.",
    variant: "validation",
  },
  SsoRejected: {
    message: "Single sign-on was rejected. Try again or contact your administrator.",
    variant: "auth",
  },
} satisfies Record<string, Mapping>;

const tagsByName = new Map<string, Mapping>(Object.entries(TAGS));

const GENERIC_SERVER_MESSAGES = new Set([
  "Forbidden",
  "Unauthenticated",
  "Internal Server Error",
  "Request failed",
  "Something went wrong",
]);

const ErrorEnvelope = Schema.Struct({
  _tag: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  action: Schema.optional(Schema.Json),
  methods: Schema.optional(Schema.Json),
  requestId: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  error: Schema.optional(Schema.Unknown),
});

type ErrorEnvelope = typeof ErrorEnvelope.Type;

const isEnvelope = Schema.is(ErrorEnvelope);

const envelopeOf = (value: RaisedFailure | undefined): ErrorEnvelope | undefined =>
  isEnvelope(value) ? value : undefined;

const isString = Schema.is(Schema.String);

const messageOf = (error: RaisedFailure): string | undefined => {
  if (isString(error)) return error.trim() || undefined;

  const envelope = envelopeOf(error);

  if (envelope === undefined) return undefined;
  const message = envelope.message;

  if (isString(message) && message.trim()) return message.trim();
  const nested = envelope.error;

  if (isString(nested) && nested.trim()) return nested.trim();

  const nestedEnvelope = envelopeOf(isRaisedFailure(nested) ? nested : undefined);
  const nestedMessage = nestedEnvelope?.message;

  if (isString(nestedMessage) && nestedMessage.trim()) return nestedMessage.trim();

  return undefined;
};

const decodeJson = Schema.decodeUnknownOption(Schema.Json);

const parseJson = (value: string): Schema.Json | undefined => {
  const text = value.trim();

  if (!text.startsWith("{") && !text.startsWith("[")) return undefined;

  try {
    return Option.getOrUndefined(decodeJson(JSON.parse(text)));
  } catch {
    return undefined;
  }
};

export const errorTag = (error: RaisedFailure | undefined): string | undefined => {
  if (error === undefined) return undefined;

  if (isString(error)) {
    const parsed = parseJson(error);

    if (parsed !== undefined) return errorTag(parsed);

    return TAG_PATTERN.test(error.trim()) ? error.trim() : undefined;
  }

  const envelope = envelopeOf(error);

  if (envelope === undefined) return undefined;

  const nested = envelopeOf(isRaisedFailure(envelope.error) ? envelope.error : undefined);
  const outer = envelope._tag;

  // Envelopes (`{ _tag: "Failure", error: {…} }`) and transport wrappers carry
  // the domain tag one level down.
  if (
    isString(nested?._tag) &&
    (outer === "Failure" ||
      outer === "Success" ||
      outer === "HttpClientError" ||
      outer === undefined)
  )
    return nested._tag;

  if (isString(outer) && outer !== "Failure" && outer !== "Success") return outer;

  if (isString(nested?._tag)) return nested._tag;

  return undefined;
};

export type StepUpFailureFields = {
  readonly action?: Schema.Json | undefined;
  readonly methods?: Schema.Json | undefined;
};

const stepUpFields = (envelope: ErrorEnvelope | undefined): StepUpFailureFields => {
  const fields = new Map<"action" | "methods", Schema.Json>();

  if (envelope?.action !== undefined) fields.set("action", envelope.action);

  if (envelope?.methods !== undefined) fields.set("methods", envelope.methods);

  return { action: fields.get("action"), methods: fields.get("methods") };
};

/**
 * Read the step-up fields from a typed API failure. Effect's HTTP client wraps
 * the decoded body in `error`, and some transports only carry the serialized
 * message.
 */
export const stepUpFailure = (error: RaisedFailure | undefined): StepUpFailureFields => {
  if (error === undefined) return {};

  if (isString(error)) return stepUpFields(envelopeOf(parseJson(error)));

  const envelope = envelopeOf(error);

  if (envelope === undefined) return {};
  const own = stepUpFields(envelope);

  if (own.action !== undefined || own.methods !== undefined) return own;
  const nested = envelopeOf(isRaisedFailure(envelope.error) ? envelope.error : undefined);
  const fromNested = stepUpFields(nested);

  if (fromNested.action !== undefined || fromNested.methods !== undefined) return fromNested;
  const message = envelope.message;

  if (isString(message)) {
    const parsed = envelopeOf(parseJson(message));

    if (parsed !== undefined) {
      const fromMessage = stepUpFields(parsed);

      if (fromMessage.action !== undefined || fromMessage.methods !== undefined) {
        return fromMessage;
      }

      return stepUpFields(envelopeOf(isRaisedFailure(parsed.error) ? parsed.error : undefined));
    }
  }

  return {};
};

export type ApprovalFailureFields = {
  readonly requestId?: string;
  readonly status?: string;
};

const approvalFields = (envelope: ErrorEnvelope | undefined): ApprovalFailureFields => ({
  requestId: envelope?.requestId,
  status: envelope?.status,
});

/**
 * Read the approval handle from a typed API failure. `ApprovalRequired` is a
 * real tagged error, so the fields are usually at the top level; transport
 * wrappers put them under `error` and some add a serialized message.
 */
export const approvalFailure = (error: RaisedFailure | undefined): ApprovalFailureFields => {
  if (error === undefined) return {};

  if (isString(error)) return approvalFields(envelopeOf(parseJson(error)));

  const envelope = envelopeOf(error);

  if (envelope === undefined) return {};
  const own = approvalFields(envelope);

  if (own.requestId !== undefined) return own;
  const nested = envelopeOf(isRaisedFailure(envelope.error) ? envelope.error : undefined);
  const fromNested = approvalFields(nested);

  if (fromNested.requestId !== undefined) return fromNested;
  const message = envelope.message;

  if (isString(message)) {
    const parsed = envelopeOf(parseJson(message));

    if (parsed !== undefined) {
      const fromMessage = approvalFields(parsed);

      if (fromMessage.requestId !== undefined) return fromMessage;

      return approvalFields(envelopeOf(isRaisedFailure(parsed.error) ? parsed.error : undefined));
    }
  }

  return {};
};

const isTechnical = (message: string) =>
  /^(Decode error|HttpClientError|TypeError|FiberFailure|Error:)/i.test(message) ||
  /undeclared status code|https?:\/\/|at .+\(.+:\d+:\d+\)/i.test(message);

export const errorPresentation = (
  error: RaisedFailure | undefined,
  fallback = "Something went wrong. Try again.",
): ErrorPresentation => {
  const directTag = errorTag(error);
  const rawMessage =
    (error === undefined ? undefined : messageOf(error)) ?? (isString(error) ? error : undefined);
  const parsed = rawMessage ? parseJson(rawMessage) : undefined;
  const tag = directTag ?? errorTag(parsed) ?? (rawMessage ? errorTag(rawMessage) : undefined);

  const reason = envelopeOf(error)?.reason;

  if (tag === "NewPasswordRejected" && reason) {
    const message = Match.value(reason).pipe(
      Match.when("too-short", () => "Use at least 15 characters for your password."),
      Match.when("too-long", () => "That password is too long. Use a shorter passphrase."),
      Match.when(
        "compromised",
        () => "This password has appeared in a data breach. Choose another.",
      ),
      Match.when("common", () => "This password is too common. Choose something less predictable."),
      Match.orElse(() => "Choose a stronger, less predictable password."),
    );

    return { title: TITLES.validation, message, variant: "validation", tag };
  }

  const mapped = tag ? tagsByName.get(tag) : undefined;

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
        "EnterprisePermissionDenied",
        "EnterpriseNotConfigured",
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

export const errorMessage = (error: RaisedFailure | undefined, fallback?: string): string =>
  errorPresentation(error, fallback).message;
