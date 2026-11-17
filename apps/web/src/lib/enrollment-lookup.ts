/**
 * Classify a failed public-enrollment lookup.
 *
 * `404` and `410` are ambiguous: the id may be unknown, or the link may have
 * been reset/deleted. They use the neutral "invalid" state rather than claiming
 * the link expired. Expiration is shown only when the API explicitly says so
 * through {@link ENROLLMENT_STATUS_HEADER}.
 *
 * Authorization failures and rate/server errors are retryable in practice
 * (session/proxy blips, throttling, deploys), so they keep the retryable
 * "unavailable" message instead of telling the visitor to ask for a new link.
 */

export const ENROLLMENT_STATUS_HEADER = "x-mattrax-enrollment-status";

export type EnrollmentLookupFailure = "expired" | "invalid" | "unavailable";

export function enrollmentLookupFailure(
  status: number,
  explicitlyExpired = false,
): EnrollmentLookupFailure {
  if (explicitlyExpired && (status === 404 || status === 410)) return "expired";

  if (status === 401 || status === 403 || status === 408 || status === 429 || status >= 500)
    return "unavailable";

  return "invalid";
}
