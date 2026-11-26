import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import {
  BeginRegistrationVerificationResponse,
  CompleteRegistrationVerificationResponse,
  MeResponse,
  Permission,
} from "@mattrax/enterprise-domain/client";
import type { UpdateMeRequest } from "@mattrax/enterprise-domain/client";
import { Effect, Option, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { webHttpClientLayer } from "~/lib/web-http";
import { createSignal, isHydrating, onHydrationEnd, onSettled } from "solid-js";
import { getRequestEvent, isServer } from "@solidjs/web";
import { apiFetch } from "~/lib/auth-api.server";
import { errorMessage, errorTag, raisedFailure } from "~/lib/errors";
import { requireStepUpGrant, withStepUp } from "~/lib/step-up";
import { getPreloadedSession } from "~/lib/session-store";
import type { PreloadedSession as Session } from "~/lib/session-store";
import { capturePostHog } from "~/lib/posthog";
import { clearMeCache } from "~/lib/me-cache";
import { resetMePreload } from "~/lib/me-preload";
import { clearSessionPresence } from "~/lib/session-presence";
import { clearBrowserTenantDirectory, rememberTenants } from "~/lib/tenant";
import {
  passkeyAuthenticationFailure,
  passkeyEnvironmentAvailable,
  passkeyEnvironmentFailure,
  PasskeySignInError,
  startConditionalPasskey,
} from "~/lib/passkey-sign-in";

type AuthUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
};

type AuthResult<T = unknown> = Promise<{
  data?: T;
  error?: { message?: string; tag?: string };
}>;

/** The passkey registration claim sent to `beginPasskeyRegistration`. */
type RegistrationPayload = { name: string; email: string; grant?: string };

const PrivateReveal = Schema.Struct({
  kind: Schema.Literals(["totp-enrollment", "recovery-codes"]),
  revealId: Schema.String,
  expiresAtMillis: Schema.Number,
  payload: Schema.Json,
});

type PrivateReveal = typeof PrivateReveal.Type;

/** Payload for `/beginPasskeyEnrollment`; the proof is present when one was required. */
type PasskeyEnrollmentRequest = {
  flowId: string;
  commandId: string;
  profileId: string;
  name: string;
  actionProof?: string;
};

type AuthEnvelope<T> = {
  value: T;
  private?: readonly PrivateReveal[];
};

const TotpEnrollmentReveal = Schema.Struct({ manualKey: Schema.String, uri: Schema.String });

const body = (value: Schema.Json) => JSON.stringify(value);

const authBody = (value: Schema.Json) => body({ payload: value });

const withStepUpHeaders = (init: RequestInit, grant: string | undefined) => {
  if (grant) init.headers = { "x-mattrax-step-up": grant };

  return init;
};

const userFromSession = (session: Session | null | undefined): AuthUser | undefined =>
  session
    ? {
        id: session.subjectId,
        name: session.claims.name,
        email: session.claims.email,
        emailVerified: session.claims.emailVerified,
        image: null,
      }
    : undefined;

const Success = Schema.Struct({
  _tag: Schema.Literal("Success"),
  value: Schema.Unknown,
  private: Schema.optional(Schema.Array(PrivateReveal)),
});

const decodeSuccess = Schema.decodeUnknownOption(Success);

type AuthEnvelopeOptions = { readonly directSuccess?: boolean };

/**
 * Auth operations wrap responses in Success/Failure. Enterprise HttpApi routes
 * return their declared success schema directly.
 */
const hasDirectSuccessResponse = (path: string) =>
  path.startsWith("/v1/") ||
  path === "/register/verification" ||
  path === "/register/verification/verify";

const FailureFields = Schema.Struct({
  _tag: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  action: Schema.optional(Schema.String),
  methods: Schema.optional(Schema.Array(Schema.String)),
});

const FailureEnvelope = Schema.Struct({
  _tag: Schema.Literal("Failure"),
  message: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  action: Schema.optional(Schema.String),
  methods: Schema.optional(Schema.Array(Schema.String)),
  error: Schema.optional(FailureFields),
});

const DirectFailure = Schema.Struct({
  _tag: Schema.String,
  message: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  action: Schema.optional(Schema.String),
  methods: Schema.optional(Schema.Array(Schema.String)),
});

const decodeFailureEnvelope = Schema.decodeUnknownOption(FailureEnvelope);
const decodeDirectFailure = Schema.decodeUnknownOption(DirectFailure);

class AuthResponseError extends Schema.TaggedError<AuthResponseError>()("AuthResponseError", {
  message: Schema.String,
}) {}

