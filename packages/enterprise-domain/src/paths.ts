/**
 * Normalise a path the way the Effect router matches it before applying a
 * security rule: decode escapes, drop matrix parameters, collapse duplicate
 * slashes, strip a trailing slash and fold case.
 *
 * Shared by the credential rate limiter and the sign-in observer so
 * `/API/V1//completePasskeySignIn/` cannot bypass either while still reaching
 * the handler.
 */
export const normalisePath = (pathname: string): string => {
  let decoded = pathname;

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape cannot match a route; leave it as-is.
  }

  return (
    decoded
      .replaceAll(/;.*?(?=\/|$)/g, "")
      .replaceAll(/\/+/g, "/")
      .replace(/\/$/, "")
      .toLowerCase() || "/"
  );
};
