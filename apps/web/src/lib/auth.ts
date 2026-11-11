import { createSignal, onSettled } from "solid-js";
import { getRequestEvent, isServer } from "@solidjs/web";
import { apiFetch } from "~/lib/auth-api.server";
import { errorMessage } from "~/lib/errors";
import { requireStepUpGrant, withStepUp } from "~/lib/step-up";
import { getPreloadedSession, type PreloadedSession } from "~/lib/session-store";

type AuthUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
};

type Session = {
  sessionId: string;
  subjectId: string;
  claims: {
    name: string;
    email: string;
    emailVerified: boolean;
  };
};

type AuthResult<T = unknown> = Promise<{ data?: T; error?: { message?: string } }>;

type PrivateReveal = {
  kind: "totp-enrollment" | "recovery-codes";
  revealId: string;
  expiresAtMillis: number;
  payload: unknown;
};

type AuthEnvelope<T> = {
  value: T;
  private?: PrivateReveal[];
};

const resetFlowKey = "mattrax:password-reset";
const body = (value: unknown) => JSON.stringify(value);
const authBody = (value: unknown) => body({ payload: value });

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
    const error = new Error(
      errorMessage(
        { _tag: tag, message, reason },
        response.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "We couldn't complete that request. Try again.",
      ),
    ) as Error & { _tag?: string; reason?: string; action?: string; methods?: string[] };
    if (tag) error._tag = tag;
    if (reason) error.reason = reason;
    if (data?.action) error.action = data.action;
    if (data?.methods) error.methods = data.methods;
    throw error;
  }
  return {
    value: (data && "_tag" in data && data._tag === "Success" ? data.value : data) as T,
    private: data?.private,
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await requestEnvelope<T>(path, init)).value;
}

const result = async <T>(fn: () => Promise<T>): AuthResult<T> => {
  try {
    return { data: await fn() };
  } catch (error) {
    return { error: { message: errorMessage(error) } };
  }
};

type CompletionState = { user?: AuthUser; pending?: boolean };

const completionState = (completion: unknown): CompletionState => {
  const value = completion as { _tag?: string; session?: Session } | undefined;
  if (value?._tag === "Authenticated") return { user: userFromSession(value.session) };
  if (value?._tag === "PendingAuthentication") return { pending: true };
  throw new Error("Authentication did not complete");
};

const revealOf = <T>(envelope: AuthEnvelope<unknown>, kind: PrivateReveal["kind"]): T | undefined =>
  envelope.private?.find((item) => item.kind === kind)?.payload as T | undefined;

