/**
 * Pure security and caching policy for the dashboard Worker.
 *
 * The header builder and the request guard live here so they can be tested
 * without a Worker runtime. `index.ts` applies them at the edge.
 */

/**
 * Paths owned by another layer. The public Worker proxies these to the API
 * Worker (`/api`), the MDM/SCIM protocol handlers, the MCP endpoint and
 * Cloudflare's own `/cdn-cgi`; `/.well-known` carries OAuth discovery.
 *
 * The path guard must never turn one of these into a 404, and their responses
 * keep the caching policy the owning layer chose.
 */
export const PASSTHROUGH_PREFIXES = [
  "/api",
  "/mdm",
  "/scim",
  "/mcp",
  "/cdn-cgi",
  "/.well-known",
] as const;

/** Scanner and bot probes that must not reach the SSR router. */
const BLOCKED_EXACT_PATHS = new Set(["/wp-login.php", "/xmlrpc.php"]);

const BLOCKED_PATH_PREFIXES = ["/wp-admin", "/phpmyadmin"] as const;

export type PathDecision = "allow" | "not-found";

/**
 * Normalise a request path the way the API router does before it matches a
 * route: decode percent escapes (`%62ootstrap` is `bootstrap`), drop matrix
 * parameters (`;jsessionid=…`), collapse duplicate slashes, lowercase (the
 * router is case-insensitive) and strip the trailing slash.
 *
 * This is used for security comparisons, so it over-normalises rather than
 * under-normalises: decoding `%2F` to `/` can only make the comparison stricter
 * than the router, never looser. Malformed escapes never match a route, so the
 * raw path is returned unchanged.
 */
export function normalisePath(pathname: string): string {
  let decoded = pathname;

  // Two passes catch double-encoded input; the loop stops as soon as decoding
  // is a no-op.
  for (let pass = 0; pass < 2; pass++) {
    try {
      const next = decodeURIComponent(decoded);

      if (next === decoded) break;

      decoded = next;
    } catch {
      break;
    }
  }

  const withoutParameters = decoded.split(";")[0] ?? decoded;
  const collapsed = withoutParameters.replace(/\/{2,}/g, "/").replace(/\/+$/, "");

  return (collapsed === "" ? "/" : collapsed).toLowerCase();
}

/** True when the path routes to the SSR bootstrap endpoint, however it is spelled. */
export function isBootstrapPath(pathname: string): boolean {
  return normalisePath(pathname) === "/api/v1/bootstrap";
}

/** True when `pathname` is owned by another layer rather than the page router. */
export function isPassthroughPath(pathname: string): boolean {
  return PASSTHROUGH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Decide whether a request may reach the SSR router.
 *
 * Rejected paths answer with a plain-text 404 from the Worker instead of
 * rendering the HTML 404 page: dotfiles (`.git`, `.env`, `.DS_Store`, …),
 * protocol-relative (`//host`) targets, CMS probes and unmatched documentation
 * paths (the docs are static assets; a worker render there would loop between
 * the SPA fallback and a reload).
 */
export function guardPath(pathname: string): PathDecision {
  let decoded: string;

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes cannot be served by any route.
    return "not-found";
  }

  if (isPassthroughPath(decoded)) return "allow";

  if (decoded.startsWith("//")) return "not-found";

  if (decoded === "/docs" || decoded.startsWith("/docs/")) return "not-found";

  const lower = decoded.toLowerCase();

  if (lower.split("/").some((segment) => segment !== "" && segment.startsWith(".")))
    return "not-found";

  if (BLOCKED_EXACT_PATHS.has(lower)) return "not-found";

  if (
    BLOCKED_PATH_PREFIXES.some(
      (prefix) => lower === prefix || lower.startsWith(`${prefix}/`),
    )
  )
    return "not-found";

  return "allow";
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Compile one route pattern from the filesystem manifest into a matcher.
 *
 * Grouping segments (`(dashboard)`) are layout-only and are stripped, `:param`
 * matches a single segment and `*rest` matches the remainder. The catch-all
 * 404 route (`*404`) is deliberately excluded: it is the fallback that should
 * produce a 404 status, so it must not count as an existing page.
 */
export function compilePagePattern(pattern: string): RegExp | undefined {
  const collapsed = pattern.replace(/\/\([^)/]+\)/g, "");
  const segments = collapsed.split("/").filter((segment) => segment !== "");

  if (segments.some((segment) => segment.startsWith("*404"))) return undefined;

  const path = segments
    .map((segment) => {
      if (segment.startsWith("*")) return ".*";

      if (segment.startsWith(":")) return "[^/]+";

      return escapeRegExp(segment);
    })
    .join("/");

  return new RegExp(path === "" ? "^/$" : `^/${path}/?$`);
}

