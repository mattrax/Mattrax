import { createSignal, onSettled } from "solid-js";
import { getRequestEvent, isServer } from "@solidjs/web";
import { apiFetch } from "~/lib/auth-api.server";
import { errorMessage } from "~/lib/errors";
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
        error?: { _tag?: string; message?: string; reason?: string };
      }
    | undefined;

  if (data?._tag === "Failure" || !response.ok) {
    const tag = data?.error?._tag;
    const error = new Error(
      errorMessage(
        { _tag: tag, message: data?.error?.message, reason: data?.error?.reason },
        response.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "We couldn't complete that request. Try again.",
      ),
    ) as Error & { _tag?: string; reason?: string };
    if (tag) error._tag = tag;
    if (data?.error?.reason) error.reason = data.error.reason;
    throw error;
  }
  return (data && "_tag" in data && data._tag === "Success" ? data.value : data) as T;
}

const result = async <T>(fn: () => Promise<T>): AuthResult<T> => {
  try {
    return { data: await fn() };
  } catch (error) {
    return { error: { message: errorMessage(error) } };
  }
};

const completionUser = (completion: unknown): AuthUser | undefined => {
  const value = completion as { _tag?: string; session?: Session } | undefined;
  return value?._tag === "Authenticated" ? userFromSession(value.session) : undefined;
};

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
        const user = completionUser(completion);
        if (!user) throw new Error("Additional authentication is required");
        return { user };
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
        const user = completionUser(response.completion);
        if (!user) throw new Error("Additional authentication is required");
        return { user };
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
        const user = completionUser(completion);
        if (!user) throw new Error("Additional authentication is required");
        return { user };
      }),
  },
  ssoSignIn: (token: string) =>
    result(async () => {
      const completion = await request<unknown>("/ssoSignIn", {
        method: "POST",
        body: authBody({ token }),
      });
      const user = completionUser(completion);
      if (!user) throw new Error("Additional authentication is required");
      return { user };
    }),
  signOut: (_options?: unknown) =>
    result(async () => {
      await request("/signOut", { method: "POST", body: "{}" });
      return { status: "ok" as const };
    }),
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
    }>("/v1/account/api-tokens", { method: "POST", body: body(payload) }),
  revokeApiToken: (tokenId: string) =>
    request<{ status: "ok" }>(`/v1/account/api-tokens/${tokenId}`, { method: "DELETE" }),
};