export const authClient = {
  useSession: () => {
    // The page middleware preloads the session on the server so the first
    // render already knows the user; hydration adopts that value. Without a
    // preload (for example a failed API call) the client asks after hydration.
    const event = isServer ? getRequestEvent() : undefined;
    const initial = event
      ? (getPreloadedSession(event.request) as Session | null | undefined)
      : undefined;
    const [data, setData] = createSignal<Session | null | undefined>(initial);
    const [pending, setPending] = createSignal(initial === undefined);

    const load = async () => {
      setPending(true);
      try {
        setData(await request<Session | null>("/getSession", { method: "POST", body: "{}" }));
      } catch {
        setData(null);
      } finally {
        setPending(false);
      }
    };

    onSettled(() => {
      if (!isServer && data() === undefined) void load();
    });

    const accessor = () => ({
      data: { user: userFromSession(data() ?? undefined) },
      isPending: pending(),
      refetch: load,
    });
    return accessor;
  },
  signIn: {
    email: (payload: { email: string; password: string }) =>
      result(async () => {
        const completion = await request<unknown>("/signIn", {
          method: "POST",
          body: authBody(payload),
        });
        const state = completionState(completion);
        if (!state.user && !state.pending) throw new Error("Additional authentication is required");
        return state;
      }),
  },
  emailCode: {
    /** Start a passwordless browser flow and ask the server to email a code. */
    request: (payload: { email: string; returnTo?: string }) =>
      result(async () => {
        const flowId = crypto.randomUUID();
        await request("/beginEmailSignIn", {
          method: "POST",
          body: authBody({ flowId }),
        });
        const receipt = await request<{
          requestId: string;
          reference: { proofId: string; purpose: string; keyId: string };
        }>("/requestEmailCode", {
          method: "POST",
          body: authBody({
            flowId,
            email: payload.email,
            returnTarget: payload.returnTo ?? "/dashboard",
            requestId: crypto.randomUUID(),
            locale: "en",
          }),
        });
        return { flowId, email: payload.email, reference: receipt.reference };
      }),
    complete: (payload: {
      flowId: string;
      email: string;
      returnTarget?: string;
      reference: { proofId: string; purpose: string; keyId: string };
      code: string;
    }) =>
      result(async () => {
        const response = await request<{ completion: unknown }>("/completeEmailCode", {
          method: "POST",
          body: authBody({
            flowId: payload.flowId,
            email: payload.email,
            returnTarget: payload.returnTarget ?? "/dashboard",
            reference: payload.reference,
            secret: payload.code,
          }),
        });
        const state = completionState(response.completion);
        if (!state.user && !state.pending) throw new Error("Additional authentication is required");
        return state;
      }),
  },
  signUp: {
    email: (payload: { name: string; email: string; password: string }) =>
      result(async () => {
        await request("/register", {
          method: "POST",
          body: authBody({
            requestId: crypto.randomUUID(),
            email: payload.email,
            newPassword: payload.password,
            registration: { name: payload.name },
          }),
        });
        const completion = await request<unknown>("/signIn", {
          method: "POST",
          body: authBody({ email: payload.email, password: payload.password }),
        });
        const state = completionState(completion);
        if (!state.user && !state.pending) throw new Error("Additional authentication is required");
        return state;
      }),
  },
  ssoSignIn: (token: string) =>
    result(async () => {
      const completion = await request<unknown>("/ssoSignIn", {
        method: "POST",
        body: authBody({ token }),
      });
      const state = completionState(completion);
      if (!state.user && !state.pending) throw new Error("Additional authentication is required");
      return state;
    }),
  signOut: (_options?: unknown) =>
    result(async () => {
      await request("/signOut", { method: "POST", body: "{}" });
      return { status: "ok" as const };
    }),
  verifyTotpPending: (code: string) =>
    result(async () => {
      const completion = await request<unknown>("/verifyTotpPending", {
        method: "POST",
        body: authBody({ code }),
      });
      return completionState(completion);
    }),
  /**
   * Passkey sign-in is a discoverable-credential ceremony. Begin issues a
   * request-binding cookie; only the WebAuthn response travels back.
   */
  passkeySignIn: () =>
    result(async () => {
      const started = await request<{
        flowId: string;
        expiresAtMillis: number;
        options: unknown;
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
          optionsJSON: started.options as never,
          useBrowserAutofill: false,
        });
      } catch {
        throw new Error("That passkey wasn't confirmed. Try again or use another method.");
      }
      const completion = await request<unknown>("/completePasskeySignIn", {
        method: "POST",
        body: authBody({ flowId: started.flowId, response: JSON.stringify(response) }),
      });
      const state = completionState(completion);
      if (!state.user && !state.pending) throw new Error("Authentication did not complete");
      return state;
    }),
  /** Complete a pending password/email/SSO sign-in with a passkey. */
  passkeyPending: () =>
    result(async () => {
      const started = await request<{
        flowId: string;
        expiresAtMillis: number;
        options: unknown;
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
          optionsJSON: started.options as never,
          useBrowserAutofill: false,
        });
      } catch {
        throw new Error("That passkey wasn't confirmed. Try again or use a code.");
      }
      const completion = await request<unknown>("/completePasskeyPending", {
        method: "POST",
        body: authBody({ flowId: started.flowId, response: JSON.stringify(response) }),
      });
      return completionState(completion);
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
        options: unknown;
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
        response = await startRegistration({ optionsJSON: started.options as never });
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
        request<{ status: "ok" }>(`/v1/account/passkeys/${encodeURIComponent(credentialId)}`, {
          method: "DELETE",
          ...(grant ? { headers: { "x-mattrax-step-up": grant } } : {}),
        }),
      ),
    ),
  recoverTotpPending: (code: string) =>
    result(async () => {
      const completion = await request<unknown>("/recoverTotpPending", {
        method: "POST",
        body: authBody({ code }),
      });
      return completionState(completion);
    }),
  beginTotpEnrollment: (accountName: string) =>
    result(async () => {
      const envelope = await requestEnvelope<{ enrollmentId: string; expiresAtMillis: number }>(
        "/beginTotpEnrollment",
        {
          method: "POST",
          body: authBody({ commandId: crypto.randomUUID(), accountName }),
        },
      );
      const reveal = revealOf<{ manualKey: string; uri: string }>(envelope, "totp-enrollment");
      if (!reveal) throw new Error("The authenticator enrollment details were not returned");
      return { ...envelope.value, ...reveal };
    }),
  confirmTotpEnrollment: (payload: { enrollmentId: string; code: string }) =>
    result(async () => {
      const envelope = await requestEnvelope<{
        enabled: boolean;
        invalidation: unknown;
      }>("/confirmTotpEnrollment", {
        method: "POST",
        body: authBody({ commandId: crypto.randomUUID(), ...payload }),
      });
      return {
        ...envelope.value,
        recoveryCodes: revealOf<string[]>(envelope, "recovery-codes") ?? [],
      };
    }),
  regenerateTotpRecoveryCodes: (proof: { password: string; code: string }) =>
    result(async () => {
      const envelope = await requestEnvelope<{ enabled: true }>("/regenerateTotpRecoveryCodes", {
        method: "POST",
        body: authBody({ commandId: crypto.randomUUID(), actionProof: JSON.stringify(proof) }),
      });
      return {
        ...envelope.value,
        recoveryCodes: revealOf<string[]>(envelope, "recovery-codes") ?? [],
      };
    }),
  disableTotp: (proof: { password: string; code: string }) =>
    result(() =>
      request<{ enabled: boolean; invalidation: unknown }>("/disableTotp", {
        method: "POST",
        body: authBody({ commandId: crypto.randomUUID(), actionProof: JSON.stringify(proof) }),
      }),
    ),
  updateUser: (payload: { name?: string; image?: string | null }) =>
    result(() => request<{ status: "ok" }>("/v1/me", { method: "PATCH", body: body(payload) })),
  requestEmailVerification: () =>
    result(() =>
      request<{ status: "ok" }>("/v1/account/email-verification", {
        method: "POST",
        body: "{}",
      }),
    ),
  verifyEmail: (payload: { token: string }) =>
    result(() =>
      request<{ status: "ok" }>("/v1/verify-email", {
        method: "POST",
        body: body(payload),
      }),
    ),
  changeEmail: (payload: { newEmail: string; callbackURL?: string }) =>
    result(() =>
      request<{ status: "ok" }>("/v1/account/email-change", {
        method: "POST",
        body: body({ newEmail: payload.newEmail }),
      }),
    ),
  verifyEmailChange: (payload: { token: string }) =>
    result(() =>
      request<{ status: "ok" }>("/v1/account/email-change/verify", {
        method: "POST",
        body: body(payload),
      }),
    ),
  changePassword: (payload: {
    currentPassword: string;
    newPassword: string;
    revokeOtherSessions?: boolean;
  }) =>
    result(() =>
      request<{ status: "ok" }>("/changePassword", {
        method: "POST",
        body: authBody({
          commandId: crypto.randomUUID(),
          currentPassword: payload.currentPassword,
          newPassword: payload.newPassword,
        }),
      }),
    ),
  requestPasswordReset: (payload: { email: string; redirectTo?: string }) =>
    result(async () => {
      const flowId = crypto.randomUUID();
      await request("/requestReset", {
        method: "POST",
        body: authBody({
          flowId,
          email: payload.email,
          requestId: crypto.randomUUID(),
          locale: "en",
        }),
      });
      if (!isServer && typeof localStorage !== "undefined")
        localStorage.setItem(resetFlowKey, JSON.stringify({ flowId, email: payload.email }));
      return { status: "ok" as const };
    }),
  resetPassword: (payload: {
    newPassword: string;
    flowId: string;
    email: string;
    reference: unknown;
    secret: string;
  }) =>
    result(() =>
      request<{ status: "ok" }>("/completeReset", {
        method: "POST",
        body: authBody({
          flowId: payload.flowId,
          email: payload.email,
          commandId: crypto.randomUUID(),
          newPassword: payload.newPassword,
          reference: payload.reference,
          secret: payload.secret,
        }),
      }),
    ),
  resetFlow: () => {
    if (isServer || typeof localStorage === "undefined") return undefined;
    const value = localStorage.getItem(resetFlowKey);
    if (!value) return undefined;
    try {
      return JSON.parse(value) as { flowId: string; email: string };
    } catch {
      return undefined;
    }
  },
  clearResetFlow: () => {
    if (!isServer && typeof localStorage !== "undefined") localStorage.removeItem(resetFlowKey);
  },
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
      }>("/v1/account/api-tokens", {
        method: "POST",
        body: body(payload),
        ...(grant ? { headers: { "x-mattrax-step-up": grant } } : {}),
      }),
    ),
  revokeApiToken: (tokenId: string) =>
    withStepUp("api-token-revoke", (grant) =>
      request<{ status: "ok" }>(`/v1/account/api-tokens/${tokenId}`, {
        method: "DELETE",
        ...(grant ? { headers: { "x-mattrax-step-up": grant } } : {}),
      }),
    ),
};
