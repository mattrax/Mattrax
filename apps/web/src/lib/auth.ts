import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { MeResponse } from "@mattrax/enterprise-domain/client";
import { Option, Schema } from "effect";
import { createSignal, isHydrating, onHydrationEnd, onSettled } from "solid-js";
import { getRequestEvent, isServer } from "@solidjs/web";
import { apiFetch } from "~/lib/auth-api.server";
import { errorMessage, errorTag, raisedFailure } from "~/lib/errors";
import { requireStepUpGrant, withStepUp } from "~/lib/step-up";
import {
  getPreloadedSession,
  type PreloadedSession as Session,
} from "~/lib/session-store";
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

type AuthResult<T = unknown> = Promise<{ data?: T; error?: { message?: string } }>;

const PrivateReveal = Schema.Struct({
  kind: Schema.Literals(["totp-enrollment", "recovery-codes"]),
  revealId: Schema.String,
  expiresAtMillis: Schema.Number,
  payload: Schema.Json,
});

type PrivateReveal = typeof PrivateReveal.Type;

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
        response.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "We couldn't complete that request. Try again.",
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
    return { error: { message: errorMessage(raisedFailure(error)) } };
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
  register: (payload: { name: string; email: string }) =>
    result(async () => {
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
          registration: { name: payload.name, email: payload.email },
        }),
      });

      let response: unknown;

      try {
        const { startRegistration } = await import("@simplewebauthn/browser");
        response = await startRegistration({ optionsJSON: started.options });
      } catch {
        throw new Error("That passkey wasn't created. Try again.");
      }

      await request("/completePasskeyRegistration", {
        method: "POST",
        body: authBody({ flowId: started.flowId, response: JSON.stringify(response) }),
      });

      capturePostHog("auth_registered", { method: "passkey" });

      // Some authenticators need a moment before the freshly created
      // discoverable credential is offered again. Retry only the transient
      // rejection so a real ceremony failure still surfaces.
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return await passkeySignInFlow();
        } catch (error) {
          if (errorTag(raisedFailure(error)) !== "PasskeyRejected" || attempt === 3) throw error;

          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
      }

      throw new Error("Could not sign in with the new passkey");
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
   * Add a passkey. The step-up grant doubles as the library's action proof, so
   * enrollment is authorised by recent possession rather than a bare session.
   */
  addPasskey: (name: string) =>
    result(async () => {
      const actionProof = await requireStepUpGrant("passkey-enroll");

      const started = await request<{
        flowId: string;
        expiresAtMillis: number;
        options: PublicKeyCredentialCreationOptionsJSON;
      }>("/beginPasskeyEnrollment", {
        method: "POST",
        body: authBody({
          flowId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          profileId: "default",
          name,
          actionProof,
        }),
      });

      let response: unknown;

      try {
        const { startRegistration } = await import("@simplewebauthn/browser");
        response = await startRegistration({ optionsJSON: started.options });
      } catch {
        throw new Error("That passkey wasn't created. Try again.");
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
  updateUser: (payload: { name?: string; image?: string | null }) =>
    result(() => request<{ status: "ok" }>("/v1/me", { method: "PATCH", body: body(payload) })),
  requestEmailVerification: () =>
    result(() =>
      request<{ status: "ok"; challenge?: string }>("/v1/account/email-verification", {
        method: "POST",
        body: "{}",
      }),
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
  changeEmail: (payload: { newEmail: string; callbackURL?: string }) =>
    result(() =>
      request<{ status: "ok" }>("/v1/account/email-change", {
        method: "POST",
        body: body({ newEmail: payload.newEmail }),
      }),
    ),
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
        scopes: Array<"read" | "write">;
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
    scopes?: Array<"read" | "write">;
    tenantId?: string | null;
  }) =>
    withStepUp("api-token-create", (grant) =>
      request<{
        token: string;
        item: {
          id: string;
          name: string;
          tokenPrefix: string;
          scopes: Array<"read" | "write">;
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
