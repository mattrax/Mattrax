/**
 * A JS-readable shadow of the HttpOnly auth session cookie.
 *
 * It is deliberately not an authorization signal. The server mirrors the real
 * session cookie's lifetime here so the dashboard can redirect a signed-out or
 * expired browser immediately, without waiting for `/getSession` or `/me`.
 */
export const SESSION_PRESENCE_COOKIE = "mattrax_session_presence";
export const SESSION_PRESENCE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const PREFIX = "v1.";
const CLEARED = "Thu, 01 Jan 1970 00:00:00 GMT";

export type SessionPresence = {
  readonly state: "active" | "expired" | "missing";
  readonly expiresAt?: number;
};

const secureSuffix = (secure: boolean) => (secure ? "; Secure" : "");

export const sessionPresenceSetCookie = (
  expiresAt: number | null,
  secure = typeof location !== "undefined" && location.protocol === "https:",
): string =>
  expiresAt === null
    ? `${SESSION_PRESENCE_COOKIE}=; Path=/; Max-Age=0; Expires=${CLEARED}; SameSite=Lax${secureSuffix(secure)}`
    : `${SESSION_PRESENCE_COOKIE}=${PREFIX}${expiresAt}; Path=/; Max-Age=${SESSION_PRESENCE_MAX_AGE_SECONDS}; SameSite=Lax${secureSuffix(secure)}`;

const cookieValue = (name: string): string | undefined => {
  if (typeof document === "undefined") return undefined;

  for (const part of document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");

    if (key === name) return rest.join("=");
  }

  return undefined;
};

export function readSessionPresence(): SessionPresence {
  const value = cookieValue(SESSION_PRESENCE_COOKIE);

  if (!value) return { state: "missing" };

  if (!value.startsWith(PREFIX)) return { state: "active" };
  const expiresAt = Number(value.slice(PREFIX.length));

  if (!Number.isFinite(expiresAt)) return { state: "missing" };

  return expiresAt > Date.now() ? { state: "active", expiresAt } : { state: "expired", expiresAt };
}

export function clearSessionPresence(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SESSION_PRESENCE_COOKIE}=; Path=/; Max-Age=0; Expires=${CLEARED}; SameSite=Lax${secureSuffix(
    location.protocol === "https:",
  )}`;
}
