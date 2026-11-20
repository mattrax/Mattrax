/**
 * Route classification for metric labels.
 *
 * Labels must be bounded and must never contain a tenant id, device id or raw
 * request path. Everything here maps a request to a small enum: the caller's
 * path is only used to pick a bucket, never stored.
 */

export type RouteClass =
  | "health"
  | "ready"
  | "metrics"
  | "api"
  | "webhook"
  | "mdm.apple.checkin"
  | "mdm.apple.enrollment"
  | "mdm.apple"
  | "mdm.windows.checkin"
  | "mdm.windows.enrollment"
  | "mdm.windows"
  | "mdm"
  | "scep"
  | "scim"
  | "other";

/** Lowercase and collapse separators so casing cannot multiply the series. */
const normalise = (pathname: string): string => {
  const withoutQuery = pathname.split("?")[0] ?? "/";

  return withoutQuery.replaceAll(/\/+/g, "/").replace(/\/$/, "").toLowerCase() || "/";
};

export const routeClassForPath = (pathname: string): RouteClass => {
  const path = normalise(pathname);

  if (path === "/api/health" || path === "/health") return "health";

  if (path === "/api/ready") return "ready";

  if (path === "/api/metrics") return "metrics";

  // SCEP lives under the Apple prefix; it is a certificate exchange, not a
  // check-in, so it must not be counted as one.
  if (path === "/mdm/apple/scep" || path.startsWith("/mdm/apple/scep/")) return "scep";

  if (path === "/scep" || path.startsWith("/scep/")) return "scep";

  if (path === "/mdm/apple/mdm") return "mdm.apple.checkin";

  if (path === "/mdm/apple/enroll") return "mdm.apple.enrollment";

  if (path.startsWith("/mdm/apple/")) return "mdm.apple";

  if (path === "/mdm/windows/management") return "mdm.windows.checkin";

  if (path === "/mdm/windows/enroll") return "mdm.windows.enrollment";

  if (path.startsWith("/mdm/windows/")) return "mdm.windows";

  if (path === "/mdm" || path.startsWith("/mdm/")) return "mdm";

  if (path.startsWith("/scim/") || path === "/scim") return "scim";

  if (path === "/api/webhooks" || path.startsWith("/api/webhooks/")) return "webhook";

  if (path.startsWith("/api/") || path === "/api") return "api";

  return "other";
};

export type StatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx";

export const statusClass = (status: number): StatusClass => {
  if (status >= 500) return "5xx";

  if (status >= 400) return "4xx";

  if (status >= 300) return "3xx";

  if (status >= 200) return "2xx";

  return "1xx";
};

export type MdmOutcome =
  | "ok"
  | "redirect"
  | "rejected"
  | "unauthorized"
  | "not_found"
  | "unenrolled"
  | "rate_limited"
  | "error";

export type MdmEvent = {
  readonly platform: "apple" | "windows";
  readonly kind: "checkin" | "enrollment";
  readonly outcome: MdmOutcome;
};

const outcomeForStatus = (status: number): MdmOutcome => {
  // Apple's contract: 410 means "stop checking in and remove the profile".
  if (status === 410) return "unenrolled";

  if (status === 429) return "rate_limited";

  if (status === 401 || status === 403) return "unauthorized";

  if (status === 404) return "not_found";

  if (status >= 500) return "error";

  if (status >= 400) return "rejected";

  if (status >= 300) return "redirect";

  return "ok";
};

/**
 * Map a request to an MDM check-in/enrollment outcome, if it is one.
 *
 * This is the protocol-level result (status only). It deliberately does not
 * include which command was served: that would need a label per request.
 */
export const mdmEventFor = (route: RouteClass, status: number): MdmEvent | undefined => {
  switch (route) {
    case "mdm.apple.checkin":
      return { platform: "apple", kind: "checkin", outcome: outcomeForStatus(status) };
    case "mdm.apple.enrollment":
      return { platform: "apple", kind: "enrollment", outcome: outcomeForStatus(status) };
    case "mdm.windows.checkin":
      return { platform: "windows", kind: "checkin", outcome: outcomeForStatus(status) };
    case "mdm.windows.enrollment":
      return { platform: "windows", kind: "enrollment", outcome: outcomeForStatus(status) };
    default:
      return undefined;
  }
};
