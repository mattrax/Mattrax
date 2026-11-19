import { describe, expect, it } from "vitest";
import { ssoFailureMessage } from "./sso-completion";

describe("SSO completion failure copy", () => {
  it("returns no message when the redirect carried no error", () => {
    expect(ssoFailureMessage(undefined)).toBeNull();
    expect(ssoFailureMessage(null)).toBeNull();
    expect(ssoFailureMessage("")).toBeNull();
  });

  it("maps every code the callback can send to actionable copy", () => {
    for (const code of [
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
    ]) {
      expect(ssoFailureMessage(code), code).toBeTruthy();
    }
  });

  it("keeps the multi-tenant instruction to ask an administrator", () => {
    expect(ssoFailureMessage("sso_link_required")).toContain("administrator");
  });

  it("does not reflect an unknown code into the page", () => {
    const message = ssoFailureMessage("error_description=secret-detail");

    expect(message).toBeTruthy();
    expect(message).not.toContain("secret-detail");
    expect(message).not.toContain("error_description");
  });
});
