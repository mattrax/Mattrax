import { createResource } from "solid-js";
import { getRequestEvent, isServer } from "solid-js/web";
import { apiFetch } from "~/lib/auth-api.server";

type AuthUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
};
type AuthResult<T = unknown> = Promise<{ data?: T; error?: { message?: string } }>;

const body = (value: unknown) => JSON.stringify(value);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `/api/v1${path}`;
  const event = isServer ? getRequestEvent() : undefined;
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");

  let response: Response;
  if (event) {
    const cookie = event.request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);
    response = await apiFetch(new Request(new URL(url, event.request.url), { ...init, headers }));
  } else {
    response = await fetch(url, { ...init, credentials: "include", headers });
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new Error(data?.message ?? `Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

const result = async <T>(fn: () => Promise<T>): AuthResult<T> => {
  try {
    return { data: await fn() };
  } catch (error) {
    return { error: { message: error instanceof Error ? error.message : "Request failed" } };
  }
};

export const authClient = {
  useSession: () => {
    const [data, { refetch }] = createResource(() => request<{ user?: AuthUser }>("/auth/session"));
    const accessor = () => ({ data: data(), isPending: data.loading, refetch });
    return accessor;
  },
  signIn: {
    email: (payload: { email: string; password: string }) =>
      result(() =>
        request<{ user: AuthUser }>("/auth/login", { method: "POST", body: body(payload) }),
      ),
  },
  signUp: {
    email: (payload: { name: string; email: string; password: string }) =>
      result(() =>
        request<{ user: AuthUser }>("/auth/register", { method: "POST", body: body(payload) }),
      ),
  },
  signOut: (_options?: unknown) =>
    result(() => request<{ status: "ok" }>("/auth/logout", { method: "POST" })),
  updateUser: (payload: { name?: string; image?: string | null }) =>
    result(() => request<{ status: "ok" }>("/me", { method: "PATCH", body: body(payload) })),
  changeEmail: (payload: { newEmail: string; callbackURL?: string }) =>
    result(() =>
      request<{ status: "ok" }>("/auth/change-email", { method: "POST", body: body(payload) }),
    ),
  changePassword: (payload: {
    currentPassword: string;
    newPassword: string;
    revokeOtherSessions?: boolean;
  }) =>
    result(() =>
      request<{ status: "ok" }>("/auth/change-password", { method: "POST", body: body(payload) }),
    ),
  requestPasswordReset: (payload: { email: string; redirectTo?: string }) =>
    result(() =>
      request<{ status: "ok" }>("/auth/forgot-password", { method: "POST", body: body(payload) }),
    ),
  resetPassword: (payload: { token: string; newPassword: string }) =>
    result(() =>
      request<{ status: "ok" }>("/auth/reset-password", { method: "POST", body: body(payload) }),
    ),
  listApiTokens: () =>
    request<{
      tokens: Array<{
        id: string;
        name: string;
        tokenPrefix: string;
        createdAt: string;
        updatedAt: string;
        lastUsedAt?: string | null;
        expiresAt?: string | null;
        revokedAt?: string | null;
      }>;
    }>("/account/api-tokens"),
  createApiToken: (payload: { name: string; expiresAt?: string | null }) =>
    request<{
      token: string;
      item: {
        id: string;
        name: string;
        tokenPrefix: string;
        createdAt: string;
        updatedAt: string;
        lastUsedAt?: string | null;
        expiresAt?: string | null;
        revokedAt?: string | null;
      };
    }>("/account/api-tokens", { method: "POST", body: body(payload) }),
  revokeApiToken: (tokenId: string) =>
    request<{ status: "ok" }>(`/account/api-tokens/${tokenId}`, { method: "DELETE" }),
};
