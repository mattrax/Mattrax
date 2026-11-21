import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { MeResponse } from "@mattrax/enterprise-domain/client";
import type { Permission, UpdateMeRequest } from "@mattrax/enterprise-domain/client";
import { Option, Schema } from "effect";
import { createSignal, isHydrating, onHydrationEnd, onSettled } from "solid-js";
import { getRequestEvent, isServer } from "@solidjs/web";
import { apiFetch } from "~/lib/auth-api.server";
import { errorMessage, errorTag, raisedFailure } from "~/lib/errors";
import { requireStepUpGrant, withStepUp } from "~/lib/step-up";
import { getPreloadedSession } from "~/lib/session-store";
import type { PreloadedSession as Session } from "~/lib/session-store";
import { capturePostHog } from "~/lib/posthog";
import { clearMeCache } from "~/lib/me-cache";
import { clearSessionPresence } from "~/lib/session-presence";

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
  private?: PrivateReveal[];
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

async function requestEnvelope<T>(path: string, init: RequestInit = {}): Promise<AuthEnvelope<T>> {
  const url = path.startsWith("/v1/") ? `/api${path}` : `/api/v1${path}`;
  const event = isServer ? getRequestEvent() : undefined;
  const headers = new Headers(init.headers);

  if (init.body) headers.set("content-type", "application/json");

  if (init.method && init.method !== "GET") headers.set("x-effect-auth-csrf", "1");

  if (event) headers.set("origin", new URL(event.request.url).origin);

  let response: Response;

  if (event) {
    const cookie = event.request.headers.get("cookie");

    if (cookie) headers.set("cookie", cookie);
    response = await apiFetch(new Request(new URL(url, event.request.url), { ...init, headers }));
  } else {
    response = await fetch(url, { ...init, credentials: "include", headers });
  }

  // SAFETY: the auth API always sends JSON; `T` is the caller-declared
  // response contract for the endpoint path it passes to `requestEnvelope`.
  const data = (await response.json().catch(() => undefined)) as
    | {
        _tag?: string;
        value?: T;
        private?: PrivateReveal[];
        message?: string;
        reason?: string;
        action?: string;
        methods?: string[];
        error?: { _tag?: string; message?: string; reason?: string };
      }
    | undefined;

  if (data?._tag === "Failure" || !response.ok) {
    // Auth actions wrap failures in a `Failure` envelope; the Enterprise API
    // returns the tagged error directly. Accept both so step-up retries work.
    const direct = data?._tag !== "Failure" && data?._tag !== "Success" ? data?._tag : undefined;
    const tag = data?.error?._tag ?? direct;
    const message = data?.error?.message ?? data?.message;
    const reason = data?.error?.reason ?? data?.reason;

    const error = new AuthRequestError(
      errorMessage(
        raisedFailure({ _tag: tag, message, reason }),
        authFailureFallback(tag, response.status),
      ),
    );

    if (tag) error._tag = tag;

    if (reason) error.reason = reason;

    if (data?.action) error.action = data.action;

    if (data?.methods) error.methods = data.methods;
    throw error;
  }

  // SAFETY: `T` is the response contract declared by this call site; a
  // `Success` envelope carries that same value under `value`.
  return {
    value: (data !== undefined && isSuccessEnvelope(data) ? data.value : data) as T,
    private: data?.private,
  };
}

class AuthRequestError extends Error {
  _tag?: string;
  reason?: string;
  action?: string;
  methods?: string[];
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await requestEnvelope<T>(path, init)).value;
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

const SuccessEnvelope = Schema.Struct({ _tag: Schema.Literal("Success") });

