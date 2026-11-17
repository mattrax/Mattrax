/**
 * Classify a failed public-enrollment lookup.
 *
 * The API answers `404` for a link that was reset or deleted, and `410` when a
 * token is definitively gone. Those are stable link states, not a temporary
 * outage, so the page can offer a fresh start rather than asking the visitor to
 * retry forever. Server, rate-limit and network failures keep the retryable
 * message.
 */

export type EnrollmentLookupFailure = "expired" | "invalid" | "unavailable";

export function enrollmentLookupFailure(status: number): EnrollmentLookupFailure {
  if (status === 404 || status === 410) return "expired";

  if (status === 408 || status === 429 || status >= 500) return "unavailable";

  return "invalid";
}