const readAuthResponse = async (
  path: string,
  init: RequestInit,
): Promise<{ readonly status: number; readonly body: unknown }> => {
  const url = path.startsWith("/v1/") ? "/api" + path : "/api/v1" + path;
  const event = isServer ? getRequestEvent() : undefined;
  const headers = new Headers(init.headers);

  if (init.body) headers.set("content-type", "application/json");
  if (init.method && init.method !== "GET") headers.set("x-effect-auth-csrf", "1");
  if (event) {
    headers.set("origin", new URL(event.request.url).origin);
    const cookie = event.request.headers.get("cookie");

    if (cookie) headers.set("cookie", cookie);
    const response = await apiFetch(
      new Request(new URL(url, event.request.url), { ...init, headers }),
    );
    const body = Option.getOrUndefined(
      Schema.decodeUnknownOption(Schema.Json)(await response.json().catch(() => undefined)),
    );

    return { status: response.status, body };
  }

  const webRequest = new Request(url, {
    ...init,
    body: typeof init.body === "string" ? undefined : init.body,
    credentials: "include",
    headers,
  });
  const effectRequest = HttpClientRequest.fromWeb(webRequest);
  const request =
    typeof init.body === "string"
      ? HttpClientRequest.bodyText(effectRequest, init.body, "application/json")
      : effectRequest;
  const result = await Effect.runPromise(
    HttpClient.execute(request).pipe(
      Effect.flatMap((response) =>
        Effect.gen(function* () {
          const body = yield* HttpClientResponse.schemaBodyJson(Schema.Json)(response).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          );

          return { status: response.status, body };
        }),
      ),
      Effect.catch((error) =>
        Effect.fail(
          new AuthRequestError(
            error instanceof Error
              ? error.message
              : "The authentication service could not be reached",
          ),
        ),
      ),
      Effect.provide(webHttpClientLayer),
    ),
  );

  return result;
};

export const decodeAuthEnvelope = <S extends Schema.ConstraintDecoder<unknown, never>>(
  status: number,
  responseBody: unknown,
  schema: S,
  options: AuthEnvelopeOptions = {},
): AuthEnvelope<S["Type"]> => {
  const successful = status >= 200 && status < 300;
  const successEnvelope =
    responseBody === undefined ? undefined : Option.getOrUndefined(decodeSuccess(responseBody));
  const value =
    successEnvelope === undefined
      ? undefined
      : Option.getOrUndefined(Schema.decodeUnknownOption(schema)(successEnvelope.value));

  if (successful && successEnvelope && value !== undefined)
    return { value, private: successEnvelope.private };

  const failureEnvelope =
    responseBody === undefined
      ? undefined
      : Option.getOrUndefined(decodeFailureEnvelope(responseBody));
  const directFailure =
    responseBody === undefined
      ? undefined
      : Option.getOrUndefined(decodeDirectFailure(responseBody));
  const failure = failureEnvelope ?? (successful ? undefined : directFailure);

  if (
    successful &&
    options.directSuccess &&
    failureEnvelope === undefined &&
    directFailure === undefined &&
    responseBody !== undefined
  ) {
    const directValue = Option.getOrUndefined(Schema.decodeUnknownOption(schema)(responseBody));

    if (directValue !== undefined) return { value: directValue, private: undefined };
  }

  const fields = failureEnvelope
    ? {
        _tag: failureEnvelope._tag,
        ...(failureEnvelope.error ?? {}),
        message: failureEnvelope.error?.message ?? failureEnvelope.message,
        reason: failureEnvelope.error?.reason ?? failureEnvelope.reason,
        action: failureEnvelope.error?.action ?? failureEnvelope.action,
        methods: failureEnvelope.error?.methods ?? failureEnvelope.methods,
      }
    : failure;
  const tag = fields?._tag;
  const message = fields?.message;
  const reason = fields?.reason;

  if (!successful || failure) {
    const error = new AuthRequestError(
      errorMessage(raisedFailure({ _tag: tag, message, reason }), authFailureFallback(tag, status)),
    );

    if (tag) error._tag = tag;
    if (reason) error.reason = reason;
    if (fields?.action) error.action = fields.action;
    if (fields?.methods) error.methods = [...fields.methods];
    throw error;
  }

  throw new AuthResponseError({
    message: "The authentication service returned an invalid success response",
  });
};

async function requestEnvelope<S extends Schema.ConstraintDecoder<unknown, never>>(
  path: string,
  schema: S,
  init: RequestInit = {},
): Promise<AuthEnvelope<S["Type"]>> {
  const response = await readAuthResponse(path, init);

  return decodeAuthEnvelope(response.status, response.body, schema, {
    directSuccess: hasDirectSuccessResponse(path),
  });
}

class AuthRequestError extends Error {
  _tag?: string;
  reason?: string;
  action?: string;
  methods?: string[];
}

async function request<S extends Schema.ConstraintDecoder<unknown, never>>(
  path: string,
  schema: S,
  init: RequestInit = {},
): Promise<S["Type"]> {
  return (await requestEnvelope(path, schema, init)).value;
}

const result = async <T>(fn: () => Promise<T>): AuthResult<T> => {
  try {
    return { data: await fn() };
  } catch (error) {
    const raised = raisedFailure(error);

    // Keep the tagged reason so callers can distinguish a transient
    // PasskeyRejected (worth one retry) from a dismissed prompt.
    return { error: { message: errorMessage(raised), tag: errorTag(raised) } };
  }
};