const isSuccessEnvelope = Schema.is(SuccessEnvelope);

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
      next = await request<Session | null>("/getSession", { method: "POST", body: "{}" });
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
        clearSessionPresence();
      }
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

  if (session === null) clearSessionPresence();
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
const passkeySignInFlow = async (): Promise<CompletionState> => {
  const started = await request<{
    flowId: string;
    expiresAtMillis: number;
    options: PublicKeyCredentialRequestOptionsJSON;
  }>("/beginPasskeySignIn", {
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
      optionsJSON: started.options,
      useBrowserAutofill: false,
    });
  } catch {
    // The browser/OS prompt was dismissed or timed out. No tag: callers only
    // retry a server-tagged PasskeyRejected, so a deliberate cancellation is
    // never re-prompted.
    throw new Error("That passkey wasn't confirmed. Try again.");
  }

  const completion = await request<Schema.Json>("/completePasskeySignIn", {
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
      return "Passkeys aren't available right now. Try again in a moment.";
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
    default:
      return "That passkey wasn't created. Try again.";
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
      const registration: RegistrationPayload = {
        name: payload.name,
        email: payload.email,
      };

      if (payload.grant !== undefined) registration.grant = payload.grant;

      const started = await request<{
        flowId: string;
        expiresAtMillis: number;
        options: PublicKeyCredentialCreationOptionsJSON;
      }>("/beginPasskeyRegistration", {
        method: "POST",
        body: authBody({
          flowId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          profileId: "default",
          registration,
        }),
      });

      let response: unknown;

      try {
        const { startRegistration } = await import("@simplewebauthn/browser");
        response = await startRegistration({ optionsJSON: started.options });
      } catch (error) {
        throw new Error(passkeyCreationFailure(error), { cause: error });
      }

      await request("/completePasskeyRegistration", {
        method: "POST",
        body: authBody({ flowId: started.flowId, response: JSON.stringify(response) }),
      });

      capturePostHog("auth_registered", { method: "passkey" });

      // Completing the registration normally establishes the session itself.
      // Only sign in separately when it did not: the freshly created
      // discoverable credential can still be rejected for a moment, and a
      // redundant ceremony is the least reliable part of the flow.
      const signedIn = await request("/me")
        .then(() => true)
        .catch(() => false);

      if (signedIn) return { signedIn: true };

      // Some authenticators still need a moment before the newly created
      // discoverable credential is offered for a separate sign-in, so retry a
      // transient rejection. A permanent failure or a dismissed prompt must
      // surface immediately.
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          await passkeySignInFlow();

          return { signedIn: true };
        } catch {
          // The registration sheet has just closed, so the follow-up prompt
          // can be dismissed or find the credential before the browser is
          // ready. The ceremony is idempotent; this loop is not user-driven.
          await new Promise((resolve) => {
            setTimeout(resolve, 500);
          });
        }
      }

      const signedInAfterRetries = await request("/me")
        .then(() => true)
        .catch(() => false);

      // The account and passkey exist either way. Callers send the person to
      // sign in explicitly instead of failing an account that was created.
      return { signedIn: signedInAfterRetries };
    }),
  ssoSignIn: (token: string) =>
    result(async () => {
      const completion = await request<Schema.Json>("/ssoSignIn", {
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
   */
  requestRegistrationCode: (payload: { name: string; email: string }) =>
    result(async () =>
      request<{ status: "ok"; emailSent: boolean }>("/register/verification", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    ),
  verifyRegistrationCode: (payload: { email: string; code: string }) =>
    result(async () =>
      request<{ grant: string }>("/register/verification/verify", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    ),
  /** The committed server session, for identity checks after a ceremony. */
  session: () =>
    result(async () => request<Session | null>("/getSession", { method: "POST", body: "{}" })),
  signOut: () =>
    result(async () => {
      await request("/signOut", { method: "POST", body: "{}" });
      commitSession(null);

      return { status: "ok" as const };
    }),
  verifyTotpPending: (code: string) =>
    result(async () => {
      const completion = await request<Schema.Json>("/verifyTotpPending", {
        method: "POST",
        body: authBody({ code }),
      });

      const state = completionState(completion);

      if (state.session) commitSession(state.session);

      return state;
    }),
  /**
   * Passkey sign-in is a discoverable-credential ceremony. Begin issues a
   * request-binding cookie; only the WebAuthn response travels back.
   */
  passkeySignIn: () => result(passkeySignInFlow),
  /** Complete a pending SSO sign-in with a passkey. */
  passkeyPending: () =>
    result(async () => {
      const started = await request<{
        flowId: string;
        expiresAtMillis: number;
        options: PublicKeyCredentialRequestOptionsJSON;
      }>("/beginPasskeyPending", {
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
          optionsJSON: started.options,
          useBrowserAutofill: false,
        });
      } catch {
        throw new Error("That passkey wasn't confirmed. Try again or use a code.");
      }

      const completion = await request<Schema.Json>("/completePasskeyPending", {
        method: "POST",
        body: authBody({ flowId: started.flowId, response: JSON.stringify(response) }),
      });

      const state = completionState(completion);

      if (state.session) commitSession(state.session);

      return state;
    }),
  listPasskeys: () =>
    result(() =>
      request<{
        credentials: Array<{
          credentialId: string;
          name: string;
          primarySignIn: boolean;
          createdAtMillis: number;
          lastUsedAtMillis?: number;
        }>;
        cursor?: string;
      }>("/listPasskeys", { method: "POST", body: authBody({ limit: 64 }) }),
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

      const started = await request<{
        flowId: string;
        expiresAtMillis: number;
        options: PublicKeyCredentialCreationOptionsJSON;
      }>("/beginPasskeyEnrollment", { method: "POST", body: authBody(enrollment) });

      let response: unknown;

      try {
        const { startRegistration } = await import("@simplewebauthn/browser");
        response = await startRegistration({ optionsJSON: started.options });
      } catch (error) {
        throw new Error(passkeyCreationFailure(error), { cause: error });
      }

      return request<{
        credential: {
          credentialId: string;
          name: string;
          primarySignIn: boolean;
          createdAtMillis: number;
          lastUsedAtMillis?: number;
        };
      }>("/completePasskeyEnrollment", {
        method: "POST",
        body: authBody({ flowId: started.flowId, response: JSON.stringify(response) }),
      });
    }),
  renamePasskey: (payload: { credentialId: string; name: string }) =>
    result(() =>
      request<{ credential: { credentialId: string; name: string } }>("/renamePasskey", {
        method: "POST",
        body: authBody({ commandId: crypto.randomUUID(), ...payload }),
      }),
    ),
  removePasskey: (credentialId: string) =>
    result(() =>
      withStepUp("passkey-remove", (grant) =>
        request<{ status: "ok" }>(
          `/v1/account/passkeys/${encodeURIComponent(credentialId)}`,
          withStepUpHeaders({ method: "DELETE" }, grant),
        ),
      ),
    ),
  recoverTotpPending: (code: string) =>
    result(async () => {
      const completion = await request<Schema.Json>("/recoverTotpPending", {
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

      const envelope = await requestEnvelope<{ enrollmentId: string; expiresAtMillis: number }>(
        "/beginTotpEnrollment",
        {
          method: "POST",
          body: authBody({ commandId: crypto.randomUUID(), accountName, actionProof }),
        },
      );

      const reveal = revealOf(TotpEnrollmentReveal, envelope, "totp-enrollment");

      if (!reveal) throw new Error("The authenticator enrollment details were not returned");

      return { ...envelope.value, ...reveal };
    }),
  confirmTotpEnrollment: (payload: { enrollmentId: string; code: string }) =>
    result(async () => {
      const actionProof = await requireStepUpGrant("mfa-enroll");

      const envelope = await requestEnvelope<{
        enabled: boolean;
        invalidation: Schema.Json;
      }>("/confirmTotpEnrollment", {
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

      const envelope = await requestEnvelope<{ enabled: true }>("/regenerateTotpRecoveryCodes", {
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

      return request<{ enabled: boolean; invalidation: unknown }>("/disableTotp", {
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
      const completion = await request<Schema.Json>("/recoverySignIn", {
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
    result(() => request<{ status: "ok" }>("/v1/me", { method: "PATCH", body: body(payload) })),
  requestEmailVerification: () =>
    result(() =>
      request<{ status: "ok"; challenge?: string; emailSent?: boolean }>(
        "/v1/account/email-verification",
        {
          method: "POST",
          body: "{}",
        },
      ),
    ),
  verifyEmail: (payload: { token?: string; code?: string; challenge?: string }) =>
    result(async () => {
      await request<{ status: "ok" }>("/v1/verify-email", {
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
        request<{ status: "ok" }>(
          "/v1/account/email-change",
          withStepUpHeaders({ method: "POST", body: body({ newEmail: payload.newEmail }) }, grant),
        ),
      ),
    ),
  /** Cancel a pending change from the link mailed to the old address. */
  cancelEmailChange: (token: string) =>
    result(async () => {
      await request<{ status: "ok" }>("/v1/account/email-change/cancel", {
        method: "POST",
        body: body({ token }),
      });
      clearMeCache();

      return { status: "ok" as const };
    }),
  verifyEmailChange: (payload: { token: string }) =>
    result(async () => {
      await request<{ status: "ok" }>("/v1/account/email-change/verify", {
        method: "POST",
        body: body(payload),
      });
      clearMeCache();

      return { status: "ok" as const };
    }),
  listApiTokens: () =>
    request<{
      tokens: Array<{
        id: string;
        name: string;
        tokenPrefix: string;
        scopes: string[];
        permissions: Permission[];
        tenantId?: string | null;
        createdAt: string;
        updatedAt: string;
        lastUsedAt?: string | null;
        expiresAt?: string | null;
        revokedAt?: string | null;
      }>;
    }>("/v1/account/api-tokens"),
  createApiToken: (payload: {
    name: string;
    expiresAt?: string | null;
    scopes?: string[];
    permissions?: Permission[];
    tenantId?: string | null;
  }) =>
    withStepUp("api-token-create", (grant) =>
      request<{
        token: string;
        item: {
          id: string;
          name: string;
          tokenPrefix: string;
          scopes: string[];
          permissions: Permission[];
          tenantId?: string | null;
          createdAt: string;
          updatedAt: string;
          lastUsedAt?: string | null;
          expiresAt?: string | null;
          revokedAt?: string | null;
        };
      }>(
        "/v1/account/api-tokens",
        withStepUpHeaders({ method: "POST", body: body(payload) }, grant),
      ),
    ),
  revokeApiToken: (tokenId: string) =>
    withStepUp("api-token-revoke", (grant) =>
      request<{ status: "ok" }>(
        `/v1/account/api-tokens/${tokenId}`,
        withStepUpHeaders({ method: "DELETE" }, grant),
      ),
    ),
};