/** Compile the page patterns of the route manifest, dropping the 404 route. */
export function compilePagePatterns(patterns: readonly string[]): readonly RegExp[] {
  const compiled: RegExp[] = [];

  for (const pattern of patterns) {
    const matcher = compilePagePattern(pattern);

    if (matcher) compiled.push(matcher);
  }

  return compiled;
}

/** True when `pathname` matches a real page (ignoring the catch-all 404). */
export function isKnownPagePath(pathname: string, patterns: readonly RegExp[]): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  return patterns.some((pattern) => pattern.test(path));
}

/**
 * The enforcing policy only restricts framing and injection vectors that the
 * Solid shell does not use. Resource loading is covered by the report-only
 * policy below until nonces are wired through hydration.
 */
export const HTML_CONTENT_SECURITY_POLICY =
  "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'";

/**
 * Report-only resource policy for the dashboard shell.
 *
 * It is deliberately not enforcing: the SSR document and Solid's hydration
 * entry are inline scripts, and PostHog loads its own recorder bundle from a
 * second origin. Report-only surfaces violations without breaking either.
 */
export const HTML_CONTENT_SECURITY_POLICY_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://us.i.posthog.com https://*.posthog.com",
  "worker-src 'self' blob:",
  "frame-src 'self' https://*.posthog.com",
  "media-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

export const PERMISSIONS_POLICY =
  "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), publickey-credentials-get=(self)";

export const HSTS_POLICY = "max-age=31536000; includeSubDomains";

/** Join `Vary` values, keeping the first spelling of each field name. */
export function mergeVary(existing: string | null, additions: string): string {
  const values = new Map<string, string>();

  for (const token of `${existing ?? ""},${additions}`.split(",")) {
    const value = token.trim();

    if (value === "") continue;

    const key = value.toLowerCase();

    if (!values.has(key)) values.set(key, value);
  }

  return [...values.values()].join(", ");
}

export interface SecurityHeaderContext {
  /** Absolute request URL; decides whether HSTS is safe to advertise. */
  url: string;
  /** The response's content type, used to scope HTML-only headers. */
  contentType: string;
}

/** The header set produced for one response; HTML-only entries are optional. */
export interface SecurityHeaderSet {
  "x-content-type-options": string;
  "x-frame-options": string;
  "referrer-policy": string;
  "cross-origin-opener-policy": string;
  "cross-origin-resource-policy"?: string;
  "permissions-policy": string;
  "strict-transport-security"?: string;
  "content-security-policy"?: string;
  "content-security-policy-report-only"?: string;
  "cache-control"?: string;
  "cdn-cache-control"?: string;
  vary?: string;
}

/**
 * Build the security headers for one response.
 *
 * Every response receives the same hardening set. HTML additionally gets the
 * enforcing frame/object policy, a same-origin resource policy and a private
 * cache policy: authenticated shells must never be stored by a shared cache or
 * embedded by another origin.
 */
export function securityHeaders(context: SecurityHeaderContext): SecurityHeaderSet {
  const headers: SecurityHeaderSet = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": PERMISSIONS_POLICY,
  };

  if (new URL(context.url).protocol === "https:") {
    headers["strict-transport-security"] = HSTS_POLICY;
  }

  if (context.contentType.includes("text/html")) {
    headers["content-security-policy"] = HTML_CONTENT_SECURITY_POLICY;
    headers["content-security-policy-report-only"] = HTML_CONTENT_SECURITY_POLICY_REPORT_ONLY;
    // Keep the document out of cross-origin embedding and nosniff protection
    // intact. API/JSON responses keep their own policy so a caller can still
    // read them cross-origin where the owning layer allows it.
    headers["cross-origin-resource-policy"] = "same-origin";
    headers["cache-control"] = "private, no-store";
    headers["cdn-cache-control"] = "no-store";
    headers.vary = "Cookie";
  }

  return headers;
}

/** Apply {@link securityHeaders} to a response without altering its body. */
export function withSecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);

  const built = securityHeaders({
    url: request.url,
    contentType: headers.get("content-type") ?? "",
  });

  const vary = built.vary;

  for (const [name, value] of Object.entries(built)) {
    if (name !== "vary" && value !== undefined) headers.set(name, value);
  }

  if (vary !== undefined) headers.set("vary", mergeVary(headers.get("vary"), vary));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
