/**
 * Hardening headers for responses the API Worker serves directly.
 *
 * Production routes `/api/*`, `/mdm/*` and `/scim/*` to the API Worker so a
 * browser request does not pay for a hop through the website Worker. Those
 * responses used to inherit the website's header set; keep the entries that
 * matter for a JSON or MDM payload here so routing does not quietly drop them.
 */
export const withApiSecurityHeaders = (request: Request, response: Response): Response => {
  const headers = new Headers(response.headers);

  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");

  // Only advertise HSTS over TLS; local HTTP development must keep working.
  if (new URL(request.url).protocol === "https:")
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
