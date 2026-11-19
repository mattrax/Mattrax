/**
 * Copy for the SSO completion page.
 *
 * The API callback redirects here with a stable failure code and never with an
 * IdP message, token or email address. This mapping is the only place those
 * codes become text, so an unrecognised value falls back to a generic message
 * instead of being reflected into the page.
 */
const FAILURE_MESSAGES = {
  sso_unavailable:
    "Single sign-on is not configured for this deployment. Contact your administrator.",
  invalid_request: "The sign-in response was incomplete. Start again from the sign-in page.",
  state_mismatch:
    "This sign-in link was used in a different browser or has already been used. Start again.",
  state_expired: "This sign-in link has expired. Start again from the sign-in page.",
  sso_disabled: "Single sign-on is not enabled for this organisation.",
  idp_unavailable: "We could not reach your identity provider. Try again in a moment.",
  idp_rejected: "Your identity provider declined the sign-in.",
  not_a_member: "You are not a member of this organisation. Ask an administrator to invite you.",
  account_disabled: "This account is disabled. Contact your administrator.",
  domain_not_verified:
    "This email domain is not verified for this organisation yet. Ask an administrator to finish setting up directory sync.",
  sso_link_required:
    "This account belongs to more than one organisation, so an administrator must link single sign-on before it can sign in this way.",
  provisioning_disabled:
    "No Mattrax account exists for this email, and this organisation does not create accounts on first sign-in. Ask an administrator to invite you.",
  unknown_account: "No Mattrax account matches this identity. Ask an administrator to invite you.",
  sign_in_failed: "Single sign-on could not be completed. Try again, or sign in another way.",
} satisfies Record<string, string>;

type KnownFailureCode = keyof typeof FAILURE_MESSAGES;

const GENERIC_FAILURE = "Single sign-on could not be completed. Try again, or sign in another way.";

const isKnownFailure = (code: string): code is KnownFailureCode =>
  Object.hasOwn(FAILURE_MESSAGES, code);

/** `null` means the redirect carried no error; unknown codes stay generic. */
export const ssoFailureMessage = (code: string | null | undefined): string | null => {
  if (!code) return null;

  return isKnownFailure(code) ? FAILURE_MESSAGES[code] : GENERIC_FAILURE;
};
