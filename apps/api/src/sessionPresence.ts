/**
 * Mirror the auth session cookie into a JS-readable presence cookie.
 *
 * The real session stays HttpOnly. The presence cookie contains only an expiry
 * timestamp, so the dashboard can decide whether to show its cached shell or
 * redirect immediately without waiting for an HTTP session check.
 */

export const SESSION_PRESENCE_COOKIE = "mattrax_session_presence";
const PREFIX = "v1.";
const DEFAULT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const CLEARED = "Thu, 01 Jan 1970 00:00:00 GMT";

const getSetCookies = (headers: Headers): ReadonlyArray<string> => headers.getSetCookie();

const maxAgeSeconds = (setCookie: string): number | undefined => {
  const match = /;\s*max-age=(-?\d+)/i.exec(setCookie);

  if (!match) return undefined;
  const value = Number(match[1]);

  return Number.isFinite(value) ? value : undefined;
};

const presenceCookie = (expiresAt: number | null, secure: boolean): string => {
  const suffix = secure ? "; Secure" : "";

  if (expiresAt === null)
    return `${SESSION_PRESENCE_COOKIE}=; Path=/; Max-Age=0; Expires=${CLEARED}; SameSite=Lax${suffix}`;
  const seconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));

  return `${SESSION_PRESENCE_COOKIE}=${PREFIX}${expiresAt}; Path=/; Max-Age=${seconds}; SameSite=Lax${suffix}`;
};

/**
 * If this response rotates, issues or clears the real session cookie, append a
 * matching presence cookie. Responses that do not touch the session are
 * returned untouched.
 */
export const withSessionPresence = (
  response: Response,
  options: {
    readonly sessionCookieName: string;
    readonly secure: boolean;
  },
): Response => {
  const cookies = getSetCookies(response.headers);

  const sessionCookie = cookies.find((cookie) =>
    cookie.trim().startsWith(`${options.sessionCookieName}=`),
  );

  if (!sessionCookie) return response;

  const first = sessionCookie.split(";")[0] ?? "";
  const value = first.slice(first.indexOf("=") + 1).trim();
  const maxAge = maxAgeSeconds(sessionCookie);
  const cleared = value === "" || (maxAge !== undefined && maxAge <= 0);

  const expiresAt = cleared
    ? null
    : Date.now() + Math.max(1, maxAge ?? DEFAULT_MAX_AGE_SECONDS) * 1000;

  const shadow = presenceCookie(expiresAt, options.secure);

  const headers = new Headers(response.headers);
  headers.delete("set-cookie");

  for (const cookie of cookies) headers.append("set-cookie", cookie);
  headers.append("set-cookie", shadow);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