type CompletionState = { user?: AuthUser; session?: Session; pending?: boolean };

const SessionPayload = Schema.Struct({
  sessionId: Schema.String,
  subjectId: Schema.String,
  claims: Schema.Struct({
    name: Schema.String,
    email: Schema.String,
    emailVerified: Schema.Boolean,
  }),
  /** The SSR shell snapshot; absent on a plain `getSession` answer. */
  me: Schema.optional(MeResponse),
});

const AuthenticatedCompletion = Schema.Struct({
  _tag: Schema.Literal("Authenticated"),
  session: SessionPayload,
});

const PendingCompletion = Schema.Struct({
  _tag: Schema.Literal("PendingAuthentication"),
});

const decodeAuthenticated = Schema.decodeUnknownOption(AuthenticatedCompletion);

const decodePending = Schema.decodeUnknownOption(PendingCompletion);

const ClientSessionGlobal = Schema.Struct({
  __MATTRAX_SESSION__: Schema.optional(Schema.NullOr(SessionPayload)),
});

const StatusOk = Schema.Struct({ status: Schema.Literal("ok") });

/**
 * The sign-out action answers with the session module's result, not the
 * Enterprise routes' `{status:"ok"}` acknowledgement. The transport still
 * clears this browser's session cookie; the value reports whether the
 * server-side session was revoked.
 *
 * `SessionSignOutUnavailable` is part of the action's declared success union
 * (a store outage that still clears the client credential), so a person is
 * signed out locally either way instead of being left on the dashboard.
 */
const SignOutResult = Schema.Struct({
  clearCredential: Schema.Literal(true),
  invalidation: Schema.Literals(["revoked", "already-invalid", "client-only"]),
});
const SignOutUnavailable = Schema.Struct({
  _tag: Schema.Literal("SessionSignOutUnavailable"),
  clearCredential: Schema.Literal(true),
});
const SignOutSuccess = Schema.Union([SignOutResult, SignOutUnavailable]);
const SessionResponse = Schema.NullOr(SessionPayload);
const CredentialDescriptor = Schema.Struct({
  type: Schema.Literal("public-key"),
  id: Schema.String,
  transports: Schema.optional(
    Schema.Array(
      Schema.Literals(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]),
    ),
  ),
});
const AuthenticatorSelection = Schema.Struct({
  authenticatorAttachment: Schema.optional(Schema.Literals(["cross-platform", "platform"])),
  residentKey: Schema.optional(Schema.Literals(["discouraged", "preferred", "required"])),
  requireResidentKey: Schema.optional(Schema.Boolean),
  userVerification: Schema.optional(Schema.Literals(["discouraged", "preferred", "required"])),
});
const CreationOptions = Schema.Struct({
  challenge: Schema.String,
  rp: Schema.Struct({ name: Schema.String, id: Schema.optional(Schema.String) }),
  user: Schema.Struct({ id: Schema.String, name: Schema.String, displayName: Schema.String }),
  pubKeyCredParams: Schema.Array(
    Schema.Struct({ type: Schema.Literal("public-key"), alg: Schema.Number }),
  ),
  timeout: Schema.optional(Schema.Number),
  excludeCredentials: Schema.optional(Schema.Array(CredentialDescriptor)),
  authenticatorSelection: Schema.optional(AuthenticatorSelection),
  hints: Schema.optional(
    Schema.Array(Schema.Literals(["hybrid", "security-key", "client-device"])),
  ),
  attestation: Schema.optional(Schema.Literals(["direct", "enterprise", "indirect", "none"])),
  attestationFormats: Schema.optional(
    Schema.Array(
      Schema.Literals([
        "fido-u2f",
        "packed",
        "android-safetynet",
        "android-key",
        "tpm",
        "apple",
        "none",
      ]),
    ),
  ),
  extensions: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
});
const RequestOptions = Schema.Struct({
  challenge: Schema.String,
  timeout: Schema.optional(Schema.Number),
  rpId: Schema.optional(Schema.String),
  allowCredentials: Schema.optional(Schema.Array(CredentialDescriptor)),
  userVerification: Schema.optional(Schema.Literals(["discouraged", "preferred", "required"])),
  hints: Schema.optional(
    Schema.Array(Schema.Literals(["hybrid", "security-key", "client-device"])),
  ),
  extensions: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
});
const PasskeyCreationStart = Schema.Struct({
  flowId: Schema.String,
  expiresAtMillis: Schema.Number,
  options: CreationOptions,
});
const PasskeyRequestStart = Schema.Struct({
  flowId: Schema.String,
  expiresAtMillis: Schema.Number,
  options: RequestOptions,
});

const mutableDescriptor = (credential: typeof CredentialDescriptor.Type) => ({
  ...credential,
  transports: credential.transports ? [...credential.transports] : undefined,
});

