import { PlistValue } from "@mattrax/plist";

/**
 * Apple MDM enrollment profile builder.
 *
 * Keep this a pure function: callers pass the per-enrollment SCEP challenge
 * and tenant identity explicitly so profile generation stays deterministic.
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
  /** Support address shown in the profile description. */
  readonly supportEmail?: string;
  /** Per-enrollment SCEP challenge password. */
  readonly challenge: string;
  /** Overrides the tenant-scoped SCEP URL (normally derived from organizationId). */
  readonly scepUrl?: string;
  readonly displayName?: string;
  readonly identifier?: string;
  /** Stable ADE profile UUID; defaults to the shared enrollment profile UUID. */
  readonly profileUuid?: string;
  /**
   * Issue an Apple User Enrollment (BYOD) profile.
   *
   * Account-driven enrollment requires the profile to name the Managed Apple
   * Account the device signs into (`AssignedManagedAppleID`) and to declare
   * `EnrollmentMode: BYOD`; `AccessRights` is forbidden because user
   * enrollment has a fixed, smaller set of rights.
   */
  readonly userEnrollment?: {
    /** Managed Apple Account the device must sign in with. */
    readonly managedAppleAccount: string;
  };
};

export type AppleEnrollmentPayload = {
  [key: string]: PlistValue;
};

export type AppleEnrollmentProfile = {
  PayloadContent: Array<AppleEnrollmentPayload>;
  PayloadDescription?: string;
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
  // Stable payload UUIDs let a re-served profile replace the existing MDM
  // payload instead of installing a second management profile.
  const scepUuid = "6D7C9A0E-1B2F-4C3D-8E4A-5F6B7C8D9E0F";
  const mdmUuid = "A1B2C3D4-E5F6-4789-9ABC-DEF012345678";

  const profileUuid =
    options.profileUuid ??
    (options.userEnrollment
      ? "C3D4E5F6-A7B8-4C9D-8E0F-1A2B3C4D5E6F"
      : "F0E1D2C3-B4A5-4968-8776-655443322110");

  const displayName = options.displayName ?? `${options.organizationName} Enrollment`;

  // SCEP is per tenant: the URL names the tenant so GetCACert and PKIOperation
  // resolve that tenant's CA and nothing else. A path segment (not a query
  // parameter) survives the `?operation=...` suffix SCEP clients append.
  const scepUrl =
    options.scepUrl ?? `${origin}/mdm/apple/scep/${encodeURIComponent(options.organizationId)}`;

  const commonMdmPayload = {
    CheckInURL: `${origin}/mdm/apple/mdm`,
    CheckOutWhenRemoved: true,
    IdentityCertificateUUID: scepUuid,
    PayloadIdentifier: "com.mattrax.mdm",
    PayloadType: "com.apple.mdm",
    PayloadUUID: mdmUuid,
    PayloadVersion: 1,
    ServerURL: `${origin}/mdm/apple/mdm`,
    SignMessage: true,
    Topic: options.topic,
  };

  // Apple User Enrollment (BYOD) must not declare `AccessRights` or the client
  // cancels the enrollment, names the Managed Apple Account the account-driven
  // flow signs into, and does not escrow a device-level bootstrap token from a
  // personally owned device.
  const mdmPayload = options.userEnrollment
    ? {
        ...commonMdmPayload,
        AssignedManagedAppleID: options.userEnrollment.managedAppleAccount,
        EnrollmentMode: "BYOD",
        ServerCapabilities: ["com.apple.mdm.per-user-connections"],
      }
    : {
        ...commonMdmPayload,
        AccessRights: 8191,
        ServerCapabilities: ["com.apple.mdm.per-user-connections", "com.apple.mdm.bootstraptoken"],
      };

  const profile: AppleEnrollmentProfile = {
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
          URL: scepUrl,
        },
        PayloadIdentifier: "com.mattrax.scep",
        PayloadType: "com.apple.security.scep",
        PayloadUUID: scepUuid,
        PayloadVersion: 1,
      },
      mdmPayload,
    ],
    PayloadDisplayName: displayName,
    PayloadIdentifier:
      options.identifier ??
      (options.userEnrollment ? "com.mattrax.enrollment.user" : "com.mattrax.enrollment"),
    PayloadOrganization: options.organizationName,
    PayloadType: "Configuration",
    PayloadUUID: profileUuid,
    PayloadVersion: 1,
  };

  if (options.supportEmail)
    profile.PayloadDescription = `Enrollment profile for ${options.organizationName}. Contact ${options.supportEmail} for support.`;

  return profile;
};

/**
 * The ADE *cloud configuration* Apple stores for a device management service.
 *
 * This is a JSON document, not a `.mobileconfig`: Apple retrieves it before
 * Setup Assistant and uses `url` to fetch the MDM enrollment profile from this
 * server. `await_device_configured` holds the device at the Remote Management
 * pane until the server sends `DeviceConfigured`; `is_return_to_service`
 * enables Return to Service with app preservation.
 *
 * Apple's Business API does not expose cloud-configuration registration, so a
 * tenant registers this document with Apple (automated with a legacy DEP
 * server token, or through Apple Configurator) after pointing `url` at the
 * tenant's ADE enrollment endpoint.
 */
export type AppleAdeConfigurationOptions = {
  /** Absolute URL of the ADE enrollment endpoint. */
  readonly url: string;
  readonly profileName: string;
  readonly organizationName?: string;
  readonly department?: string;
  readonly supportEmail?: string;
  readonly supportPhone?: string;
  readonly language?: string;
  readonly region?: string;
  /** Hold Setup Assistant until the server sends `DeviceConfigured`. */
  readonly awaitDeviceConfigured?: boolean;
  /** Enable Return to Service with app preservation (iOS 26+). */
  readonly returnToService?: boolean;
  readonly skipSetupItems?: ReadonlyArray<string>;
};

export type AppleAdeConfiguration = {
  profile_name: string;
  url: string;
  is_supervised: true;
  is_mdm_removable: false;
  is_mandatory: true;
  await_device_configured: boolean;
  is_return_to_service: boolean;
  support_email_address?: string;
  support_phone_number?: string;
  department?: string;
  language?: string;
  region?: string;
  skip_setup_items?: ReadonlyArray<string>;
};

export const buildAppleAdeConfiguration = (
  options: AppleAdeConfigurationOptions,
): AppleAdeConfiguration => {
  const url = options.url.trim();

  if (!url.startsWith("https://"))
    throw new Error("The ADE enrollment URL must use the https:// scheme");

  const configuration: AppleAdeConfiguration = {
    profile_name: options.profileName,
    url,
    is_supervised: true,
    // ADE devices are supervised; locking the MDM payload stops a user from
    // removing the tenant's management relationship.
    is_mdm_removable: false,
    is_mandatory: true,
    await_device_configured: options.awaitDeviceConfigured ?? true,
    is_return_to_service: options.returnToService ?? false,
  };

  if (options.supportEmail) configuration.support_email_address = options.supportEmail;

  if (options.supportPhone) configuration.support_phone_number = options.supportPhone;

  if (options.department) configuration.department = options.department;

  if (options.language) configuration.language = options.language;

  if (options.region) configuration.region = options.region;

  if (options.skipSetupItems && options.skipSetupItems.length > 0)
    configuration.skip_setup_items = [...options.skipSetupItems];

  return configuration;
};
