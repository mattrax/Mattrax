/**
 * Which enrollment tab to open first.
 *
 * The server resolves this from the request's user agent and writes the answer
 * onto the tab list. During hydration the client reads that marker instead of
 * asking a possibly different user agent, so the two renders agree. A purely
 * client-side navigation has no server marker and falls back to the browser's
 * own user agent.
 */

export const ENROLLMENT_PLATFORMS = ["apple", "windows", "android"] as const;

export type EnrollmentPlatform = (typeof ENROLLMENT_PLATFORMS)[number];

/** DOM marker carrying the platform resolved by the server render. */
export const ENROLLMENT_PLATFORM_ATTRIBUTE = "data-enrollment-platform";

/** Scopes that marker to the enrollment link it was resolved for. */
export const ENROLLMENT_PLATFORM_PAGE_ATTRIBUTE = "data-enrollment-for";

const PLATFORM_MARKER = new Set<string>(ENROLLMENT_PLATFORMS);

/** Narrow an untrusted attribute value before using it as a tab key. */
export function isEnrollmentPlatform(
  value: string | null | undefined,
): value is EnrollmentPlatform {
  return value !== null && value !== undefined && PLATFORM_MARKER.has(value);
}

/** Map a browser user agent onto the platform it is most likely enrolling. */
export function detectEnrollmentPlatform(
  userAgent: string | null | undefined,
): EnrollmentPlatform | undefined {
  const agent = userAgent?.toLowerCase() ?? "";

  if (!agent) return undefined;

  // iPadOS reports "Macintosh" on some browsers, so the Apple check covers the
  // desktop and tablet spellings together.
  if (/iphone|ipad|ipod|macintosh|mac os x/.test(agent)) return "apple";

  if (/android/.test(agent)) return "android";

  if (/windows/.test(agent)) return "windows";

  return undefined;
}

/**
 * The tab to select before the visitor chooses one.
 *
 * A detected platform wins even when its enrollment method is not configured:
 * the panel explains the problem for the device they are actually holding,
 * which is more useful than showing another platform's instructions.
 */
export function preferredEnrollmentPlatform(
  userAgent: string | null | undefined,
  fallback: EnrollmentPlatform,
): EnrollmentPlatform {
  return detectEnrollmentPlatform(userAgent) ?? fallback;
}

/**
 * Resolve the initial tab. A server-authored marker always wins so hydration
 * does not recompute from a different source; otherwise use the user agent.
 */
export function resolveInitialEnrollmentPlatform(input: {
  readonly marker?: string | null;
  readonly userAgent?: string | null;
  readonly fallback: EnrollmentPlatform;
}): EnrollmentPlatform {
  if (isEnrollmentPlatform(input.marker)) return input.marker;

  return preferredEnrollmentPlatform(input.userAgent, input.fallback);
}