const toRequestOptions = (
  options: typeof RequestOptions.Type,
): PublicKeyCredentialRequestOptionsJSON => ({
  ...options,
  allowCredentials: options.allowCredentials?.map(mutableDescriptor),
  hints: options.hints ? [...options.hints] : undefined,
});

const toCreationOptions = (
  options: typeof CreationOptions.Type,
): PublicKeyCredentialCreationOptionsJSON => ({
  ...options,
  pubKeyCredParams: [...options.pubKeyCredParams],
  excludeCredentials: options.excludeCredentials?.map(mutableDescriptor),
  hints: options.hints ? [...options.hints] : undefined,
  attestationFormats: options.attestationFormats ? [...options.attestationFormats] : undefined,
});
const PasskeyCredential = Schema.Struct({
  credentialId: Schema.String,
  name: Schema.String,
  primarySignIn: Schema.Boolean,
  createdAtMillis: Schema.Number,
  lastUsedAtMillis: Schema.optional(Schema.Number),
});
const PasskeyList = Schema.Struct({
  credentials: Schema.Array(PasskeyCredential),
  cursor: Schema.optional(Schema.String),
});
const PasskeyEnrollmentComplete = Schema.Struct({ credential: PasskeyCredential });
const PasskeyRename = Schema.Struct({
  credential: Schema.Struct({ credentialId: Schema.String, name: Schema.String }),
});
const TotpBegin = Schema.Struct({ enrollmentId: Schema.String, expiresAtMillis: Schema.Number });
const TotpConfirm = Schema.Struct({ enabled: Schema.Boolean, invalidation: Schema.Json });
const TotpRegenerated = Schema.Struct({ enabled: Schema.Literal(true) });
const EmailVerification = Schema.Struct({
  status: Schema.Literal("ok"),
  challenge: Schema.optional(Schema.String),
  emailSent: Schema.optional(Schema.Boolean),
});
const ApiToken = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  tokenPrefix: Schema.String,
  scopes: Schema.Array(Schema.String),
  permissions: Schema.Array(Permission),
  tenantId: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  lastUsedAt: Schema.optional(Schema.NullOr(Schema.String)),
  expiresAt: Schema.optional(Schema.NullOr(Schema.String)),
  revokedAt: Schema.optional(Schema.NullOr(Schema.String)),
});
const ApiTokenList = Schema.Struct({ tokens: Schema.Array(ApiToken) });
const ApiTokenCreated = Schema.Struct({ token: Schema.String, item: ApiToken });

const completionState = (completion: Schema.Json): CompletionState => {
  const authenticated = Option.getOrUndefined(decodeAuthenticated(completion));

  if (authenticated !== undefined) {
    return {
      user: userFromSession(authenticated.session),
      session: authenticated.session,
    };
  }

  if (Option.isSome(decodePending(completion))) return { pending: true };
  throw new Error("Authentication did not complete");
};

type SessionStore = {
  data: () => Session | null | undefined;
  pending: () => boolean;
  load: () => Promise<void>;
  set: (session: Session | null) => void;
  ensureLoaded: () => void;
};

function createSessionStore(initial: Session | null | undefined): SessionStore {
  const [data, setData] = createSignal<Session | null | undefined>(initial);
  const [pending, setPending] = createSignal(initial === undefined);
  let started = false;

  const load = async () => {
    // The server renders this store's initial (pending) state. `/getSession`
    // can answer while the client is still claiming the document, and
    // publishing it mid-pass flips every session-dependent branch. That
    // changes the owner tree, so later hydration ids no longer match the
    // server markup. Hold the answer until the pass finishes; after hydration
    // this resolves immediately and behaves like a normal fetch.
    const hydrating = isHydrating();

    if (data() === undefined) setPending(true);

    let next: Session | null = null;
    let failed = false;

    try {
      next = await request("/getSession", SessionResponse, { method: "POST", body: "{}" });
    } catch {
      failed = true;
    }

    const settle = () => {
      if (failed) {
        if (data() === undefined) setData(null);

        setPending(false);

        return;
      }

      setData(next);
      setPending(false);

      if (next === null) {
        clearMeCache();
        resetMePreload();
        clearSessionPresence();
        clearBrowserTenantDirectory();
      } else rememberTenants(next.me?.tenants, next.subjectId);
    };

    if (hydrating) onHydrationEnd(settle);
    else settle();
  };

  return {
    data,
    pending,
    load,
    set: (session) => setData(session),
    ensureLoaded: () => {
      if (started) return;
      started = true;

      // A preloaded answer (including a signed-out one) already matches the
      // server render. Only ask the API when the server could not preload.
      if (data() === undefined) void load();
    },
  };
}

/** One store per request on the server and one per tab in the browser. */
let clientSessionStore: SessionStore | undefined;

