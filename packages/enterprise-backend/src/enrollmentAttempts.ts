/**
 * Outcome and platform classification for public enrollment-link visits.
 *
 * The public endpoint returns every platform at once, so the "platform" of an
 * attempt is inferred from an explicit query parameter (used by tests and API
 * clients) or from the device's User-Agent. The classifier is deliberately pure
 * so the outcome mapping can be unit tested without a database.
 */
export const ENROLLMENT_ATTEMPT_PLATFORMS = ["apple", "win", "android", "unknown"] as const;
export type EnrollmentAttemptPlatform = (typeof ENROLLMENT_ATTEMPT_PLATFORMS)[number];

export const ENROLLMENT_ATTEMPT_OUTCOMES = [
  "ok",
  "bad_code",
  "disabled",
  "limit",
  "no_apns",
  "scep_error",
  "other",
] as const;
export type EnrollmentAttemptOutcome = (typeof ENROLLMENT_ATTEMPT_OUTCOMES)[number];

/**
 * Repeated public enrollment-link GETs are deduped per
 * `(enrollmentId, ipHash, outcome)` inside this window. Diagnostics are meant
 * to describe a visit, not every reload/poll, and an unbounded append would
 * grow one row per request.
 */
export const ENROLLMENT_ATTEMPT_DEDUPE_MS = 5 * 60 * 1000;

/**
 * Hard cap on distinct diagnostics for one `(enrollment, client)` pair inside
 * the dedupe window, so a client that alternates outcomes cannot append
 * without bound.
 */
export const ENROLLMENT_ATTEMPT_PER_CLIENT_LIMIT = 5;

export type EnrollmentAttemptEvaluation = {
  readonly outcome: EnrollmentAttemptOutcome;
  readonly detail: string;
};

/** Best-effort platform detection for a public enrollment visit. */
export const detectEnrollmentPlatform = (
  userAgent?: string | null,
  requested?: string | null,
): EnrollmentAttemptPlatform => {
  if (requested === "apple" || requested === "win" || requested === "android") return requested;
  const agent = (userAgent ?? "").toLowerCase();
  if (!agent) return "unknown";
  if (/iphone|ipad|ipod|macintosh|mac os x/.test(agent)) return "apple";
  if (/android/.test(agent)) return "android";
  if (/windows/.test(agent)) return "win";
  return "unknown";
};

export type EnrollmentAttemptContext = {
  readonly platform: EnrollmentAttemptPlatform;
  readonly limitReached: boolean;
  readonly appleEnabled: boolean;
  readonly windowsEnabled: boolean;
  readonly androidEnabled: boolean;
  /** True when the deployment and tenant can issue Android enrollment tokens. */
  readonly androidAvailable?: boolean;
  readonly apnsConfigured: boolean;
  /** True when a SCEP challenge was needed but could not be created. */
  readonly appleScepFailed?: boolean;
};

/**
 * Map the outcome of an enrollment visit for the platform the device is
 * enrolling. A bad password is classified separately because it happens before
 * any platform is evaluated.
 */
export const evaluateEnrollmentAttempt = (
  context: EnrollmentAttemptContext,
): EnrollmentAttemptEvaluation => {
  if (context.limitReached)
    return { outcome: "limit", detail: "The tenant device limit has been reached" };

  switch (context.platform) {
    case "apple":
      if (!context.appleEnabled)
        return { outcome: "disabled", detail: "Apple enrollment is disabled" };
      if (context.appleScepFailed)
        return { outcome: "scep_error", detail: "The SCEP challenge could not be created" };
      if (!context.apnsConfigured)
        return { outcome: "no_apns", detail: "Apple push notifications are not configured" };
      return { outcome: "ok", detail: "Apple enrollment profile issued" };
    case "win":
      if (!context.windowsEnabled)
        return { outcome: "disabled", detail: "Windows enrollment is disabled" };
      return { outcome: "ok", detail: "Windows discovery details issued" };
    case "android":
      if (!context.androidEnabled)
        return { outcome: "disabled", detail: "Android enrollment is disabled" };
      if (context.androidAvailable === false)
        return {
          outcome: "other",
          detail: "Android Enterprise is not connected for this tenant",
        };
      return { outcome: "ok", detail: "Android enrollment token issued" };
    case "unknown":
      if (!context.appleEnabled && !context.windowsEnabled && !context.androidEnabled)
        return { outcome: "disabled", detail: "All enrollment platforms are disabled" };
      return { outcome: "ok", detail: "Enrollment link opened" };
  }
};
