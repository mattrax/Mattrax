/**
 * Which enrollment tab to open first.
 *
 * The server and the browser both have a user agent, so the same choice is made
 * on both sides of hydration. Detection is deliberately narrow: an unknown
 * platform falls back to the first usable tab rather than guessing.
 */

export const ENROLLMENT_PLATFORMS = ["apple", "windows", "android"] as const;

export type EnrollmentPlatform = (typeof ENROLLMENT_PLATFORMS)[number];

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