function sessionStore(): SessionStore {
  if (isServer) {
    return createSessionStore(getPreloadedSession(getRequestEvent()!.request));
  }

  if (!clientSessionStore) {
    const stored = Option.getOrUndefined(
      Schema.decodeUnknownOption(ClientSessionGlobal)(globalThis),
    );

    clientSessionStore = createSessionStore(stored?.__MATTRAX_SESSION__);
  }

  return clientSessionStore;
}

/** Keep every hook in this tab in sync after a sign-in, MFA or sign-out. */
function commitSession(session: Session | null): void {
  if (isServer) return;
  sessionStore().set(session);

  // A rotated or cleared session invalidates the per-account `me` cache; the
  // next render must not show another identity. The SSR token is bound to the
  // session cookie and expires server-side when that cookie goes away.
  clearMeCache();

  if (session === null) {
    // A sign-out must not leave this tab's preloaded document payload around to
    // seed a re-sign-in. A refresh/MFA commit for the same account keeps it.
    resetMePreload();
    clearSessionPresence();
    clearBrowserTenantDirectory();
  } else rememberTenants(session.me?.tenants, session.subjectId);
}

const revealOf = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  envelope: AuthEnvelope<unknown>,
  kind: PrivateReveal["kind"],
): S["Type"] | undefined => {
  const payload = envelope.private?.find((item) => item.kind === kind)?.payload;

  return payload === undefined
    ? undefined
    : Option.getOrUndefined(Schema.decodeUnknownOption(schema)(payload));
};

/** Discoverable-credential sign-in shared by the login page and registration. */
const passkeySignInFlow = async (
  options: {
    /** Set for conditional UI; the caller aborts it on an email edit or unmount. */
    conditional?: AbortSignal;
  } = {},
): Promise<CompletionState> => {
  const environmentFailure = passkeyEnvironmentFailure();

  if (environmentFailure) throw environmentFailure;

  const started = await request("/beginPasskeySignIn", PasskeyRequestStart, {
    method: "POST",
    body: authBody({
      flowId: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
      profileId: "default",
    }),
  });

  if (options.conditional?.aborted)
    throw new PasskeySignInError("PasskeyCancelled", "Passkey sign-in was cancelled.");

  let response: unknown;

  try {
    if (options.conditional) {
      response = await startConditionalPasskey(
        toRequestOptions(started.options),
        options.conditional,
      );
    } else {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      response = await startAuthentication({
        // A registration follow-up should not leave the person staring at a
        // browser prompt for the server's full five-minute window.
        optionsJSON: {
          ...toRequestOptions(started.options),
          timeout: Math.min(started.options.timeout ?? 60_000, 60_000),
        },
        useBrowserAutofill: false,
      });
    }
  } catch (error) {
    if (error instanceof PasskeySignInError) throw error;

    throw passkeyAuthenticationFailure(error);
  }

  // An email edit or unmount may land while the browser is finishing the
  // assertion; never complete a ceremony the page has already abandoned.
  if (options.conditional?.aborted)
    throw new PasskeySignInError("PasskeyCancelled", "Passkey sign-in was cancelled.");

  const completion = await request("/completePasskeySignIn", Schema.Json, {
    method: "POST",
    body: authBody({ flowId: started.flowId, response: JSON.stringify(response) }),
  });

  const state = completionState(completion);

  if (!state.user && !state.pending) throw new Error("Authentication did not complete");

  if (state.session) commitSession(state.session);

  return state;
};

/**
 * Human copy for the tagged auth failures that arrive without a message.
 *
 * Passkey ceremonies answer with a tag and nothing else; falling back to one
 * vague sentence left people with no next step and no way to tell us which
 * stage broke. Each case names the likely cause and the action that fixes it.
 */
const authFailureFallback = (tag: string | undefined, status: number) => {
  if (status === 429) return "Too many attempts. Wait a minute and try again.";

  switch (tag) {
    case "PasskeyProtocolRejected":
      return "That passkey couldn't be verified. If your password manager saved it, delete that entry and try again.";
    case "PasskeyUnavailable":
      return "Mattrax couldn't complete the passkey step. Request a new code and try again. If it keeps happening, try a different browser or password manager.";
    case "PasskeyRejected":
      return "That passkey wasn't accepted. Try again.";
    case "PasskeyActionRequired":
      return "Confirm this action with your authenticator, then try again.";
    case "PasskeyMethodUnsupported":
      return "This browser can't create passkeys. Try another browser, or use your device's own passkey prompt.";
    case "PasskeyConfigurationError":
      return "Passkeys aren't configured correctly for this deployment. Ask an administrator.";
    default:
      return "We couldn't complete that request. Try again.";
  }
};

/**
 * Why `navigator.credentials.create` handed back no passkey.
 *
 * Password-manager extensions fail through the same handful of DOMExceptions
 * as a platform authenticator, but the way out differs: a wallet that already
 * holds a credential for this account throws `InvalidStateError`, and a
 * provider that could not save leaves nothing behind. Name the case instead of
 * telling someone to try the same thing again.
 */
