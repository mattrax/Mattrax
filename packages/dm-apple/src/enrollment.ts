/**
 * Apple MDM enrollment profile builder.
 *
 * The payload shape mirrors Fleet's `GenerateEnrollmentProfileMobileconfig`
 * (see `server/mdm/apple/apple_mdm.go` in the Fleet repository) and the
 * production Mattrax implementation in
 * `crates/mx-api/src/v1/enrollment.rs`. Keep this a pure function: callers pass
 * the per-enrollment SCEP challenge and tenant identity explicitly.
 */
export type AppleEnrollmentProfileOptions = {
  /** Public server origin, without a trailing slash. */
  readonly origin: string;
  /** APNs/MDM topic for the tenant's push certificate. */
  readonly topic: string;
  /** Tenant/organization identifier written to the SCEP subject OU. */
  readonly organizationId: string;
  /** Human-readable tenant name written to the SCEP subject O. */
  readonly organizationName: string;
  /** Per-enrollment SCEP challenge password. */
  readonly challenge: string;
  readonly displayName?: string;
  readonly identifier?: string;
};

export type AppleEnrollmentProfile = {
  PayloadContent: Array<Record<string, unknown>>;
  PayloadDisplayName: string;
  PayloadIdentifier: string;
  PayloadOrganization: string;
  PayloadType: "Configuration";
  PayloadUUID: string;
  PayloadVersion: 1;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const buildAppleEnrollmentProfile = (
  options: AppleEnrollmentProfileOptions,
): AppleEnrollmentProfile => {
  const origin = trimTrailingSlash(options.origin);
  const scepUuid = crypto.randomUUID();
  const mdmUuid = crypto.randomUUID();
  const profileUuid = crypto.randomUUID();
  const displayName = options.displayName ?? `${options.organizationName} Enrollment`;

  return {
    PayloadContent: [
      {
        PayloadContent: {
          Challenge: options.challenge,
          "Key Type": "RSA",
          "Key Usage": 5,
          Keysize: 2048,
          Subject: [
            [["O", options.organizationName]],
            [["OU", options.organizationId]],
            [["CN", `${options.organizationName} Identity`]],
          ],
          URL: `${origin}/mdm/apple/scep`,
        },
        PayloadIdentifier: "com.mattrax.scep",
        PayloadType: "com.apple.security.scep",
        PayloadUUID: scepUuid,
        PayloadVersion: 1,
      },
      {
        AccessRights: 8191,
        CheckInURL: `${origin}/mdm/apple/mdm`,
        CheckOutWhenRemoved: true,
        IdentityCertificateUUID: scepUuid,
        PayloadIdentifier: "com.mattrax.mdm",
        PayloadType: "com.apple.mdm",
        PayloadUUID: mdmUuid,
        PayloadVersion: 1,
        ServerCapabilities: [
          "com.apple.mdm.per-user-connections",
          "com.apple.mdm.bootstraptoken",
          // Fleet explicitly requires the token capability for modern macOS
          // devices. Omitting it makes some devices skip bootstrap-token
          // escrow, so keep parity with Fleet and mttx.
          "com.apple.mdm.token",
        ],
        ServerURL: `${origin}/mdm/apple/mdm`,
        SignMessage: true,
        Topic: options.topic,
      },
    ],
    PayloadDisplayName: displayName,
    PayloadIdentifier: options.identifier ?? "com.mattrax.enrollment",
    PayloadOrganization: options.organizationName,
    PayloadType: "Configuration",
    PayloadUUID: profileUuid,
    PayloadVersion: 1,
  };
};
