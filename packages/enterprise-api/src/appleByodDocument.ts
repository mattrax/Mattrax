/**
 * Pure Apple account-driven enrollment policy.
 *
 * Kept out of the service closure so the document shape, domain rules and
 * setup blockers can be fixture-tested without a database or a Worker.
 */

export type AppleByodDomainOption = {
  readonly domain: string;
  readonly source: "entra" | "deployment";
  readonly isVerified: boolean;
};

/** FQDN without scheme, path, port or trailing dot; null when invalid. */
export const normalizeAppleByodDomain = (value: string | null | undefined) => {
  const trimmed = value?.trim().toLowerCase().replace(/\.$/, "");

  if (!trimmed) return null;

  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
      trimmed,
    )
  )
    return null;

  return trimmed.slice(0, 255);
};

/** The exact body Apple requires at /.well-known/com.apple.remotemanagement. */
export const appleByodDiscoveryDocument = (input: {
  readonly organizationId: string;
  readonly domain: string;
  readonly publicOrigin?: string;
}) => ({
  Servers: [
    {
      Version: "mdm-byod" as const,
      BaseURL:
        (input.publicOrigin ?? "https://" + input.domain).replace(/\/+$/, "") +
        "/mdm/apple/byod/" +
        encodeURIComponent(input.organizationId) +
        "/enroll",
    },
  ],
});

export const appleByodDocumentJson = (input: {
  readonly organizationId: string;
  readonly domain: string;
  readonly publicOrigin?: string;
}) => JSON.stringify(appleByodDiscoveryDocument(input));

/** Setup blockers shown verbatim on the admin page. */
export const appleByodBlockers = (input: {
  readonly domain: string | null;
  readonly domains: ReadonlyArray<Pick<AppleByodDomainOption, "domain">>;
  readonly ssoEnabled: boolean;
  readonly apnsConfigured: boolean;
  /** Hosted Cloud has no per-tenant custom hostname yet (issues 460 and 526). */
  readonly hosted?: boolean;
  readonly deploymentHost?: string;
}) => {
  const blockers: string[] = [];

  if (!input.domain)
    blockers.push(
      "Choose a verified domain. The Managed Apple Account domain must answer the discovery document.",
    );
    else if (!input.domains.some((option) => option.domain === input.domain))
      blockers.push(
        input.domain + " is not a verified domain for this tenant. Refresh Entra domains.",
      );

    if (
      input.hosted &&
      input.domain &&
      input.deploymentHost &&
      input.domain !== input.deploymentHost
    )
      blockers.push(
        "Custom tenant hostnames are not available on Mattrax Cloud yet (issues 460 and 526). Account-driven enrollment needs a self-hosted deployment on the tenant's domain.",
      );

  if (!input.ssoEnabled)
    blockers.push("Enable Microsoft Entra single sign-on. Account-driven enrollment uses it.");

  if (!input.apnsConfigured)
    blockers.push("Upload the tenant's Apple push certificate before issuing BYOD profiles.");

  return blockers;
};

/** Whether the discovery document may be exposed for this configuration. */
export const appleByodExposure = (input: {
  readonly enabled: boolean;
  readonly hardwareValidationRequired: boolean;
  readonly hardwareValidatedAt: Date | null;
}) =>
  input.enabled &&
  (!input.hardwareValidationRequired || input.hardwareValidatedAt !== null);

/**
 * Why an access token cannot be redeemed, or null when it is valid.
 */
export const appleByodTokenProblem = (input: {
  readonly organizationId: string;
  readonly storedOrganizationId: string;
  readonly requestHash: string;
  readonly storedRequestHash: string;
  readonly managedAppleAccount: string | null;
  readonly tokenExpiresAt: Date | null;
  readonly tokenConsumedAt: Date | null;
  readonly now?: Date;
}): "tenant_mismatch" | "request_mismatch" | "account_missing" | "expired" | "used" | null => {
  const now = (input.now ?? new Date()).getTime();

  if (input.storedOrganizationId !== input.organizationId) return "tenant_mismatch";

  if (input.storedRequestHash !== input.requestHash) return "request_mismatch";

  if (!input.managedAppleAccount) return "account_missing";

  if (!input.tokenExpiresAt || input.tokenExpiresAt.getTime() <= now) return "expired";

  if (input.tokenConsumedAt) return "used";

  return null;
};

/** Why a device challenge cannot be authorised, or null when it is live. */
export const appleByodChallengeProblem = (input: {
  readonly challengeExpiresAt: Date;
  readonly authorizedAt: Date | null;
  readonly tokenHash: string | null;
  readonly now?: Date;
}): "expired" | "used" | null => {
  if (input.challengeExpiresAt.getTime() <= (input.now ?? new Date()).getTime()) return "expired";

  if (input.authorizedAt || input.tokenHash) return "used";

  return null;
};
