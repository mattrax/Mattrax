/**
 * SSR shell invalidation for the API Worker.
 *
 * The dashboard Worker caches the signed-in shell for five minutes in
 * `__Host-mattrax_ssr` plus a signed `__Host-mattrax_ssr_rev` revision cookie.
 * The pair is display-only, but it must stop painting as soon as the security
 * state behind it changes: a revoked session, a removed passkey, a disabled
 * authenticator, a changed email or a deleted account.
 *
 * Those actions are API requests, and the browser's cookies are updated from
 * the response. Clearing both cookies here means the very next navigation has
 * no warm shell to paint, so the resolved state comes from bootstrap instead of
 * waiting out the token TTL. A failed action (for example a missing step-up
 * grant) leaves the shell alone.
 */

/** POST endpoints that rotate or revoke the signed-in shell. */
const SHELL_ROTATING_POST_PATHS = new Set([
  "/api/v1/signout",
  "/api/v1/disabletotp",
  "/api/v1/confirmtotpenrollment",
  "/api/v1/account/email-change/verify",
]);

/** DELETE endpoints keyed by their resource suffix. */
const SHELL_ROTATING_DELETE_PATTERNS = [
  /^\/api\/v1\/account\/sessions\/[^/]+$/,
  /^\/api\/v1\/account\/passkeys\/[^/]+$/,
  /^\/api\/v1\/me$/,
] as const;

/** PATCH endpoints whose success changes values baked into the shell. */
const SHELL_ROTATING_PATCH_PATHS = new Set(["/api/v1/me"]);

/** Cookie names owned by `apps/web/src/server/preload.ts`. */
export const SSR_SHELL_COOKIES = ["__Host-mattrax_ssr", "__Host-mattrax_ssr_rev"] as const;

/**
 * Whether a successful response to this request changes the shell's authority.
 * Path matching is exact; the API router is case-insensitive and tolerates a
 * trailing slash, so normalise those two spellings before comparing.
 */
export const clearsSsrShell = (request: Request): boolean => {
  let pathname: string;

  try {
    pathname = new URL(request.url).pathname.toLowerCase().replace(/\/+$/, "");
  } catch {
    return false;
  }

  if (request.method === "POST") return SHELL_ROTATING_POST_PATHS.has(pathname);

  if (request.method === "DELETE")
    return SHELL_ROTATING_DELETE_PATTERNS.some((pattern) => pattern.test(pathname));

  // A profile edit changes `name`, email and `defaultTenantId`, all baked into
  // the warm shell. The website Worker used to clear it while proxying; direct
  // /api/* routes mean the API must clear it itself.
  if (request.method === "PATCH") return SHELL_ROTATING_PATCH_PATHS.has(pathname);

  return false;
};

/** Expire the SSR token and its revision cookie. */
export const ssrShellClearCookies = (): ReadonlyArray<string> =>
  SSR_SHELL_COOKIES.map(
    (name) =>
      `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  );

/**
 * Attach the clearing cookies to a successful response. Error responses keep
 * whatever cookie state the auth layer chose; the action did not happen.
 */
export const withClearedSsrShell = (response: Response): Response => {
  if (response.status >= 400) return response;

  const headers = new Headers(response.headers);
  const existing = headers.getSetCookie();

  // Re-append rather than copy: a combined `set-cookie` header would collapse
  // the session rotation the auth layer just wrote.
  headers.delete("set-cookie");

  for (const cookie of existing) headers.append("set-cookie", cookie);

  for (const cookie of ssrShellClearCookies()) headers.append("set-cookie", cookie);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
