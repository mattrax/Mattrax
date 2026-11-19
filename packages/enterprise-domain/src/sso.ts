/**
 * Stable failure codes the Entra SSO callback redirects with.
 *
 * The callback's URL is visited by the browser and can end up in history,
 * logs and referrers, so it must never carry an IdP error, email address,
 * token or raw exception. Both the server redirect and the completion page
 * copy use this one list so a new code cannot be forgotten on either side.
 */
export const SSO_FAILURE_CODES = [
  "sso_unavailable",
  "invalid_request",
  "state_mismatch",
  "state_expired",
  "sso_disabled",
  "idp_unavailable",
  "idp_rejected",
  "not_a_member",
  "account_disabled",
  "domain_not_verified",
  "sso_link_required",
  "provisioning_disabled",
  "unknown_account",
  "sign_in_failed",
] as const;

export type SsoFailureCode = (typeof SSO_FAILURE_CODES)[number];
