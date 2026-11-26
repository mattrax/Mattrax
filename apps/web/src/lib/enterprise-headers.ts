const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Headers every enterprise request needs for the API's cookie-authentication
 * guard. Browsers supply Origin automatically for unsafe fetches; SSR forwards
 * must supply it explicitly because the server-side fetch has no browser Origin.
 */
export const enterpriseSecurityHeaders = (method: string, origin?: string) => ({
  ...(SAFE_METHODS.has(method.toUpperCase()) ? {} : { "x-effect-auth-csrf": "1" }),
  ...(origin ? { origin } : {}),
});
