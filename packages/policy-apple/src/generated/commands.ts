// Auto-generated from https://github.com/apple/device-management
// Do not edit manually.

import { Schema } from "effect";

/**
 * Account Configuration Command
 * Create and configure a local administrator account on a device.
 */
export const Accountconfiguration = Schema.Struct({
  SkipPrimarySetupAccountCreation: Schema.optional(Schema.Boolean),
  SetPrimarySetupAccountAsRegularUser: Schema.optional(Schema.Boolean),
  PrimaryAccountFullName: Schema.optional(Schema.String),
  PrimaryAccountUserName: Schema.optional(Schema.String),
  DontAutoPopulatePrimaryAccountInfo: Schema.optional(Schema.Boolean),
  LockPrimaryAccountInfo: Schema.optional(Schema.Boolean),
  AutoSetupAdminAccounts: Schema.optional(
    Schema.Array(
      Schema.Struct({
        shortName: Schema.String,
        fullName: Schema.optional(Schema.String),
        passwordHash: Schema.optional(Schema.String),
        hidden: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
  ManagedLocalUserShortName: Schema.optional(Schema.String),
});
export type Accountconfiguration = typeof Accountconfiguration.Type;

/**
 * Active NSExtensions Command
 * Get a list of active extensions for a user on a device.
 */
export const Activensextensions = Schema.Struct({
  FilterExtensionPoints: Schema.optional(Schema.Array(Schema.String)),
});
export type Activensextensions = typeof Activensextensions.Type;

/**
 * Apply Redemption Code Command
 * Complete the installation of an app using a redemption code.
 */
export const Applyredemptioncode = Schema.Struct({
  Identifier: Schema.String,
  RedemptionCode: Schema.String,
});
export type Applyredemptioncode = typeof Applyredemptioncode.Type;

/**
 * Certificate List Command
 * Get a list of installed certificates on a device.
 */
export const Certificatelist = Schema.Struct({
  ManagedOnly: Schema.optional(Schema.Boolean),
});
export type Certificatelist = typeof Certificatelist.Type;

/**
 * Clear Passcode Command
 * Remove the passcode from a device.
 */
export const Clearpasscode = Schema.Struct({
  UnlockToken: Schema.String,
});
export type Clearpasscode = typeof Clearpasscode.Type;

/**
 * Declarative Management Command
 * Enable your server to support declarative management or trigger a declarative management synchronization operation on the device.
 */
export const Declarativemanagement = Schema.Struct({
  Data: Schema.optional(Schema.String),
});
export type Declarativemanagement = typeof Declarativemanagement.Type;

/**
 * Delete User Command
 * Delete a user's account from a device.
 */
export const Deleteuser = Schema.Struct({
  UserName: Schema.optional(Schema.String),
  ForceDeletion: Schema.optional(Schema.Boolean),
  DeleteAllUsers: Schema.optional(Schema.Boolean),
});
export type Deleteuser = typeof Deleteuser.Type;

/**
 * Device Information Command
 * Get detailed information about a device.
 */
export const Deviceinformation = Schema.Struct({
  Queries: Schema.Array(Schema.String),
  DeviceAttestationNonce: Schema.optional(Schema.String),
});
export type Deviceinformation = typeof Deviceinformation.Type;

/**
 * Device Lock Command
 * Remotely and immediately lock a device.
 */
export const Devicelock = Schema.Struct({
  Message: Schema.optional(Schema.String),
  PhoneNumber: Schema.optional(Schema.String),
  PIN: Schema.optional(Schema.String),
});
export type Devicelock = typeof Devicelock.Type;

/**
 * Enable Lost Mode Command
 * Enable Lost Mode on a device, which provides a message and phone number on the Lock Screen.
 */
export const Enablelostmode = Schema.Struct({
  Message: Schema.optional(Schema.String),
  PhoneNumber: Schema.optional(Schema.String),
  Footnote: Schema.optional(Schema.String),
});
export type Enablelostmode = typeof Enablelostmode.Type;

/**
 * Erase Device Command
 * Remotely and immediately erase a device.
 */
export const Erasedevice = Schema.Struct({
  PreserveDataPlan: Schema.optional(Schema.Boolean),
  DisallowProximitySetup: Schema.optional(Schema.Boolean),
  PIN: Schema.optional(Schema.String),
  ObliterationBehavior: Schema.optional(
    Schema.Literals(["Default", "DoNotObliterate", "ObliterateWithWarning", "Always"]),
  ),
  ReturnToService: Schema.optional(
    Schema.Struct({
      Enabled: Schema.Boolean,
      WiFiProfileData: Schema.optional(Schema.String),
      MDMProfileData: Schema.optional(Schema.String),
      BootstrapToken: Schema.optional(Schema.String),
    }),
  ),
});
export type Erasedevice = typeof Erasedevice.Type;

/**
 * Install Application Command
 * Install a third-party app on a device.
 */
export const Installapplication = Schema.Struct({
  iTunesStoreID: Schema.optional(Schema.Int),
  Identifier: Schema.optional(Schema.String),
  Options: Schema.optional(
    Schema.Struct({
      PurchaseMethod: Schema.optional(Schema.Literals([0, 1])),
    }),
  ),
  ManifestURL: Schema.optional(Schema.String),
  ManagementFlags: Schema.optional(Schema.Literals([1, 4, 5])),
  Configuration: Schema.optional(
    Schema.Struct({
      ANY: Schema.optional(Schema.Unknown /* <any> */),
    }),
  ),
  Attributes: Schema.optional(
    Schema.Struct({
      VPNUUID: Schema.optional(Schema.String),
      ContentFilterUUID: Schema.optional(Schema.String),
      DNSProxyUUID: Schema.optional(Schema.String),
      RelayUUID: Schema.optional(Schema.String),
      AssociatedDomains: Schema.optional(Schema.Array(Schema.String)),
      AssociatedDomainsEnableDirectDownloads: Schema.optional(Schema.Boolean),
      Removable: Schema.optional(Schema.Boolean),
      TapToPayScreenLock: Schema.optional(Schema.Boolean),
      CellularSliceUUID: Schema.optional(Schema.String),
      Hideable: Schema.optional(Schema.Boolean),
      Lockable: Schema.optional(Schema.Boolean),
    }),
  ),
  ChangeManagementState: Schema.optional(Schema.Literal("Managed")),
  InstallAsManaged: Schema.optional(Schema.Boolean),
  iOSApp: Schema.optional(Schema.Boolean),
});
export type Installapplication = typeof Installapplication.Type;

/**
 * Installed Application List Command
 * Get a list of the installed apps on a device.
 */
export const Installedapplicationlist = Schema.Struct({
  Identifiers: Schema.optional(Schema.Array(Schema.String)),
  ManagedAppsOnly: Schema.optional(Schema.Boolean),
  Items: Schema.optional(
    Schema.Array(
      Schema.Literals([
        "AdHocCodeSigned",
        "AppStoreVendable",
        "BetaApp",
        "BundleSize",
        "DeviceBasedVPP",
        "DistributorIdentifier",
        "DynamicSize",
        "ExternalVersionIdentifier",
        "HasUpdateAvailable",
        "Identifier",
        "Installing",
        "IsAppClip",
        "IsValidated",
        "Name",
        "ShortVersion",
        "Version",
      ]),
    ),
  ),
});
export type Installedapplicationlist = typeof Installedapplicationlist.Type;

/**
 * Install Enterprise Application Command
 * Install an enterprise app on a device.
 */
export const Installenterpriseapplication = Schema.Struct({
  Manifest: Schema.optional(
    Schema.Struct({
      ANY: Schema.optional(Schema.Unknown /* <any> */),
    }),
  ),
  ManifestURL: Schema.optional(Schema.String),
  ManifestURLPinningCerts: Schema.optional(Schema.Array(Schema.String)),
  PinningRevocationCheckRequired: Schema.optional(Schema.Boolean),
  InstallAsManaged: Schema.optional(Schema.Boolean),
  ManagementFlags: Schema.optional(Schema.Literal(1)),
  Configuration: Schema.optional(
    Schema.Struct({
      ANY: Schema.optional(Schema.Unknown /* <any> */),
    }),
  ),
  ChangeManagementState: Schema.optional(Schema.Literal("Managed")),
  iOSApp: Schema.optional(Schema.Boolean),
});
export type Installenterpriseapplication = typeof Installenterpriseapplication.Type;

/**
 * Install Media Command
 * Install a book on a device.
 */
export const Installmedia = Schema.Struct({
  iTunesStoreID: Schema.optional(Schema.Int),
  MediaURL: Schema.optional(Schema.String),
  MediaType: Schema.Literal("Book"),
  PersistentID: Schema.optional(Schema.String),
  Kind: Schema.optional(Schema.Literals(["pdf", "epub", "ibooks"])),
  Version: Schema.optional(Schema.String),
  Author: Schema.optional(Schema.String),
  Title: Schema.optional(Schema.String),
});
export type Installmedia = typeof Installmedia.Type;

/**
 * Install Profile Command
 * Install a configuration profile on a device.
 */
export const Installprofile = Schema.Struct({
  Payload: Schema.String,
});
export type Installprofile = typeof Installprofile.Type;

/**
 * Install Provisioning Profile Command
 * Install a provisioning profile on a device.
 */
export const Installprovisioningprofile = Schema.Struct({
  ProvisioningProfile: Schema.String,
});
export type Installprovisioningprofile = typeof Installprovisioningprofile.Type;

/**
 * Invite To Program Command
 * Invite a user to join the Volume Purchase Program (VPP).
 */
export const Invitetoprogram = Schema.Struct({
  ProgramID: Schema.Literal("com.apple.cloudvpp"),
  InvitationURL: Schema.String,
});
export type Invitetoprogram = typeof Invitetoprogram.Type;

/**
 * LOM Device Request Command
 * Send requests to a device using lights-out management (LOM).
 */
export const Lomdevicerequest = Schema.Struct({
  RequestList: Schema.Array(
    Schema.Struct({
      DeviceRequestType: Schema.Literals(["PowerON", "PowerOFF", "Reset"]),
      DeviceRequestUUID: Schema.String,
      DeviceDNSName: Schema.String,
      PrimaryIPv6AddressList: Schema.Array(Schema.String),
      SecondaryIPv6AddressList: Schema.Array(Schema.String),
      LOMProtocolVersion: Schema.Int,
    }),
  ),
});
export type Lomdevicerequest = typeof Lomdevicerequest.Type;

/**
 * Managed Application Attributes Command
 * Query attributes in managed apps on a device.
 */
export const Managedapplicationattributes = Schema.Struct({
  Identifiers: Schema.Array(Schema.String),
});
export type Managedapplicationattributes = typeof Managedapplicationattributes.Type;

/**
 * Managed Application Configuration Command
 * Get app configurations from managed apps on a device.
 */
export const Managedapplicationconfiguration = Schema.Struct({
  Identifiers: Schema.Array(Schema.String),
});
export type Managedapplicationconfiguration = typeof Managedapplicationconfiguration.Type;

/**
 * Managed Application Feedback Command
 * Get app feedback from a managed app on the device.
 */
export const Managedapplicationfeedback = Schema.Struct({
  Identifiers: Schema.Array(Schema.String),
  DeleteFeedback: Schema.optional(Schema.Boolean),
});
export type Managedapplicationfeedback = typeof Managedapplicationfeedback.Type;

/**
 * Managed Application List Command
 * Get the status of all managed apps on a device.
 */
export const Managedapplicationlist = Schema.Struct({
  Identifiers: Schema.optional(Schema.Array(Schema.String)),
});
export type Managedapplicationlist = typeof Managedapplicationlist.Type;

/**
 * Profile List Command
 * Get a list of installed profiles on a device.
 */
export const Profilelist = Schema.Struct({
  ManagedOnly: Schema.optional(Schema.Boolean),
});
export type Profilelist = typeof Profilelist.Type;

/**
 * Provisioning Profile List Command
 * Get a list of installed provisioning profiles on a device.
 */
export const Provisioningprofilelist = Schema.Struct({
  ManagedOnly: Schema.optional(Schema.Boolean),
});
export type Provisioningprofilelist = typeof Provisioningprofilelist.Type;

/**
 * Refresh Cellular Plans Command
 * Query a carrier URL for active eSIM cellular-plan profiles on a device.
 */
export const Refreshcellularplans = Schema.Struct({
  eSIMServerURL: Schema.String,
});
export type Refreshcellularplans = typeof Refreshcellularplans.Type;

/**
 * Remove Application Command
 * Remove an app.
 */
export const Removeapplication = Schema.Struct({
  Identifier: Schema.String,
});
export type Removeapplication = typeof Removeapplication.Type;

/**
 * Remove Media Command
 * Remove a previously installed book from a device.
 */
export const Removemedia = Schema.Struct({
  MediaType: Schema.Literal("Book"),
  iTunesStoreID: Schema.optional(Schema.String),
  PersistentID: Schema.optional(Schema.String),
});
export type Removemedia = typeof Removemedia.Type;

/**
 * Remove Profile Command
 * Remove a previously installed profile from the device.
 */
export const Removeprofile = Schema.Struct({
  Identifier: Schema.String,
});
export type Removeprofile = typeof Removeprofile.Type;

/**
 * Remove Provisioning Profile Command
 * Remove a previously installed provisioning profile from a device.
 */
export const Removeprovisioningprofile = Schema.Struct({
  UUID: Schema.String,
});
export type Removeprovisioningprofile = typeof Removeprovisioningprofile.Type;

/**
 * Request Mirroring Command
 * Prompt the user to share their screen using AirPlay Mirroring.
 */
export const Requestmirroring = Schema.Struct({
  DestinationName: Schema.optional(Schema.String),
  DestinationDeviceID: Schema.optional(Schema.String),
  ScanTime: Schema.optional(Schema.Int),
  Password: Schema.optional(Schema.String),
});
export type Requestmirroring = typeof Requestmirroring.Type;

/**
 * Restart Device Command
 * Remotely and immediately restart a device.
 */
export const Restartdevice = Schema.Struct({
  RebuildKernelCache: Schema.optional(Schema.Boolean),
  KextPaths: Schema.optional(Schema.Array(Schema.String)),
  NotifyUser: Schema.optional(Schema.Boolean),
});
export type Restartdevice = typeof Restartdevice.Type;

/**
 * Restrictions Command
 * Get a list of restrictions on the device.
 */
export const Restrictions = Schema.Struct({
  ProfileRestrictions: Schema.optional(Schema.Boolean),
});
export type Restrictions = typeof Restrictions.Type;

/**
 * Rotate FileVault Key Command
 * Change the FileVault primary password on a device.
 */
export const Rotatefilevaultkey = Schema.Struct({
  KeyType: Schema.Literals(["personal", "institutional"]),
  FileVaultUnlock: Schema.Struct({
    Password: Schema.optional(Schema.String),
    PrivateKeyExport: Schema.optional(Schema.String),
    PrivateKeyExportPassword: Schema.optional(Schema.String),
  }),
  NewCertificate: Schema.optional(Schema.String),
  ReplyEncryptionCertificate: Schema.optional(Schema.String),
});
export type Rotatefilevaultkey = typeof Rotatefilevaultkey.Type;

/**
 * Schedule OS Update Command
 * Schedule an update of the operating system on a device.
 */
export const Scheduleosupdate = Schema.Struct({
  Updates: Schema.Array(
    Schema.Struct({
      ProductKey: Schema.optional(Schema.String),
      ProductVersion: Schema.optional(Schema.String),
      InstallAction: Schema.Literals([
        "Default",
        "DownloadOnly",
        "InstallASAP",
        "NotifyOnly",
        "InstallLater",
        "InstallForceRestart",
      ]),
      MaxUserDeferrals: Schema.optional(Schema.Int),
      Priority: Schema.optional(Schema.Literals(["Low", "High"])),
    }),
  ),
});
export type Scheduleosupdate = typeof Scheduleosupdate.Type;

/**
 * Schedule OS Update Scan Command
 * Schedule a background scan for operating-system updates on a device.
 */
export const Scheduleosupdatescan = Schema.Struct({
  Force: Schema.optional(Schema.Boolean),
});
export type Scheduleosupdatescan = typeof Scheduleosupdatescan.Type;

/**
 * Set Auto Admin Password Command
 * Update the local administrator account password.
 */
export const Setautoadminpassword = Schema.Struct({
  GUID: Schema.String,
  passwordHash: Schema.String,
});
export type Setautoadminpassword = typeof Setautoadminpassword.Type;

/**
 * Set Firmware Password Command
 * Change or clear the firmware password on a device.
 */
export const Setfirmwarepassword = Schema.Struct({
  CurrentPassword: Schema.optional(Schema.String),
  NewPassword: Schema.String,
  AllowOroms: Schema.optional(Schema.Boolean),
});
export type Setfirmwarepassword = typeof Setfirmwarepassword.Type;

/**
 * Set Recovery Lock Command
 * Set or clear the Recovery Lock password.
 */
export const Setrecoverylock = Schema.Struct({
  CurrentPassword: Schema.optional(Schema.String),
  NewPassword: Schema.String,
});
export type Setrecoverylock = typeof Setrecoverylock.Type;

/**
 * Settings Command
 * Configure settings on a device.
 */
export const Settings = Schema.Struct({
  Settings: Schema.Array(
    Schema.Struct({
      Wallpaper: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("Wallpaper"),
          Image: Schema.String,
          Where: Schema.Literals([1, 2, 3]),
        }),
      ),
      DataRoaming: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("DataRoaming"),
          Enabled: Schema.Boolean,
        }),
      ),
      VoiceRoaming: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("VoiceRoaming"),
          Enabled: Schema.Boolean,
        }),
      ),
      PersonalHotspot: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("PersonalHotspot"),
          Enabled: Schema.Boolean,
        }),
      ),
      Bluetooth: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("Bluetooth"),
          Enabled: Schema.Boolean,
        }),
      ),
      ApplicationConfiguration: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("ApplicationConfiguration"),
          Identifier: Schema.String,
          Configuration: Schema.optional(
            Schema.Struct({
              ANY: Schema.optional(Schema.Unknown /* <any> */),
            }),
          ),
        }),
      ),
      ApplicationAttributes: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("ApplicationAttributes"),
          Identifier: Schema.String,
          Attributes: Schema.optional(
            Schema.Struct({
              VPNUUID: Schema.optional(Schema.String),
              ContentFilterUUID: Schema.optional(Schema.String),
              DNSProxyUUID: Schema.optional(Schema.String),
              RelayUUID: Schema.optional(Schema.String),
              AssociatedDomains: Schema.optional(Schema.Array(Schema.String)),
              AssociatedDomainsEnableDirectDownloads: Schema.optional(Schema.Boolean),
              Removable: Schema.optional(Schema.Boolean),
              TapToPayScreenLock: Schema.optional(Schema.Boolean),
              CellularSliceUUID: Schema.optional(Schema.String),
              Hideable: Schema.optional(Schema.Boolean),
              Lockable: Schema.optional(Schema.Boolean),
            }),
          ),
        }),
      ),
      DeviceName: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("DeviceName"),
          DeviceName: Schema.String,
        }),
      ),
      HostName: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("HostName"),
          HostName: Schema.String,
        }),
      ),
      OrganizationInfo: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("OrganizationInfo"),
          OrganizationInfo: Schema.optional(
            Schema.Struct({
              OrganizationName: Schema.String,
              OrganizationShortName: Schema.optional(Schema.String),
              OrganizationAddress: Schema.optional(Schema.String),
              OrganizationPhone: Schema.optional(Schema.String),
              OrganizationEmail: Schema.optional(Schema.String),
              OrganizationMagic: Schema.optional(Schema.String),
            }),
          ),
        }),
      ),
      DefaultApplications: Schema.optional(
        Schema.Struct({
          WebBrowser: Schema.optional(Schema.String),
          Calling: Schema.optional(Schema.String),
          Messaging: Schema.optional(Schema.String),
        }),
      ),
      MDMOptions: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("MDMOptions"),
          MDMOptions: Schema.Struct({
            ActivationLockAllowedWhileSupervised: Schema.optional(Schema.Boolean),
            BootstrapTokenAllowed: Schema.optional(Schema.Boolean),
            PromptUserToAllowBootstrapTokenForAuthentication: Schema.optional(Schema.Boolean),
            IdleRebootAllowed: Schema.optional(Schema.Boolean),
          }),
        }),
      ),
      MaximumResidentUsers: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("MaximumResidentUsers"),
          MaximumResidentUsers: Schema.Int,
        }),
      ),
      SharedDeviceConfiguration: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("SharedDeviceConfiguration"),
          QuotaSize: Schema.optional(Schema.Int),
          ResidentUsers: Schema.optional(Schema.Int),
          UserSessionTimeout: Schema.optional(Schema.Int),
          TemporarySessionTimeout: Schema.optional(Schema.Int),
          TemporarySessionOnly: Schema.optional(Schema.Boolean),
          ManagedAppleIDDefaultDomains: Schema.optional(Schema.Array(Schema.String)),
          OnlineAuthenticationGracePeriod: Schema.optional(Schema.Int),
          SkipLanguageAndLocaleSetupForNewUsers: Schema.optional(Schema.Boolean),
          AwaitUserConfiguration: Schema.optional(
            Schema.Struct({
              Enabled: Schema.Boolean,
            }),
          ),
          PasscodePolicy: Schema.optional(
            Schema.Struct({
              PasscodeLockGracePeriod: Schema.optional(
                Schema.Literals([0, 60, 300, 900, 3600, 14400]),
              ),
              AutoLockTime: Schema.optional(Schema.Int),
            }),
          ),
        }),
      ),
      DiagnosticSubmission: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("DiagnosticSubmission"),
          Enabled: Schema.Boolean,
        }),
      ),
      AppAnalytics: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("AppAnalytics"),
          Enabled: Schema.Boolean,
        }),
      ),
      PasscodeLockGracePeriod: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("PasscodeLockGracePeriod"),
          PasscodeLockGracePeriod: Schema.Literals([0, 60, 300, 900, 3600, 14400]),
        }),
      ),
      TimeZone: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("TimeZone"),
          TimeZone: Schema.String,
        }),
      ),
      SoftwareUpdateSettings: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("SoftwareUpdateSettings"),
          RecommendationCadence: Schema.Literals([0, 1, 2]),
        }),
      ),
      AccessibilitySettings: Schema.optional(
        Schema.Struct({
          Item: Schema.Literal("AccessibilitySettings"),
          BoldTextEnabled: Schema.optional(Schema.Boolean),
          IncreaseContrastEnabled: Schema.optional(Schema.Boolean),
          ReduceMotionEnabled: Schema.optional(Schema.Boolean),
          ReduceTransparencyEnabled: Schema.optional(Schema.Boolean),
          TextSize: Schema.optional(Schema.Literals([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])),
          TouchAccommodationsEnabled: Schema.optional(Schema.Boolean),
          VoiceOverEnabled: Schema.optional(Schema.Boolean),
          ZoomEnabled: Schema.optional(Schema.Boolean),
          GrayscaleEnabled: Schema.optional(Schema.Boolean),
        }),
      ),
    }),
  ),
});
export type Settings = typeof Settings.Type;

/**
 * Unlock User Account Command
 * Unlock a user account that the system locked because of too many failed password attempts.
 */
export const Unlockuseraccount = Schema.Struct({
  UserName: Schema.String,
});
export type Unlockuseraccount = typeof Unlockuseraccount.Type;

/**
 * Validate Applications Command
 * Force validation of developer and universal provisioning profiles for enterprise apps.
 */
export const Validateapplications = Schema.Struct({
  Identifiers: Schema.optional(Schema.Array(Schema.String)),
});
export type Validateapplications = typeof Validateapplications.Type;

/**
 * Verify Firmware Password Command
 * Verify the firmware password on a device.
 */
export const Verifyfirmwarepassword = Schema.Struct({
  Password: Schema.String,
});
export type Verifyfirmwarepassword = typeof Verifyfirmwarepassword.Type;

/**
 * Verify Recovery Lock Command
 * Verify the device's Recovery Lock password.
 */
export const Verifyrecoverylock = Schema.Struct({
  Password: Schema.String,
});
export type Verifyrecoverylock = typeof Verifyrecoverylock.Type;