const passkeyCreationFailure = (cause: unknown) => {
  switch (cause instanceof DOMException ? cause.name : undefined) {
    case "InvalidStateError":
      return "Your device or password manager already has a passkey for Mattrax. Delete it there, then try again.";
    case "NotAllowedError":
      return "The passkey prompt was dismissed or timed out. Try again.";
    case "SecurityError":
      return "Passkeys can't be created on this address. Open Mattrax on its normal address and try again.";
    case "NotSupportedError":
      return "This browser or password manager can't create passkeys. Try another browser, or use your device's own passkey prompt.";
    case "AbortError":
      return "The passkey prompt was cancelled. Try again and approve the prompt.";
    case "ConstraintError":
      return "That authenticator doesn't meet Mattrax's passkey requirements. Try another authenticator.";
    case "UnknownError":
      return "The authenticator could not create the passkey. Try another authenticator, or restart your browser.";
    default:
      return "That passkey wasn't created. Check that your browser and password manager support passkeys, then try again.";
  }
};

export const authClient = {
  useSession: () => {
    const store = sessionStore();
    onSettled(store.ensureLoaded);

    const accessor = () => ({
      data: { user: userFromSession(store.data() ?? undefined) },
      isPending: store.pending(),
      refetch: store.load,
    });

    return accessor;
  },
  /**
   * Create an account with its first passkey, then sign in with it. The
   * registration and credential are committed together; the account cannot
   * exist without a passkey.
   */
  register: (payload: { name: string; email: string; grant?: string }) =>
    result(async () => {
      if (!passkeyEnvironmentAvailable())
        throw new Error(
          "Passkeys need a secure browser with WebAuthn support. Open Mattrax over HTTPS in a current browser and try again.",
        );

      const registration: RegistrationPayload = {
        name: payload.name,
        email: payload.email,
      };

      if (payload.grant !== undefined) registration.grant = payload.grant;

      let started: typeof PasskeyCreationStart.Type;

      try {
        started = await request("/beginPasskeyRegistration", PasskeyCreationStart, {
          method: "POST",
          body: authBody({
            flowId: crypto.randomUUID(),
            commandId: crypto.randomUUID(),
            profileId: "default",
            registration,
          }),
        });
      } catch (error) {
        if (error instanceof AuthRequestError && error._tag === "PasskeyUnavailable")
          throw new Error(
            "Mattrax couldn't start passkey setup. Request a new code and try again. If it keeps happening, try a different browser.",
            { cause: error },
          );

        throw error;
      }

      let response: unknown;

      try {
        const { startRegistration } = await import("@simplewebauthn/browser");
        response = await startRegistration({ optionsJSON: toCreationOptions(started.options) });
      } catch (error) {
        throw new Error(passkeyCreationFailure(error), { cause: error });
      }

      try {
        await request("/completePasskeyRegistration", Schema.Unknown, {
          method: "POST",
          body: authBody({ flowId: started.flowId, response: JSON.stringify(response) }),
        });
      } catch (error) {
        if (error instanceof AuthRequestError && error._tag === "PasskeyUnavailable")
          throw new Error(
            "Your authenticator created a passkey, but Mattrax couldn't save it. Try again. If it repeats, remove the Mattrax passkey from your password manager and use another browser.",
            { cause: error },
          );

        throw error;
      }

      capturePostHog("auth_registered", { method: "passkey" });

      // The registration ceremony does not issue a session, but an earlier
      // step or a retried request may have already established one. Check
      // first, then sign in once with the credential that was just created.
      const signedIn = await request("/me", Schema.Unknown)
        .then(() => true)
        .catch(() => false);

      if (signedIn) return { signedIn: true };

      // One explicit sign-in with the credential that was just created. The
      // registration ceremony does not issue a session, so a second prompt is
      // expected; retrying a dismissed prompt only spams the person. The
      // account and passkey exist either way, so callers send them to the
      // sign-in page when this does not take.
      try {
        await passkeySignInFlow();

        return { signedIn: true };
      } catch {
        return { signedIn: false };
      }
    }),
  ssoSignIn: (token: string) =>
    result(async () => {
      const completion = await request("/ssoSignIn", Schema.Json, {
        method: "POST",
        body: authBody({ token }),
      });

      const state = completionState(completion);

      if (!state.user && !state.pending) throw new Error("Additional authentication is required");

      if (state.session) commitSession(state.session);

      return state;
    }),
  /**
   * Guest sign-up verification. Public endpoints on the auth surface, so they
   * use the same transport and error envelope as registration itself.
   *
   * `token`/`nonce` are present only when the browser filled the Email
   * Verification API hidden input. The server falls back to the emailed code
   * whenever they are absent or fail to verify.
   */
  requestRegistrationCode: (payload: {
    name: string;
    email: string;
    token?: string;
    nonce?: string;
  }) =>
    result(async () =>
      request("/register/verification", BeginRegistrationVerificationResponse, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    ),
  verifyRegistrationCode: (payload: { email: string; code: string }) =>
    result(async () =>
      request("/register/verification/verify", CompleteRegistrationVerificationResponse, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    ),
  /** The committed server session, for identity checks after a ceremony. */
  session: () =>
    result(async () => request("/getSession", SessionResponse, { method: "POST", body: "{}" })),
  signOut: () =>
    result(async () => {
      await request("/signOut", SignOutSuccess, { method: "POST", body: "{}" });
      commitSession(null);

      return { status: "ok" as const };
    }),
  verifyTotpPending: (code: string) =>
    result(async () => {
      const completion = await request("/verifyTotpPending", Schema.Json, {
        method: "POST",
        body: authBody({ code }),
      });

      const state = completionState(completion);

      if (state.session) commitSession(state.session);

      return state;
    }),
  /**
   * Passkey sign-in is a discoverable-credential ceremony. Begin issues a
   * request-binding cookie; only the WebAuthn response travels back. Passing a
   * signal runs it as conditional UI, where the browser offers saved passkeys
   * inline and the caller owns cancellation.
   */
  passkeySignIn: async (options?: { conditional?: AbortSignal }): AuthResult<CompletionState> => {
    try {
      return { data: await passkeySignInFlow(options) };
    } catch (error) {
      if (error instanceof PasskeySignInError)
        return { error: { message: error.message, tag: error.tag } };

      const raised = raisedFailure(error);

      return { error: { message: errorMessage(raised), tag: errorTag(raised) } };
    }
  },
  /** Complete a pending SSO sign-in with a passkey. */
  passkeyPending: () =>
    result(async () => {
      const started = await request("/beginPasskeyPending", PasskeyRequestStart, {
        method: "POST",
        body: authBody({
          flowId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          profileId: "default",
        }),
      });

      let response: unknown;

      try {
        const { startAuthentication } = await import("@simplewebauthn/browser");
        response = await startAuthentication({
          optionsJSON: toRequestOptions(started.options),
          useBrowserAutofill: false,
        });
      } catch (error) {
        throw passkeyAuthenticationFailure(error);
      }

      const completion = await request("/completePasskeyPending", Schema.Json, {
        method: "POST",
        body: authBody({ flowId: started.flowId, response: JSON.stringify(response) }),
      });

      const state = completionState(completion);

      if (state.session) commitSession(state.session);

      return state;
    }),
  listPasskeys: () =>
    result(() =>
      request("/listPasskeys", PasskeyList, { method: "POST", body: authBody({ limit: 64 }) }),
    ),
  /**
   * Add a passkey.
   *
   * A step-up is required when the account already has one, because the new key
   * must be authorised by existing possession. An account with no passkey yet
   * (an SSO-only member meeting a tenant MFA requirement) cannot step up at all,
   * so the library authorises the enrolment from the session's own fresh
   * evidence instead.
   */
  addPasskey: (name: string, options: { firstPasskey?: boolean } = {}) =>
    result(async () => {
      const actionProof = options.firstPasskey
        ? undefined
        : await requireStepUpGrant("passkey-enroll");

      const enrollment: PasskeyEnrollmentRequest = {
        flowId: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        profileId: "default",
        name,
      };

      if (actionProof !== undefined) enrollment.actionProof = actionProof;

      const started = await request("/beginPasskeyEnrollment", PasskeyCreationStart, {
        method: "POST",
        body: authBody(enrollment),
      });

      let response: unknown;

      try {
        const { startRegistration } = await import("@simplewebauthn/browser");
        response = await startRegistration({ optionsJSON: toCreationOptions(started.options) });
      } catch (error) {
        throw new Error(passkeyCreationFailure(error), { cause: error });
      }

      return request("/completePasskeyEnrollment", PasskeyEnrollmentComplete, {
        method: "POST",
        body: authBody({ flowId: started.flowId, response: JSON.stringify(response) }),
      });
    }),
  renamePasskey: (payload: { credentialId: string; name: string }) =>
    result(() =>
      request("/renamePasskey", PasskeyRename, {
        method: "POST",
        body: authBody({ commandId: crypto.randomUUID(), ...payload }),
      }),
    ),
  removePasskey: (credentialId: string) =>
    result(() =>
      withStepUp("passkey-remove", (grant) =>
        request(
          `/v1/account/passkeys/${encodeURIComponent(credentialId)}`,
          StatusOk,
          withStepUpHeaders({ method: "DELETE" }, grant),
        ),
      ),
    ),
  recoverTotpPending: (code: string) =>
    result(async () => {
      const completion = await request("/recoverTotpPending", Schema.Json, {
        method: "POST",
        body: authBody({ code }),
      });

      const state = completionState(completion);

      if (state.session) commitSession(state.session);

      return state;
    }),
  beginTotpEnrollment: (accountName: string) =>
    result(async () => {
      const actionProof = await requireStepUpGrant("mfa-enroll");

      const envelope = await requestEnvelope("/beginTotpEnrollment", TotpBegin, {
        method: "POST",
        body: authBody({ commandId: crypto.randomUUID(), accountName, actionProof }),
      });

      const reveal = revealOf(TotpEnrollmentReveal, envelope, "totp-enrollment");

      if (!reveal) throw new Error("The authenticator enrollment details were not returned");

      return { ...envelope.value, ...reveal };
    }),
  confirmTotpEnrollment: (payload: { enrollmentId: string; code: string }) =>
    result(async () => {
      const actionProof = await requireStepUpGrant("mfa-enroll");

      const envelope = await requestEnvelope("/confirmTotpEnrollment", TotpConfirm, {
        method: "POST",
        body: authBody({ commandId: crypto.randomUUID(), ...payload, actionProof }),
      });

      return {
        ...envelope.value,
        recoveryCodes: revealOf(Schema.Array(Schema.String), envelope, "recovery-codes") ?? [],
      };
    }),
  regenerateTotpRecoveryCodes: (proof: { code: string }) =>
    result(async () => {
      const grant = await requireStepUpGrant("mfa-regenerate");

      const envelope = await requestEnvelope("/regenerateTotpRecoveryCodes", TotpRegenerated, {
        method: "POST",
        body: authBody({
          commandId: crypto.randomUUID(),
          actionProof: JSON.stringify({ grant, code: proof.code }),
        }),
      });

      return {
        ...envelope.value,
        recoveryCodes: revealOf(Schema.Array(Schema.String), envelope, "recovery-codes") ?? [],
      };
    }),
  disableTotp: (proof: { code: string }) =>
    result(async () => {
      const grant = await requireStepUpGrant("mfa-disable");

      return request("/disableTotp", TotpConfirm, {
        method: "POST",
        body: authBody({
          commandId: crypto.randomUUID(),
          actionProof: JSON.stringify({ grant, code: proof.code }),
        }),
      });
    }),
  /**
   * Exchange a break-glass recovery completion token for a session. The token
   * was minted only after the account proved control of its verified address
   * (and, for a shared tenant, another owner approved), and it is single use.
   */
  recoverySignIn: (token: string) =>
    result(async () => {
      const completion = await request("/recoverySignIn", Schema.Json, {
        method: "POST",
        body: authBody({ token }),
      });

      const state = completionState(completion);

      if (!state.user && !state.pending)
        throw new Error("That recovery link is invalid or has expired.");

      if (state.session) commitSession(state.session);

      return state;
    }),
  updateUser: (payload: UpdateMeRequest) =>
    result(() => request("/v1/me", StatusOk, { method: "PATCH", body: body(payload) })),
  requestEmailVerification: () =>
    result(() =>
      request("/v1/account/email-verification", EmailVerification, {
        method: "POST",
        body: "{}",
      }),
    ),
  verifyEmail: (payload: { token?: string; code?: string; challenge?: string }) =>
    result(async () => {
      await request("/v1/verify-email", StatusOk, {
        method: "POST",
        body: body(payload),
      });
      clearMeCache();

      return { status: "ok" as const };
    }),
  /**
   * Changing the address is an account-takeover primitive, so it needs a recent
   * factor proof. The current address is also notified and can cancel.
   */
  changeEmail: (payload: { newEmail: string; callbackURL?: string }) =>
    result(() =>
      withStepUp("email-change", (grant) =>
        request(
          "/v1/account/email-change",
          StatusOk,
          withStepUpHeaders({ method: "POST", body: body({ newEmail: payload.newEmail }) }, grant),
        ),
      ),
    ),
  /** Cancel a pending change from the link mailed to the old address. */
  cancelEmailChange: (token: string) =>
    result(async () => {
      await request("/v1/account/email-change/cancel", StatusOk, {
        method: "POST",
        body: body({ token }),
      });
      clearMeCache();

      return { status: "ok" as const };
    }),
  verifyEmailChange: (payload: { token: string }) =>
    result(async () => {
      await request("/v1/account/email-change/verify", StatusOk, {
        method: "POST",
        body: body(payload),
      });
      clearMeCache();

      return { status: "ok" as const };
    }),
  listApiTokens: () => request("/v1/account/api-tokens", ApiTokenList),
  createApiToken: (payload: {
    name: string;
    expiresAt?: string | null;
    scopes?: string[];
    permissions?: Permission[];
    tenantId?: string | null;
  }) =>
    withStepUp("api-token-create", (grant) =>
      request(
        "/v1/account/api-tokens",
        ApiTokenCreated,
        withStepUpHeaders({ method: "POST", body: body(payload) }, grant),
      ),
    ),
  revokeApiToken: (tokenId: string) =>
    withStepUp("api-token-revoke", (grant) =>
      request(
        `/v1/account/api-tokens/${tokenId}`,
        StatusOk,
        withStepUpHeaders({ method: "DELETE" }, grant),
      ),
    ),
};
