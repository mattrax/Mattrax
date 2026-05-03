// Auto-generated from https://github.com/apple/device-management
// Do not edit manually.

import { Schema } from "effect";

/**
 * Active Directory Certificate
 * The payload that configures Active Directory Certificate settings.
 */
export const ComAppleAdcertificateManaged = Schema.Struct({
  CertServer: Schema.String,
  CertTemplate: Schema.String,
  Description: Schema.optional(Schema.String),
  CertificateRenewalTimeInterval: Schema.optional(Schema.Int),
  CertificateAuthority: Schema.optional(Schema.String),
  CertificateAcquisitionMechanism: Schema.optional(Schema.String),
  AllowAllAppsAccess: Schema.optional(Schema.Boolean),
  PromptForCredentials: Schema.optional(Schema.Boolean),
  KeyIsExtractable: Schema.optional(Schema.Boolean),
  Keysize: Schema.optional(Schema.Int),
  EnableAutoRenewal: Schema.optional(Schema.Boolean)
});
export type ComAppleAdcertificateManaged = typeof ComAppleAdcertificateManaged.Type;

/**
 * AIM Account
 * The payload that configures an AIM account on the device.
 */
export const ComAppleAimAccount = Schema.Struct({
  AIMAccountDescription: Schema.optional(Schema.String),
  AIMHostName: Schema.Literal("slogin.oscar.aol.com"),
  AIMUserName: Schema.optional(Schema.String),
  AIMPassword: Schema.optional(Schema.String),
  AIMUseSSL: Schema.optional(Schema.Boolean),
  AIMPort: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(65535)))),
  AIMAuthentication: Schema.Literal("AIMAuthPassword")
});
export type ComAppleAimAccount = typeof ComAppleAimAccount.Type;

/**
 * AirPlay
 * The payload that configures AirPlay settings.
 */
export const ComAppleAirplay = Schema.Struct({
  AllowList: Schema.optional(Schema.Array(Schema.Struct({
    DeviceID: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^([0-9A-Fa-f]{2}:){5}([0-9A-Fa-f]{2})$/)))),
    DeviceName: Schema.optional(Schema.String)
  }))),
  Passwords: Schema.optional(Schema.Array(Schema.Struct({
    DeviceName: Schema.optional(Schema.String),
    Password: Schema.String,
    DeviceID: Schema.optional(Schema.String)
  }))),
  Whitelist: Schema.optional(Schema.Array(Schema.Struct({
    DeviceID: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^([0-9A-Fa-f]{2}:){5}([0-9A-Fa-f]{2})$/)))),
    DeviceName: Schema.optional(Schema.String)
  })))
});
export type ComAppleAirplay = typeof ComAppleAirplay.Type;

/**
 * AirPlay Security
 * The payload that configures Apple TV for a particular style of AirPlay security.
 */
export const ComAppleAirplaySecurity = Schema.Struct({
  SecurityType: Schema.Literals(["PASSCODE_ONCE", "PASSCODE_ALWAYS", "PASSWORD"]),
  AccessType: Schema.Literals(["ANY", "WIFI_ONLY"]),
  Password: Schema.optional(Schema.String)
});
export type ComAppleAirplaySecurity = typeof ComAppleAirplaySecurity.Type;

/**
 * AirPrint
 * The payload that configures AirPrint printer discoverability in the user's printer list.
 */
export const ComAppleAirprint = Schema.Struct({
  AirPrint: Schema.Array(Schema.Struct({
    IPAddress: Schema.String,
    ResourcePath: Schema.String,
    Port: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(65535)))),
    ForceTLS: Schema.optional(Schema.Boolean)
  }))
});
export type ComAppleAirprint = typeof ComAppleAirprint.Type;

/**
 * APN
 * The payload that configures access point names.
 */
export const ComAppleApnManaged = Schema.Struct({
  DefaultsData: Schema.Struct({
    apns: Schema.Array(Schema.Struct({
      apn: Schema.String,
      username: Schema.optional(Schema.String),
      password: Schema.optional(Schema.String),
      proxy: Schema.optional(Schema.String),
      proxyPort: Schema.optional(Schema.Int)
    }))
  }),
  DefaultsDomainName: Schema.Literal("com.apple.managedCarrier")
});
export type ComAppleApnManaged = typeof ComAppleApnManaged.Type;

/**
 * Restrictions
 * The payload that configures restrictions on a device.
 */
export const ComAppleApplicationaccess = Schema.Struct({
  allowAccountModification: Schema.optional(Schema.Boolean),
  allowActivityContinuation: Schema.optional(Schema.Boolean),
  allowAddingGameCenterFriends: Schema.optional(Schema.Boolean),
  allowAirDrop: Schema.optional(Schema.Boolean),
  allowAirPlayIncomingRequests: Schema.optional(Schema.Boolean),
  allowAirPrint: Schema.optional(Schema.Boolean),
  allowAirPrintCredentialsStorage: Schema.optional(Schema.Boolean),
  allowAirPrintiBeaconDiscovery: Schema.optional(Schema.Boolean),
  allowAppCellularDataModification: Schema.optional(Schema.Boolean),
  allowAppClips: Schema.optional(Schema.Boolean),
  allowAppInstallation: Schema.optional(Schema.Boolean),
  allowAppleIntelligenceReport: Schema.optional(Schema.Boolean),
  allowApplePersonalizedAdvertising: Schema.optional(Schema.Boolean),
  allowAppRemoval: Schema.optional(Schema.Boolean),
  allowAppsToBeHidden: Schema.optional(Schema.Boolean),
  allowAppsToBeLocked: Schema.optional(Schema.Boolean),
  allowARDRemoteManagementModification: Schema.optional(Schema.Boolean),
  allowAssistant: Schema.optional(Schema.Boolean),
  allowAssistantUserGeneratedContent: Schema.optional(Schema.Boolean),
  allowAssistantWhileLocked: Schema.optional(Schema.Boolean),
  allowAutoCorrection: Schema.optional(Schema.Boolean),
  allowAutoDim: Schema.optional(Schema.Boolean),
  allowAutomaticAppDownloads: Schema.optional(Schema.Boolean),
  allowAutomaticScreenSaver: Schema.optional(Schema.Boolean),
  allowAutoUnlock: Schema.optional(Schema.Boolean),
  allowBluetoothModification: Schema.optional(Schema.Boolean),
  allowBluetoothSharingModification: Schema.optional(Schema.Boolean),
  allowBookstore: Schema.optional(Schema.Boolean),
  allowBookstoreErotica: Schema.optional(Schema.Boolean),
  allowCallRecording: Schema.optional(Schema.Boolean),
  allowCamera: Schema.optional(Schema.Boolean),
  allowCellularPlanModification: Schema.optional(Schema.Boolean),
  allowChat: Schema.optional(Schema.Boolean),
  allowCloudAddressBook: Schema.optional(Schema.Boolean),
  allowCloudBackup: Schema.optional(Schema.Boolean),
  allowCloudBookmarks: Schema.optional(Schema.Boolean),
  allowCloudCalendar: Schema.optional(Schema.Boolean),
  allowCloudDesktopAndDocuments: Schema.optional(Schema.Boolean),
  allowCloudDocumentSync: Schema.optional(Schema.Boolean),
  allowCloudFreeform: Schema.optional(Schema.Boolean),
  allowCloudKeychainSync: Schema.optional(Schema.Boolean),
  allowCloudMail: Schema.optional(Schema.Boolean),
  allowCloudNotes: Schema.optional(Schema.Boolean),
  allowCloudPhotoLibrary: Schema.optional(Schema.Boolean),
  allowCloudPrivateRelay: Schema.optional(Schema.Boolean),
  allowCloudReminders: Schema.optional(Schema.Boolean),
  allowContentCaching: Schema.optional(Schema.Boolean),
  allowContinuousPathKeyboard: Schema.optional(Schema.Boolean),
  allowDefaultBrowserModification: Schema.optional(Schema.Boolean),
  allowDefaultCallingAppModification: Schema.optional(Schema.Boolean),
  allowDefaultMessagingAppModification: Schema.optional(Schema.Boolean),
  allowDefinitionLookup: Schema.optional(Schema.Boolean),
  allowDeviceNameModification: Schema.optional(Schema.Boolean),
  allowDeviceSleep: Schema.optional(Schema.Boolean),
  allowDiagnosticSubmission: Schema.optional(Schema.Boolean),
  allowDiagnosticSubmissionModification: Schema.optional(Schema.Boolean),
  allowDictation: Schema.optional(Schema.Boolean),
  allowedCameraRestrictionBundleIDs: Schema.optional(Schema.Array(Schema.String)),
  allowedExternalIntelligenceWorkspaceIDs: Schema.optional(Schema.Array(Schema.String)),
  allowEnablingRestrictions: Schema.optional(Schema.Boolean),
  allowEnterpriseAppTrust: Schema.optional(Schema.Boolean),
  allowEnterpriseBookBackup: Schema.optional(Schema.Boolean),
  allowEnterpriseBookMetadataSync: Schema.optional(Schema.Boolean),
  allowEraseContentAndSettings: Schema.optional(Schema.Boolean),
  allowESIMModification: Schema.optional(Schema.Boolean),
  allowESIMOutgoingTransfers: Schema.optional(Schema.Boolean),
  allowExplicitContent: Schema.optional(Schema.Boolean),
  allowExternalIntelligenceIntegrations: Schema.optional(Schema.Boolean),
  allowExternalIntelligenceIntegrationsSignIn: Schema.optional(Schema.Boolean),
  allowFileSharingModification: Schema.optional(Schema.Boolean),
  allowFilesNetworkDriveAccess: Schema.optional(Schema.Boolean),
  allowFilesUSBDriveAccess: Schema.optional(Schema.Boolean),
  allowFindMyDevice: Schema.optional(Schema.Boolean),
  allowFindMyFriends: Schema.optional(Schema.Boolean),
  allowFindMyFriendsModification: Schema.optional(Schema.Boolean),
  allowFingerprintForUnlock: Schema.optional(Schema.Boolean),
  allowFingerprintModification: Schema.optional(Schema.Boolean),
  allowGameCenter: Schema.optional(Schema.Boolean),
  allowGenmoji: Schema.optional(Schema.Boolean),
  allowGlobalBackgroundFetchWhenRoaming: Schema.optional(Schema.Boolean),
  allowHostPairing: Schema.optional(Schema.Boolean),
  allowImagePlayground: Schema.optional(Schema.Boolean),
  allowImageWand: Schema.optional(Schema.Boolean),
  allowInAppPurchases: Schema.optional(Schema.Boolean),
  allowInternetSharingModification: Schema.optional(Schema.Boolean),
  allowiPhoneMirroring: Schema.optional(Schema.Boolean),
  allowiPhoneWidgetsOnMac: Schema.optional(Schema.Boolean),
  allowiTunes: Schema.optional(Schema.Boolean),
  allowiTunesFileSharing: Schema.optional(Schema.Boolean),
  allowKeyboardShortcuts: Schema.optional(Schema.Boolean),
  allowListedAppBundleIDs: Schema.optional(Schema.Array(Schema.String)),
  allowLiveVoicemail: Schema.optional(Schema.Boolean),
  allowLocalUserCreation: Schema.optional(Schema.Boolean),
  allowLockScreenControlCenter: Schema.optional(Schema.Boolean),
  allowLockScreenNotificationsView: Schema.optional(Schema.Boolean),
  allowLockScreenTodayView: Schema.optional(Schema.Boolean),
  allowMailPrivacyProtection: Schema.optional(Schema.Boolean),
  allowMailSmartReplies: Schema.optional(Schema.Boolean),
  allowMailSummary: Schema.optional(Schema.Boolean),
  allowManagedAppsCloudSync: Schema.optional(Schema.Boolean),
  allowManagedToWriteUnmanagedContacts: Schema.optional(Schema.Boolean),
  allowMarketplaceAppInstallation: Schema.optional(Schema.Boolean),
  allowMediaSharingModification: Schema.optional(Schema.Boolean),
  allowMultiplayerGaming: Schema.optional(Schema.Boolean),
  allowMusicService: Schema.optional(Schema.Boolean),
  allowNews: Schema.optional(Schema.Boolean),
  allowNFC: Schema.optional(Schema.Boolean),
  allowNotesTranscription: Schema.optional(Schema.Boolean),
  allowNotesTranscriptionSummary: Schema.optional(Schema.Boolean),
  allowNotificationsModification: Schema.optional(Schema.Boolean),
  allowOpenFromManagedToUnmanaged: Schema.optional(Schema.Boolean),
  allowOpenFromUnmanagedToManaged: Schema.optional(Schema.Boolean),
  allowOTAPKIUpdates: Schema.optional(Schema.Boolean),
  allowPairedWatch: Schema.optional(Schema.Boolean),
  allowPassbookWhileLocked: Schema.optional(Schema.Boolean),
  allowPasscodeModification: Schema.optional(Schema.Boolean),
  allowPasswordAutoFill: Schema.optional(Schema.Boolean),
  allowPasswordProximityRequests: Schema.optional(Schema.Boolean),
  allowPasswordSharing: Schema.optional(Schema.Boolean),
  allowPersonalHotspotModification: Schema.optional(Schema.Boolean),
  allowPersonalizedHandwritingResults: Schema.optional(Schema.Boolean),
  allowPhotoStream: Schema.optional(Schema.Boolean),
  allowPodcasts: Schema.optional(Schema.Boolean),
  allowPredictiveKeyboard: Schema.optional(Schema.Boolean),
  allowPrinterSharingModification: Schema.optional(Schema.Boolean),
  allowProximitySetupToNewDevice: Schema.optional(Schema.Boolean),
  allowRadioService: Schema.optional(Schema.Boolean),
  allowRapidSecurityResponseInstallation: Schema.optional(Schema.Boolean),
  allowRapidSecurityResponseRemoval: Schema.optional(Schema.Boolean),
  allowRCSMessaging: Schema.optional(Schema.Boolean),
  allowRemoteAppleEventsModification: Schema.optional(Schema.Boolean),
  allowRemoteAppPairing: Schema.optional(Schema.Boolean),
  allowRemoteScreenObservation: Schema.optional(Schema.Boolean),
  allowRosettaUsageAwareness: Schema.optional(Schema.Boolean),
  allowSafari: Schema.optional(Schema.Boolean),
  allowSafariHistoryClearing: Schema.optional(Schema.Boolean),
  allowSafariPrivateBrowsing: Schema.optional(Schema.Boolean),
  allowSafariSummary: Schema.optional(Schema.Boolean),
  allowSatelliteConnection: Schema.optional(Schema.Boolean),
  allowScreenShot: Schema.optional(Schema.Boolean),
  allowSharedDeviceTemporarySession: Schema.optional(Schema.Boolean),
  allowSharedStream: Schema.optional(Schema.Boolean),
  allowSpellCheck: Schema.optional(Schema.Boolean),
  allowSpotlightInternetResults: Schema.optional(Schema.Boolean),
  allowStartupDiskModification: Schema.optional(Schema.Boolean),
  allowSystemAppRemoval: Schema.optional(Schema.Boolean),
  allowTimeMachineBackup: Schema.optional(Schema.Boolean),
  allowUIAppInstallation: Schema.optional(Schema.Boolean),
  allowUIConfigurationProfileInstallation: Schema.optional(Schema.Boolean),
  allowUniversalControl: Schema.optional(Schema.Boolean),
  allowUnmanagedToReadManagedContacts: Schema.optional(Schema.Boolean),
  allowUnpairedExternalBootToRecovery: Schema.optional(Schema.Boolean),
  allowUntrustedTLSPrompt: Schema.optional(Schema.Boolean),
  allowUSBRestrictedMode: Schema.optional(Schema.Boolean),
  allowVideoConferencing: Schema.optional(Schema.Boolean),
  allowVideoConferencingRemoteControl: Schema.optional(Schema.Boolean),
  allowVisualIntelligenceSummary: Schema.optional(Schema.Boolean),
  allowVoiceDialing: Schema.optional(Schema.Boolean),
  allowVPNCreation: Schema.optional(Schema.Boolean),
  allowWallpaperModification: Schema.optional(Schema.Boolean),
  allowWebDistributionAppInstallation: Schema.optional(Schema.Boolean),
  allowWritingTools: Schema.optional(Schema.Boolean),
  autonomousSingleAppModePermittedAppIDs: Schema.optional(Schema.Array(Schema.String)),
  blacklistedAppBundleIDs: Schema.optional(Schema.Array(Schema.String)),
  blockedAppBundleIDs: Schema.optional(Schema.Array(Schema.String)),
  deniedICCIDsForiMessageFaceTime: Schema.optional(Schema.Array(Schema.String)),
  deniedICCIDsForRCS: Schema.optional(Schema.Array(Schema.String)),
  enforcedFingerprintTimeout: Schema.optional(Schema.Int),
  enforcedSoftwareUpdateDelay: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(90)))),
  enforcedSoftwareUpdateMajorOSDeferredInstallDelay: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(90)))),
  enforcedSoftwareUpdateMinorOSDeferredInstallDelay: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(90)))),
  enforcedSoftwareUpdateNonOSDeferredInstallDelay: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(90)))),
  forceAirDropUnmanaged: Schema.optional(Schema.Boolean),
  forceAirPlayIncomingRequestsPairingPassword: Schema.optional(Schema.Boolean),
  forceAirPlayOutgoingRequestsPairingPassword: Schema.optional(Schema.Boolean),
  forceAirPrintTrustedTLSRequirement: Schema.optional(Schema.Boolean),
  forceAssistantProfanityFilter: Schema.optional(Schema.Boolean),
  forceAuthenticationBeforeAutoFill: Schema.optional(Schema.Boolean),
  forceAutomaticDateAndTime: Schema.optional(Schema.Boolean),
  forceBypassScreenCaptureAlert: Schema.optional(Schema.Boolean),
  forceClassroomAutomaticallyJoinClasses: Schema.optional(Schema.Boolean),
  forceClassroomRequestPermissionToLeaveClasses: Schema.optional(Schema.Boolean),
  forceClassroomUnpromptedAppAndDeviceLock: Schema.optional(Schema.Boolean),
  forceClassroomUnpromptedScreenObservation: Schema.optional(Schema.Boolean),
  forceDelayedAppSoftwareUpdates: Schema.optional(Schema.Boolean),
  forceDelayedMajorSoftwareUpdates: Schema.optional(Schema.Boolean),
  forceDelayedSoftwareUpdates: Schema.optional(Schema.Boolean),
  forceEncryptedBackup: Schema.optional(Schema.Boolean),
  forceITunesStorePasswordEntry: Schema.optional(Schema.Boolean),
  forceLimitAdTracking: Schema.optional(Schema.Boolean),
  forceOnDeviceOnlyDictation: Schema.optional(Schema.Boolean),
  forceOnDeviceOnlyTranslation: Schema.optional(Schema.Boolean),
  forcePreserveESIMOnErase: Schema.optional(Schema.Boolean),
  forceWatchWristDetection: Schema.optional(Schema.Boolean),
  forceWiFiPowerOn: Schema.optional(Schema.Boolean),
  forceWiFiToAllowedNetworksOnly: Schema.optional(Schema.Boolean),
  forceWiFiWhitelisting: Schema.optional(Schema.Boolean),
  ratingApps: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1000)))),
  ratingAppsExemptedBundleIDs: Schema.optional(Schema.Array(Schema.String)),
  ratingMovies: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1000)))),
  ratingRegion: Schema.optional(Schema.Literals(["us", "au", "ca", "de", "fr", "ie", "jp", "nz", "gb"])),
  ratingTVShows: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1000)))),
  requireManagedPasteboard: Schema.optional(Schema.Boolean),
  safariAcceptCookies: Schema.optional(Schema.Number),
  safariAllowAutoFill: Schema.optional(Schema.Boolean),
  safariAllowJavaScript: Schema.optional(Schema.Boolean),
  safariAllowPopups: Schema.optional(Schema.Boolean),
  safariForceFraudWarning: Schema.optional(Schema.Boolean),
  whitelistedAppBundleIDs: Schema.optional(Schema.Array(Schema.String))
});
export type ComAppleApplicationaccess = typeof ComAppleApplicationaccess.Type;

const makeWhitelistSubapps = (): Schema.Schema<any> => Schema.Struct({
    bundleID: Schema.String,
    appID: Schema.String,
    detachedSignature: Schema.optional(Schema.String),
    disabled: Schema.optional(Schema.Boolean),
    subApps: Schema.optional(Schema.Array(Schema.suspend(() => WhitelistSubapps))),
    displayName: Schema.optional(Schema.String)
  });
export const WhitelistSubapps = makeWhitelistSubapps();
export type WhitelistSubapps = typeof WhitelistSubapps.Type;

/**
 * Parental Controls: Application Restrictions
 * The payload that configures parental controls for apps.
 */
export const ComAppleApplicationaccessNew = Schema.Struct({
  familyControlsEnabled: Schema.Boolean,
  whiteList: Schema.optional(Schema.Array(Schema.Struct({
    bundleID: Schema.String,
    appID: Schema.String,
    detachedSignature: Schema.optional(Schema.String),
    disabled: Schema.optional(Schema.Boolean),
    subApps: Schema.optional(Schema.Array(Schema.suspend(() => WhitelistSubapps))),
    displayName: Schema.optional(Schema.String)
  }))),
  pathBlackList: Schema.optional(Schema.Array(Schema.String)),
  pathWhiteList: Schema.optional(Schema.Array(Schema.String))
});
export type ComAppleApplicationaccessNew = typeof ComAppleApplicationaccessNew.Type;

/**
 * App Lock
 * The payload that configures a device to run a single app.
 */
export const ComAppleAppLock = Schema.Struct({
  App: Schema.Struct({
    Identifier: Schema.String,
    Options: Schema.optional(Schema.Struct({
      DisableTouch: Schema.optional(Schema.Boolean),
      DisableDeviceRotation: Schema.optional(Schema.Boolean),
      DisableVolumeButtons: Schema.optional(Schema.Boolean),
      DisableRingerSwitch: Schema.optional(Schema.Boolean),
      DisableSleepWakeButton: Schema.optional(Schema.Boolean),
      DisableAutoLock: Schema.optional(Schema.Boolean),
      EnableVoiceOver: Schema.optional(Schema.Boolean),
      EnableZoom: Schema.optional(Schema.Boolean),
      EnableInvertColors: Schema.optional(Schema.Boolean),
      EnableAssistiveTouch: Schema.optional(Schema.Boolean),
      EnableSpeakSelection: Schema.optional(Schema.Boolean),
      EnableMonoAudio: Schema.optional(Schema.Boolean),
      EnableVoiceControl: Schema.optional(Schema.Boolean)
    })),
    UserEnabledOptions: Schema.optional(Schema.Struct({
      VoiceControl: Schema.optional(Schema.Boolean),
      VoiceOver: Schema.optional(Schema.Boolean),
      Zoom: Schema.optional(Schema.Boolean),
      InvertColors: Schema.optional(Schema.Boolean),
      AssistiveTouch: Schema.optional(Schema.Boolean)
    }))
  })
});
export type ComAppleAppLock = typeof ComAppleAppLock.Type;

/**
 * App Store
 * The payload that configures macOS App Store restrictions.
 */
export const ComAppleAppstore = Schema.Struct({
  "restrict-store-require-admin-to-install": Schema.optional(Schema.Boolean),
  "restrict-store-softwareupdate-only": Schema.optional(Schema.Boolean),
  "restrict-store-disable-app-adoption": Schema.optional(Schema.Boolean),
  DisableSoftwareUpdateNotifications: Schema.optional(Schema.Boolean)
});
export type ComAppleAppstore = typeof ComAppleAppstore.Type;

/**
 * Autonomous Single App Mode
 * The payload that configures Autonomous Single App mode.
 */
export const ComAppleAsam = Schema.Struct({
  AllowedApplications: Schema.Array(Schema.Struct({
    BundleIdentifier: Schema.String,
    TeamIdentifier: Schema.String
  }))
});
export type ComAppleAsam = typeof ComAppleAsam.Type;

/**
 * Content Caching
 * The payload that configures the Content Caching service.
 */
export const ComAppleAssetcacheManaged = Schema.Struct({
  AllowCacheDelete: Schema.optional(Schema.Boolean),
  AllowPersonalCaching: Schema.optional(Schema.Boolean),
  AllowSharedCaching: Schema.optional(Schema.Boolean),
  AutoActivation: Schema.optional(Schema.Boolean),
  AutoEnableTetheredCaching: Schema.optional(Schema.Boolean),
  CacheLimit: Schema.optional(Schema.Int),
  DataPath: Schema.optional(Schema.String),
  DenyTetheredCaching: Schema.optional(Schema.Boolean),
  DisplayAlerts: Schema.optional(Schema.Boolean),
  KeepAwake: Schema.optional(Schema.Boolean),
  ListenRanges: Schema.optional(Schema.Array(Schema.Struct({
    type: Schema.optional(Schema.Literals(["IPv4", "IPv6"])),
    first: Schema.String,
    last: Schema.String
  }))),
  ListenRangesOnly: Schema.optional(Schema.Boolean),
  ListenWithPeersAndParents: Schema.optional(Schema.Boolean),
  LocalSubnetsOnly: Schema.optional(Schema.Boolean),
  LogClientIdentity: Schema.optional(Schema.Boolean),
  Parents: Schema.optional(Schema.Array(Schema.String)),
  ParentSelectionPolicy: Schema.optional(Schema.Literals(["first-available", "url-path-hash", "random", "round-robin", "sticky-available"])),
  PeerFilterRanges: Schema.optional(Schema.Array(Schema.Struct({
    type: Schema.optional(Schema.Literals(["IPv4", "IPv6"])),
    first: Schema.String,
    last: Schema.String
  }))),
  PeerListenRanges: Schema.optional(Schema.Array(Schema.Struct({
    type: Schema.optional(Schema.Literals(["IPv4", "IPv6"])),
    first: Schema.String,
    last: Schema.String
  }))),
  PeerLocalSubnetsOnly: Schema.optional(Schema.Boolean),
  Port: Schema.optional(Schema.Int),
  PublicRanges: Schema.optional(Schema.Array(Schema.Struct({
    type: Schema.optional(Schema.Literals(["IPv4", "IPv6"])),
    first: Schema.String,
    last: Schema.String
  })))
});
export type ComAppleAssetcacheManaged = typeof ComAppleAssetcacheManaged.Type;

/**
 * Associated Domains
 * The payload that configures associated domains.
 */
export const ComAppleAssociatedDomains = Schema.Struct({
  Configuration: Schema.Array(Schema.Struct({
    ApplicationIdentifier: Schema.String,
    AssociatedDomains: Schema.Array(Schema.String),
    EnableDirectDownloads: Schema.optional(Schema.Boolean)
  }))
});
export type ComAppleAssociatedDomains = typeof ComAppleAssociatedDomains.Type;

/**
 * CalDAV
 * The payload that configures a Calendar account.
 */
export const ComAppleCaldavAccount = Schema.Struct({
  CalDAVAccountDescription: Schema.optional(Schema.String),
  CalDAVHostName: Schema.String,
  CalDAVUsername: Schema.optional(Schema.String),
  CalDAVPassword: Schema.optional(Schema.String),
  CalDAVPrincipalURL: Schema.optional(Schema.String),
  CalDAVUseSSL: Schema.optional(Schema.Boolean),
  CalDAVPort: Schema.optional(Schema.Int),
  VPNUUID: Schema.optional(Schema.String)
});
export type ComAppleCaldavAccount = typeof ComAppleCaldavAccount.Type;

/**
 * CardDAV
 * The payload that configures a Contacts account.
 */
export const ComAppleCarddavAccount = Schema.Struct({
  CardDAVAccountDescription: Schema.optional(Schema.String),
  CardDAVHostName: Schema.String,
  CardDAVUsername: Schema.optional(Schema.String),
  CardDAVPassword: Schema.optional(Schema.String),
  CardDAVPrincipalURL: Schema.optional(Schema.String),
  CardDAVUseSSL: Schema.optional(Schema.Boolean),
  CardDAVPort: Schema.optional(Schema.Int),
  CommunicationServiceRules: Schema.optional(Schema.Struct({
    DefaultServiceHandlers: Schema.optional(Schema.Struct({
      AudioCall: Schema.optional(Schema.String)
    }))
  })),
  VPNUUID: Schema.optional(Schema.String)
});
export type ComAppleCarddavAccount = typeof ComAppleCarddavAccount.Type;

/**
 * Cellular
 * The payload that configures cellular settings.
 */
export const ComAppleCellular = Schema.Struct({
  AttachAPN: Schema.optional(Schema.Struct({
    Name: Schema.String,
    AuthenticationType: Schema.optional(Schema.Literals(["CHAP", "PAP"])),
    Username: Schema.optional(Schema.String),
    Password: Schema.optional(Schema.String),
    AllowedProtocolMask: Schema.optional(Schema.Literals([1, 2, 3]))
  })),
  APNs: Schema.optional(Schema.Array(Schema.Struct({
    Name: Schema.String,
    AuthenticationType: Schema.optional(Schema.Literals(["CHAP", "PAP"])),
    Username: Schema.optional(Schema.String),
    Password: Schema.optional(Schema.String),
    ProxyServer: Schema.optional(Schema.String),
    ProxyPort: Schema.optional(Schema.Int),
    DefaultProtocolMask: Schema.optional(Schema.Literals([1, 2, 3])),
    AllowedProtocolMask: Schema.optional(Schema.Literals([1, 2, 3])),
    AllowedProtocolMaskInRoaming: Schema.optional(Schema.Literals([1, 2, 3])),
    AllowedProtocolMaskInDomesticRoaming: Schema.optional(Schema.Literals([1, 2, 3])),
    EnableXLAT464: Schema.optional(Schema.Boolean)
  })))
});
export type ComAppleCellular = typeof ComAppleCellular.Type;

/**
 * Cellular Private Network
 * The payload that provides device info on private network deployments, including geographical location, preference over Wi-Fi, and network deployment type.
 */
export const ComAppleCellularprivatenetworkManaged = Schema.Struct({
  Geofences: Schema.optional(Schema.Array(Schema.Struct({
    Longitude: Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(-180), Schema.isLessThanOrEqualTo(180))),
    Latitude: Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(-90), Schema.isLessThanOrEqualTo(90))),
    Radius: Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(100), Schema.isLessThanOrEqualTo(6500))),
    GeofenceId: Schema.String
  }))),
  DataSetName: Schema.String,
  VersionNumber: Schema.String,
  CellularDataPreferred: Schema.optional(Schema.Boolean),
  EnableNRStandalone: Schema.optional(Schema.Boolean),
  NetworkIdentifier: Schema.optional(Schema.String),
  CsgNetworkIdentifier: Schema.optional(Schema.String)
});
export type ComAppleCellularprivatenetworkManaged = typeof ComAppleCellularprivatenetworkManaged.Type;

/**
 * Conference Room Display
 * The payload that configures Conference Room Display mode for Apple TV.
 */
export const ComAppleConferenceroomdisplay = Schema.Struct({
  Message: Schema.optional(Schema.String)
});
export type ComAppleConferenceroomdisplay = typeof ComAppleConferenceroomdisplay.Type;

/**
 * Identification
 * The payload that configures the names of the account user.
 */
export const ComAppleConfigurationprofileIdentification = Schema.Struct({
  PayloadIdentification: Schema.Struct({
    UserName: Schema.String,
    FullName: Schema.String,
    EmailAddress: Schema.String,
    AuthMethod: Schema.Literals(["Password", "UserEnteredPassword"]),
    Password: Schema.String,
    Prompt: Schema.optional(Schema.String),
    PromptMessage: Schema.optional(Schema.String)
  })
});
export type ComAppleConfigurationprofileIdentification = typeof ComAppleConfigurationprofileIdentification.Type;

/**
 * Parental Controls: Dashboard Widget Restrictions
 * The payload that configures allowed dashboard widgets.
 */
export const ComAppleDashboard = Schema.Struct({
  whiteListEnabled: Schema.Boolean,
  WhiteList: Schema.Array(Schema.Struct({
    Type: Schema.String,
    ID: Schema.String
  }))
});
export type ComAppleDashboard = typeof ComAppleDashboard.Type;

/**
 * Declarations
 * The payload that applies a set of declarations to the device through the Settings app.
 */
export const ComAppleDeclarations = Schema.Struct({
  Declarations: Schema.Array(Schema.String)
});
export type ComAppleDeclarations = typeof ComAppleDeclarations.Type;

/**
 * Desktop
 * The payload that configures the desktop wallpaper.
 */
export const ComAppleDesktop = Schema.Struct({
  locked: Schema.optional(Schema.Boolean),
  "override-picture-path": Schema.optional(Schema.String)
});
export type ComAppleDesktop = typeof ComAppleDesktop.Type;

/**
 * Parental Controls: Dictionary
 * The payload that configures parental control dictionary restrictions.
 */
export const ComAppleDictionary = Schema.Struct({
  parentalControl: Schema.Boolean
});
export type ComAppleDictionary = typeof ComAppleDictionary.Type;

/**
 * Directory Service
 * The payload that configures an Active Directory (AD) domain.
 */
export const ComAppleDirectoryserviceManaged = Schema.Struct({
  HostName: Schema.String,
  UserName: Schema.optional(Schema.String),
  Password: Schema.optional(Schema.String),
  ClientID: Schema.optional(Schema.String),
  Description: Schema.optional(Schema.String),
  ADOrganizationalUnit: Schema.optional(Schema.String),
  ADMountStyle: Schema.optional(Schema.String),
  ADCreateMobileAccountAtLoginFlag: Schema.optional(Schema.Boolean),
  ADCreateMobileAccountAtLogin: Schema.optional(Schema.Boolean),
  ADWarnUserBeforeCreatingMAFlag: Schema.optional(Schema.Boolean),
  ADWarnUserBeforeCreatingMA: Schema.optional(Schema.Boolean),
  ADForceHomeLocalFlag: Schema.optional(Schema.Boolean),
  ADForceHomeLocal: Schema.optional(Schema.Boolean),
  ADUseWindowsUNCPathFlag: Schema.optional(Schema.Boolean),
  ADUseWindowsUNCPath: Schema.optional(Schema.Boolean),
  ADAllowMultiDomainAuthFlag: Schema.optional(Schema.Boolean),
  ADAllowMultiDomainAuth: Schema.optional(Schema.Boolean),
  ADDefaultUserShellFlag: Schema.optional(Schema.Boolean),
  ADDefaultUserShell: Schema.optional(Schema.String),
  ADMapUIDAttributeFlag: Schema.optional(Schema.Boolean),
  ADMapUIDAttribute: Schema.optional(Schema.String),
  ADMapGIDAttributeFlag: Schema.optional(Schema.Boolean),
  ADMapGIDAttribute: Schema.optional(Schema.String),
  ADMapGGIDAttributeFlag: Schema.optional(Schema.Boolean),
  ADMapGGIDAttribute: Schema.optional(Schema.String),
  ADPreferredDCServerFlag: Schema.optional(Schema.Boolean),
  ADPreferredDCServer: Schema.optional(Schema.String),
  ADDomainAdminGroupListFlag: Schema.optional(Schema.Boolean),
  ADDomainAdminGroupList: Schema.optional(Schema.Array(Schema.String)),
  ADNamespaceFlag: Schema.optional(Schema.Boolean),
  ADNamespace: Schema.optional(Schema.String),
  ADPacketSignFlag: Schema.optional(Schema.Boolean),
  ADPacketSign: Schema.optional(Schema.String),
  ADPacketEncryptFlag: Schema.optional(Schema.Boolean),
  ADPacketEncrypt: Schema.optional(Schema.String),
  ADRestrictDDNSFlag: Schema.optional(Schema.Boolean),
  ADRestrictDDNS: Schema.optional(Schema.Array(Schema.String)),
  ADTrustChangePassIntervalDaysFlag: Schema.optional(Schema.Boolean),
  ADTrustChangePassIntervalDays: Schema.optional(Schema.Int)
});
export type ComAppleDirectoryserviceManaged = typeof ComAppleDirectoryserviceManaged.Type;

/**
 * Media Management: Disc Burning
 * The payload that configures disc-burning settings.
 */
export const ComAppleDiscrecording = Schema.Struct({
  BurnSupport: Schema.Literals(["off", "authenticate", "on"])
});
export type ComAppleDiscrecording = typeof ComAppleDiscrecording.Type;

/**
 * DNS Proxy
 * The payload that configures DNS proxies.
 */
export const ComAppleDnsproxyManaged = Schema.Struct({
  AppBundleIdentifier: Schema.String,
  ProviderBundleIdentifier: Schema.optional(Schema.String),
  ProviderConfiguration: Schema.optional(Schema.Struct({
    ANY: Schema.optional(Schema.Unknown /* <any> */)
  })),
  DNSProxyUUID: Schema.optional(Schema.String)
});
export type ComAppleDnsproxyManaged = typeof ComAppleDnsproxyManaged.Type;

/**
 * DNS Settings
 * The payload that configures encrypted DNS settings.
 */
export const ComAppleDnssettingsManaged = Schema.Struct({
  DNSSettings: Schema.Struct({
    DNSProtocol: Schema.Literals(["HTTPS", "TLS"]),
    ServerURL: Schema.optional(Schema.String),
    ServerName: Schema.optional(Schema.String),
    ServerAddresses: Schema.optional(Schema.Array(Schema.String)),
    AllowFailover: Schema.optional(Schema.Boolean),
    PayloadCertificateUUID: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{12}$/)))),
    SupplementalMatchDomains: Schema.optional(Schema.Array(Schema.String))
  }),
  OnDemandRules: Schema.optional(Schema.Array(Schema.Struct({
    Action: Schema.Literals(["Connect", "Disconnect", "EvaluateConnection"]),
    ActionParameters: Schema.optional(Schema.Array(Schema.Struct({
      Domains: Schema.Array(Schema.String),
      DomainAction: Schema.Literals(["NeverConnect", "ConnectIfNeeded"])
    }))),
    DNSDomainMatch: Schema.optional(Schema.Array(Schema.String)),
    DNSServerAddressMatch: Schema.optional(Schema.Array(Schema.String)),
    InterfaceTypeMatch: Schema.optional(Schema.Literals(["Ethernet", "WiFi", "Cellular"])),
    SSIDMatch: Schema.optional(Schema.Array(Schema.String)),
    URLStringProbe: Schema.optional(Schema.String)
  }))),
  ProhibitDisablement: Schema.optional(Schema.Boolean)
});
export type ComAppleDnssettingsManaged = typeof ComAppleDnssettingsManaged.Type;

/**
 * Dock
 * The payload that configures the Dock.
 */
export const ComAppleDock = Schema.Struct({
  tilesize: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(16), Schema.isLessThanOrEqualTo(128)))),
  "size-immutable": Schema.optional(Schema.Boolean),
  magnification: Schema.optional(Schema.Boolean),
  "magnify-immutable": Schema.optional(Schema.Boolean),
  largesize: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(16), Schema.isLessThanOrEqualTo(128)))),
  "magsize-immutable": Schema.optional(Schema.Boolean),
  orientation: Schema.optional(Schema.Literals(["bottom", "left", "right"])),
  "position-immutable": Schema.optional(Schema.Boolean),
  mineffect: Schema.optional(Schema.Literals(["genie", "scale"])),
  "mineffect-immutable": Schema.optional(Schema.Boolean),
  windowtabbing: Schema.optional(Schema.Literals(["manual", "always", "fullscreen"])),
  "windowtabbing-immutable": Schema.optional(Schema.Boolean),
  dblclickbehavior: Schema.optional(Schema.Literals(["minimize", "maximize", "none"])),
  "dblclickbehavior-immutable": Schema.optional(Schema.Boolean),
  "minimize-to-application": Schema.optional(Schema.Boolean),
  "minintoapp-immutable": Schema.optional(Schema.Boolean),
  launchanim: Schema.optional(Schema.Boolean),
  "launchanim-immutable": Schema.optional(Schema.Boolean),
  autohide: Schema.optional(Schema.Boolean),
  "autohide-immutable": Schema.optional(Schema.Boolean),
  "show-process-indicators": Schema.optional(Schema.Boolean),
  "showindicators-immutable": Schema.optional(Schema.Boolean),
  "show-recents": Schema.optional(Schema.Boolean),
  "showrecents-immutable": Schema.optional(Schema.Boolean),
  "contents-immutable": Schema.optional(Schema.Boolean),
  MCXDockSpecialFolders: Schema.optional(Schema.Array(Schema.Literals(["AddDockMCXMyApplicationsFolder", "AddDockMCXDocumentsFolder", "AddDockMCXSharedFolder", "AddDockMCXOriginalNetworkHomeFolder"]))),
  AllowDockFixupOverride: Schema.optional(Schema.Boolean),
  "static-only": Schema.optional(Schema.Boolean),
  "static-others": Schema.optional(Schema.Array(Schema.Struct({
    "tile-data": Schema.Struct({
      label: Schema.String,
      url: Schema.optional(Schema.String),
      "file-type": Schema.Literals([0, 1, 3]),
      "file-data": Schema.optional(Schema.Struct({
        ANY: Schema.optional(Schema.Unknown /* <any> */)
      }))
    }),
    "tile-type": Schema.Literals(["file-tile", "directory-tile", "url-tile"])
  }))),
  "static-apps": Schema.optional(Schema.Array(Schema.Struct({
    "tile-data": Schema.Struct({
      label: Schema.String,
      url: Schema.optional(Schema.String),
      "file-type": Schema.Literals([0, 1, 3]),
      "file-data": Schema.optional(Schema.Struct({
        ANY: Schema.optional(Schema.Unknown /* <any> */)
      }))
    }),
    "tile-type": Schema.Literals(["file-tile", "directory-tile", "url-tile"])
  }))),
  "persistent-apps": Schema.optional(Schema.Array(Schema.Struct({
    "tile-data": Schema.Struct({
      label: Schema.String,
      url: Schema.optional(Schema.String),
      "file-type": Schema.Literals([0, 1, 3]),
      "file-data": Schema.optional(Schema.Struct({
        ANY: Schema.optional(Schema.Unknown /* <any> */)
      }))
    }),
    "tile-type": Schema.Literals(["file-tile", "directory-tile", "url-tile"])
  }))),
  "persistent-others": Schema.optional(Schema.Array(Schema.Struct({
    "tile-data": Schema.Struct({
      label: Schema.String,
      url: Schema.optional(Schema.String),
      "file-type": Schema.Literals([0, 1, 3]),
      "file-data": Schema.optional(Schema.Struct({
        ANY: Schema.optional(Schema.Unknown /* <any> */)
      }))
    }),
    "tile-type": Schema.Literals(["file-tile", "directory-tile", "url-tile"])
  })))
});
export type ComAppleDock = typeof ComAppleDock.Type;

/**
 * Domains
 * The payload that configures the domains under an organization's management.
 */
export const ComAppleDomains = Schema.Struct({
  EmailDomains: Schema.optional(Schema.Array(Schema.String)),
  WebDomains: Schema.optional(Schema.Array(Schema.String)),
  SafariPasswordAutoFillDomains: Schema.optional(Schema.Array(Schema.String)),
  CrossSiteTrackingPreventionRelaxedDomains: Schema.optional(Schema.Array(Schema.String)),
  CrossSiteTrackingPreventionRelaxedApps: Schema.optional(Schema.Array(Schema.String))
});
export type ComAppleDomains = typeof ComAppleDomains.Type;

/**
 * Exchange ActiveSync
 * The payload that configures Exchange ActiveSync accounts.
 */
export const ComAppleEasAccount = Schema.Struct({
  EmailAddress: Schema.optional(Schema.String),
  Host: Schema.optional(Schema.String),
  SSL: Schema.optional(Schema.Boolean),
  OAuth: Schema.optional(Schema.Boolean),
  UserName: Schema.optional(Schema.String),
  Password: Schema.optional(Schema.String),
  Certificate: Schema.optional(Schema.String),
  CertificateName: Schema.optional(Schema.String),
  CertificatePassword: Schema.optional(Schema.String),
  PreventMove: Schema.optional(Schema.Boolean),
  PreventAppSheet: Schema.optional(Schema.Boolean),
  PayloadCertificateUUID: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{12}$/)))),
  SMIMEEnabled: Schema.optional(Schema.Boolean),
  SMIMESigningEnabled: Schema.optional(Schema.Boolean),
  SMIMESigningCertificateUUID: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{12}$/)))),
  SMIMEEncryptionEnabled: Schema.optional(Schema.Boolean),
  SMIMEEncryptionCertificateUUID: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{12}$/)))),
  SMIMEEnablePerMessageSwitch: Schema.optional(Schema.Boolean),
  disableMailRecentsSyncing: Schema.optional(Schema.Boolean),
  MailNumberOfPastDaysToSync: Schema.optional(Schema.Literals([0, 1, 3, 7, 14, 31])),
  HeaderMagic: Schema.optional(Schema.String),
  CommunicationServiceRules: Schema.optional(Schema.Struct({
    DefaultServiceHandlers: Schema.optional(Schema.Struct({
      AudioCall: Schema.optional(Schema.String)
    }))
  })),
  allowMailDrop: Schema.optional(Schema.Boolean),
  SMIMESigningUserOverrideable: Schema.optional(Schema.Boolean),
  SMIMESigningCertificateUUIDUserOverrideable: Schema.optional(Schema.Boolean),
  SMIMEEncryptByDefault: Schema.optional(Schema.Boolean),
  SMIMEEncryptByDefaultUserOverrideable: Schema.optional(Schema.Boolean),
  SMIMEEncryptionCertificateUUIDUserOverrideable: Schema.optional(Schema.Boolean),
  SMIMEEnableEncryptionPerMessageSwitch: Schema.optional(Schema.Boolean),
  EnableMail: Schema.optional(Schema.Boolean),
  EnableContacts: Schema.optional(Schema.Boolean),
  EnableCalendars: Schema.optional(Schema.Boolean),
  EnableReminders: Schema.optional(Schema.Boolean),
  EnableNotes: Schema.optional(Schema.Boolean),
  EnableMailUserOverridable: Schema.optional(Schema.Boolean),
  EnableContactsUserOverridable: Schema.optional(Schema.Boolean),
  EnableCalendarsUserOverridable: Schema.optional(Schema.Boolean),
  EnableRemindersUserOverridable: Schema.optional(Schema.Boolean),
  EnableNotesUserOverridable: Schema.optional(Schema.Boolean),
  OAuthSignInURL: Schema.optional(Schema.String),
  OAuthTokenRequestURL: Schema.optional(Schema.String),
  OverridePreviousPassword: Schema.optional(Schema.Boolean),
  VPNUUID: Schema.optional(Schema.String)
});
export type ComAppleEasAccount = typeof ComAppleEasAccount.Type;

/**
 * Education Configuration
 * The payload that configures the users, groups, and departments within an educational organization.
 */
export const ComAppleEducation = Schema.Struct({
  OrganizationUUID: Schema.String,
  OrganizationName: Schema.String,
  PayloadCertificateUUID: Schema.optional(Schema.String),
  LeaderPayloadCertificateAnchorUUID: Schema.optional(Schema.Array(Schema.String)),
  MemberPayloadCertificateAnchorUUID: Schema.optional(Schema.Array(Schema.String)),
  ResourcePayloadCertificateUUID: Schema.optional(Schema.String),
  UserIdentifier: Schema.String,
  Departments: Schema.optional(Schema.Array(Schema.Struct({
    Name: Schema.String,
    GroupBeaconIDs: Schema.Array(Schema.Int)
  }))),
  Groups: Schema.Array(Schema.Struct({
    BeaconID: Schema.Int,
    Name: Schema.String,
    Description: Schema.optional(Schema.String),
    ImageURL: Schema.optional(Schema.String),
    ConfigurationSource: Schema.optional(Schema.String),
    LeaderIdentifiers: Schema.optional(Schema.Array(Schema.String)),
    MemberIdentifiers: Schema.Array(Schema.String),
    DeviceGroupIdentifiers: Schema.optional(Schema.Array(Schema.String))
  })),
  Users: Schema.Array(Schema.Struct({
    Identifier: Schema.String,
    Name: Schema.String,
    GivenName: Schema.optional(Schema.String),
    FamilyName: Schema.optional(Schema.String),
    PhoneticGivenName: Schema.optional(Schema.String),
    PhoneticFamilyName: Schema.optional(Schema.String),
    ImageURL: Schema.optional(Schema.String),
    FullScreenImageURL: Schema.optional(Schema.String),
    AppleID: Schema.optional(Schema.String),
    PasscodeType: Schema.optional(Schema.Literals(["complex", "four", "six"]))
  })),
  DeviceGroups: Schema.optional(Schema.Array(Schema.Struct({
    Identifier: Schema.String,
    Name: Schema.String,
    SerialNumbers: Schema.Array(Schema.String)
  }))),
  ScreenObservationPermissionModificationAllowed: Schema.optional(Schema.Boolean)
});
export type ComAppleEducation = typeof ComAppleEducation.Type;

/**
 * Exchange Web Services
 * The payload that configures an Exchange Web Services accounts.
 */
export const ComAppleEwsAccount = Schema.Struct({
  EmailAddress: Schema.optional(Schema.String),
  Host: Schema.optional(Schema.String),
  SSL: Schema.optional(Schema.Boolean),
  OAuth: Schema.optional(Schema.Boolean),
  OAuthSignInURL: Schema.optional(Schema.String),
  UserName: Schema.optional(Schema.String),
  Password: Schema.optional(Schema.String),
  PayloadCertificateUUID: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{12}$/)))),
  AuthenticationCertificateUUID: Schema.optional(Schema.String),
  allowMailDrop: Schema.optional(Schema.Boolean),
  Path: Schema.optional(Schema.String),
  Port: Schema.optional(Schema.Int),
  ExternalHost: Schema.optional(Schema.String),
  ExternalSSL: Schema.optional(Schema.Boolean),
  ExternalPath: Schema.optional(Schema.String),
  ExternalPort: Schema.optional(Schema.Int)
});
export type ComAppleEwsAccount = typeof ComAppleEwsAccount.Type;

/**
 * Extensible Single Sign-On (Kerberos)
 * The payload that configures an app extension that performs single sign-on with the Kerberos extension.
 */
export const ComAppleExtensiblesso = Schema.Struct({
  ExtensionIdentifier: Schema.Literal("com.apple.AppSSOKerberos.KerberosExtension"),
  TeamIdentifier: Schema.Literal("apple"),
  Type: Schema.Literal("Credential"),
  Realm: Schema.String,
  ExtensionData: Schema.optional(Schema.Struct({
    cacheName: Schema.optional(Schema.String),
    principalName: Schema.optional(Schema.String),
    siteCode: Schema.optional(Schema.String),
    certificateUUID: Schema.optional(Schema.String),
    useSiteAutoDiscovery: Schema.optional(Schema.Boolean),
    credentialBundleIdACL: Schema.optional(Schema.Array(Schema.String)),
    includeManagedAppsInBundleIdACL: Schema.optional(Schema.Boolean),
    includeKerberosAppsInBundleIdACL: Schema.optional(Schema.Boolean),
    domainRealmMapping: Schema.optional(Schema.Struct({
      Realm: Schema.optional(Schema.Array(Schema.String))
    })),
    isDefaultRealm: Schema.optional(Schema.Boolean),
    customUsernameLabel: Schema.optional(Schema.String),
    helpText: Schema.optional(Schema.String),
    allowPasswordChange: Schema.optional(Schema.Boolean),
    allowAutomaticLogin: Schema.optional(Schema.Boolean),
    requireUserPresence: Schema.optional(Schema.Boolean),
    pwExpireOverride: Schema.optional(Schema.Int),
    pwNotificationDays: Schema.optional(Schema.Int),
    pwReqLength: Schema.optional(Schema.Int),
    pwReqComplexity: Schema.optional(Schema.Boolean),
    pwReqMinAge: Schema.optional(Schema.Int),
    pwReqHistory: Schema.optional(Schema.Int),
    pwReqText: Schema.optional(Schema.String),
    pwReqRTFData: Schema.optional(Schema.String),
    pwChangeURL: Schema.optional(Schema.String),
    syncLocalPassword: Schema.optional(Schema.Boolean),
    replicationTime: Schema.optional(Schema.Int),
    delayUserSetup: Schema.optional(Schema.Boolean),
    monitorCredentialsCache: Schema.optional(Schema.Boolean),
    requireTLSForLDAP: Schema.optional(Schema.Boolean),
    credentialUseMode: Schema.optional(Schema.Literals(["always", "whenNotSpecified", "kerberosDefault"])),
    preferredKDCs: Schema.optional(Schema.Array(Schema.String)),
    usePlatformSSOTGT: Schema.optional(Schema.Boolean),
    allowPlatformSSOAuthFallback: Schema.optional(Schema.Boolean),
    performKerberosOnly: Schema.optional(Schema.Boolean),
    identityIssuerAutoSelectFilter: Schema.optional(Schema.String),
    allowSmartCard: Schema.optional(Schema.Boolean),
    allowPassword: Schema.optional(Schema.Boolean),
    startInSmartCardMode: Schema.optional(Schema.Boolean)
  })),
  Hosts: Schema.optional(Schema.Array(Schema.String))
});
export type ComAppleExtensiblesso = typeof ComAppleExtensiblesso.Type;

/**
 * Extensible Single Sign-On
 * The payload that configures an app extension that performs single sign-on (SSO).
 */
export const ComAppleExtensiblesso1 = Schema.Struct({
  ExtensionIdentifier: Schema.String,
  TeamIdentifier: Schema.optional(Schema.String),
  Type: Schema.Literals(["Credential", "Redirect"]),
  Realm: Schema.optional(Schema.String),
  ExtensionData: Schema.optional(Schema.Struct({
    ANY: Schema.optional(Schema.Unknown /* <any> */)
  })),
  URLs: Schema.optional(Schema.Array(Schema.String)),
  Hosts: Schema.optional(Schema.Array(Schema.String)),
  ScreenLockedBehavior: Schema.optional(Schema.Literals(["Cancel", "DoNotHandle"])),
  DeniedBundleIdentifiers: Schema.optional(Schema.Array(Schema.String)),
  AuthenticationMethod: Schema.optional(Schema.Literals(["Password", "UserSecureEnclaveKey"])),
  RegistrationToken: Schema.optional(Schema.String),
  PlatformSSO: Schema.optional(Schema.Struct({
    AuthenticationMethod: Schema.optional(Schema.Literals(["Password", "UserSecureEnclaveKey", "SmartCard"])),
    UseSharedDeviceKeys: Schema.optional(Schema.Boolean),
    AccountDisplayName: Schema.optional(Schema.String),
    LoginFrequency: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(3600)))),
    EnableCreateUserAtLogin: Schema.optional(Schema.Boolean),
    EnableCreateFirstUserDuringSetup: Schema.optional(Schema.Boolean),
    EnableAuthorization: Schema.optional(Schema.Boolean),
    TokenToUserMapping: Schema.optional(Schema.Struct({
      AccountName: Schema.optional(Schema.String),
      FullName: Schema.optional(Schema.String)
    })),
    NewUserAuthenticationMethods: Schema.optional(Schema.Array(Schema.Literals(["Password", "SmartCard", "AccessKey"]))),
    NewUserAuthorizationMode: Schema.optional(Schema.Literals(["Standard", "Admin", "Groups", "Temporary"])),
    UserAuthorizationMode: Schema.optional(Schema.Literals(["Standard", "Admin", "Groups"])),
    AdministratorGroups: Schema.optional(Schema.Array(Schema.String)),
    AdditionalGroups: Schema.optional(Schema.Array(Schema.String)),
    AuthorizationGroups: Schema.optional(Schema.Struct({
      ANY: Schema.optional(Schema.String)
    })),
    AccessKeyReaderGroupIdentifier: Schema.optional(Schema.String),
    AccessKeyTerminalIdentityUUID: Schema.optional(Schema.String),
    AccessKeyReaderIssuerCertificateUUID: Schema.optional(Schema.String),
    AllowAccessKeyExpressMode: Schema.optional(Schema.Boolean),
    FileVaultPolicy: Schema.optional(Schema.Array(Schema.Literals(["AttemptAuthentication", "RequireAuthentication", "AllowOfflineGracePeriod", "AllowAuthenticationGracePeriod"]))),
    LoginPolicy: Schema.optional(Schema.Array(Schema.Literals(["AttemptAuthentication", "RequireAuthentication", "AllowOfflineGracePeriod", "AllowAuthenticationGracePeriod"]))),
    UnlockPolicy: Schema.optional(Schema.Array(Schema.Literals(["AttemptAuthentication", "RequireAuthentication", "AllowOfflineGracePeriod", "AllowAuthenticationGracePeriod", "AllowTouchIDOrWatchForUnlock"]))),
    OfflineGracePeriod: Schema.optional(Schema.Int),
    AuthenticationGracePeriod: Schema.optional(Schema.Int),
    NonPlatformSSOAccounts: Schema.optional(Schema.Array(Schema.String)),
    AllowDeviceIdentifiersInAttestation: Schema.optional(Schema.Boolean),
    SynchronizeProfilePicture: Schema.optional(Schema.Boolean),
    TemporarySessionQuickLogin: Schema.optional(Schema.Boolean),
    EnableRegistrationDuringSetup: Schema.optional(Schema.Boolean)
  }))
});
export type ComAppleExtensiblesso1 = typeof ComAppleExtensiblesso1.Type;

/**
 * Parental Controls: Content Filter
 * The payload that configures the parental control web content filters.
 */
export const ComAppleFamilycontrolsContentfilter = Schema.Struct({
  restrictWeb: Schema.Boolean,
  useContentFilter: Schema.optional(Schema.Boolean),
  allowListEnabled: Schema.optional(Schema.Boolean),
  whitelistEnabled: Schema.optional(Schema.Boolean),
  siteAllowList: Schema.optional(Schema.Array(Schema.Struct({
    address: Schema.String,
    pageTitle: Schema.optional(Schema.String)
  }))),
  siteWhitelist: Schema.optional(Schema.Array(Schema.Struct({
    address: Schema.String,
    pageTitle: Schema.optional(Schema.String)
  }))),
  filterAllowList: Schema.optional(Schema.Array(Schema.String)),
  filterWhitelist: Schema.optional(Schema.Array(Schema.String)),
  filterDenyList: Schema.optional(Schema.Array(Schema.String)),
  filterBlacklist: Schema.optional(Schema.Array(Schema.String))
});
export type ComAppleFamilycontrolsContentfilter = typeof ComAppleFamilycontrolsContentfilter.Type;

/**
 * Parental Controls: Time Limits
 * The payload that configures parental control time limits.
 */
export const ComAppleFamilycontrolsTimelimitsV2 = Schema.Struct({
  familyControlsEnabled: Schema.Boolean,
  "time-limits": Schema.optional(Schema.Struct({
    "weekday-allowance": Schema.optional(Schema.Struct({
      enabled: Schema.Boolean,
      rangeType: Schema.Literals([0, 1]),
      start: Schema.optional(Schema.String),
      end: Schema.optional(Schema.String),
      secondsPerDay: Schema.optional(Schema.Int)
    })),
    "weekday-curfew": Schema.optional(Schema.Struct({
      enabled: Schema.Boolean,
      rangeType: Schema.Literals([0, 1]),
      start: Schema.optional(Schema.String),
      end: Schema.optional(Schema.String),
      secondsPerDay: Schema.optional(Schema.Int)
    })),
    "weekend-allowance": Schema.optional(Schema.Struct({
      enabled: Schema.Boolean,
      rangeType: Schema.Literals([0, 1]),
      start: Schema.optional(Schema.String),
      end: Schema.optional(Schema.String),
      secondsPerDay: Schema.optional(Schema.Int)
    })),
    "weekend-curfew": Schema.optional(Schema.Struct({
      enabled: Schema.Boolean,
      rangeType: Schema.Literals([0, 1]),
      start: Schema.optional(Schema.String),
      end: Schema.optional(Schema.String),
      secondsPerDay: Schema.optional(Schema.Int)
    }))
  }))
});
export type ComAppleFamilycontrolsTimelimitsV2 = typeof ComAppleFamilycontrolsTimelimitsV2.Type;

/**
 * File Provider
 * The payload that configures file provider settings.
 */
export const ComAppleFileproviderd = Schema.Struct({
  ManagementAllowsRemoteSyncing: Schema.optional(Schema.Boolean),
  ManagementRemoteSyncingAllowList: Schema.optional(Schema.Array(Schema.String)),
  AllowManagedFileProvidersToRequestAttribution: Schema.optional(Schema.Boolean),
  ManagementAllowsKnownFolderSyncing: Schema.optional(Schema.Boolean),
  ManagementKnownFolderSyncingAllowList: Schema.optional(Schema.Array(Schema.String)),
  ManagementAllowsExternalVolumeSyncing: Schema.optional(Schema.Boolean),
  ManagementExternalVolumeSyncingAllowList: Schema.optional(Schema.Array(Schema.String)),
  ManagementDomainAutoEnablementList: Schema.optional(Schema.Array(Schema.String))
});
export type ComAppleFileproviderd = typeof ComAppleFileproviderd.Type;

/**
 * Finder
 * The payload that configures Finder settings.
 */
export const ComAppleFinder = Schema.Struct({
  ProhibitBurn: Schema.optional(Schema.Boolean),
  InterfaceLevel: Schema.optional(Schema.Literals(["Simple", "Full"])),
  ProhibitConnectTo: Schema.optional(Schema.Boolean),
  ProhibitEject: Schema.optional(Schema.Boolean),
  ProhibitGoToFolder: Schema.optional(Schema.Boolean),
  ShowExternalHardDrivesOnDesktop: Schema.optional(Schema.Boolean),
  ShowHardDrivesOnDesktop: Schema.optional(Schema.Boolean),
  ShowMountedServersOnDesktop: Schema.optional(Schema.Boolean),
  ShowRemovableMediaOnDesktop: Schema.optional(Schema.Boolean),
  WarnOnEmptyTrash: Schema.optional(Schema.Boolean)
});
export type ComAppleFinder = typeof ComAppleFinder.Type;

/**
 * 802.1X: First Active Ethernet
 * The payload that configures the first wired, active Ethernet interface.
 */
export const ComAppleFirstactiveethernetManaged = Schema.Struct({
  ANY: Schema.optional(Schema.Unknown /* <any> */)
});
export type ComAppleFirstactiveethernetManaged = typeof ComAppleFirstactiveethernetManaged.Type;

/**
 * 802.1X: First Ethernet
 * The payload that configures the first wired Ethernet interface.
 */
export const ComAppleFirstethernetManaged = Schema.Struct({
  ANY: Schema.optional(Schema.Unknown /* <any> */)
});
export type ComAppleFirstethernetManaged = typeof ComAppleFirstethernetManaged.Type;

/**
 * Font
 * The payload that configures fonts.
 */
export const ComAppleFont = Schema.Struct({
  Name: Schema.optional(Schema.String),
  Font: Schema.String
});
export type ComAppleFont = typeof ComAppleFont.Type;

/**
 * Parental Controls: Game Center
 * The payload that configures Game Center parental controls.
 */
export const ComAppleGamed = Schema.Struct({
  GKFeatureGameCenterAllowed: Schema.optional(Schema.Boolean),
  GKFeatureAccountModificationAllowed: Schema.optional(Schema.Boolean),
  GKFeatureAddingGameCenterFriendsAllowed: Schema.optional(Schema.Boolean),
  GKFeatureMultiplayerGamingAllowed: Schema.optional(Schema.Boolean)
});
export type ComAppleGamed = typeof ComAppleGamed.Type;

/**
 * 802.1X: Global Ethernet
 * The payload that configures the default fallback global Ethernet interface.
 */
export const ComAppleGlobalethernetManaged = Schema.Struct({
  ANY: Schema.optional(Schema.Unknown /* <any> */)
});
export type ComAppleGlobalethernetManaged = typeof ComAppleGlobalethernetManaged.Type;

/**
 * Google Account
 * The payload that configures a Google account.
 */
export const ComAppleGoogleOauth = Schema.Struct({
  AccountDescription: Schema.optional(Schema.String),
  AccountName: Schema.optional(Schema.String),
  EmailAddress: Schema.String,
  CommunicationServiceRules: Schema.optional(Schema.Struct({
    DefaultServiceHandlers: Schema.optional(Schema.Struct({
      AudioCall: Schema.optional(Schema.String)
    }))
  })),
  VPNUUID: Schema.optional(Schema.String)
});
export type ComAppleGoogleOauth = typeof ComAppleGoogleOauth.Type;

const makeDockPages = (): Schema.Schema<any> => Schema.Struct({
    Type: Schema.Literals(["Application", "Folder", "WebClip"]),
    DisplayName: Schema.optional(Schema.String),
    BundleID: Schema.optional(Schema.String),
    Pages: Schema.optional(Schema.Array(Schema.Array(Schema.suspend(() => DockPages)))),
    URL: Schema.optional(Schema.String)
  });
export const DockPages = makeDockPages();
export type DockPages = typeof DockPages.Type;

/**
 * Home Screen Layout
 * The payload that configures the Home Screen layout.
 */
export const ComAppleHomescreenlayout = Schema.Struct({
  Dock: Schema.optional(Schema.Array(Schema.Struct({
    Type: Schema.Literals(["Application", "Folder", "WebClip"]),
    DisplayName: Schema.optional(Schema.String),
    BundleID: Schema.optional(Schema.String),
    Pages: Schema.optional(Schema.Array(Schema.Array(Schema.suspend(() => DockPages)))),
    URL: Schema.optional(Schema.String)
  }))),
  Pages: Schema.Array(Schema.Array(Schema.Struct({
    Type: Schema.Literals(["Application", "Folder", "WebClip"]),
    DisplayName: Schema.optional(Schema.String),
    BundleID: Schema.optional(Schema.String),
    Pages: Schema.optional(Schema.Array(Schema.Array(Schema.suspend(() => DockPages)))),
    URL: Schema.optional(Schema.String)
  })))
});
export type ComAppleHomescreenlayout = typeof ComAppleHomescreenlayout.Type;

/**
 * Parental Control: Dictation and Profanity
 * The payload that configures parental control for dictation and profanity.
 */
export const ComAppleIronwoodSupport = Schema.Struct({
  "Profanity Allowed": Schema.optional(Schema.Boolean),
  "Ironwood Allowed": Schema.optional(Schema.Boolean)
});
export type ComAppleIronwoodSupport = typeof ComAppleIronwoodSupport.Type;

/**
 * Jabber Account
 * The payload that configures a Jabber account.
 */
export const ComAppleJabberAccount = Schema.Struct({
  JabberAccountDescription: Schema.optional(Schema.String),
  JabberHostName: Schema.String,
  JabberUserName: Schema.optional(Schema.String),
  JabberPassword: Schema.optional(Schema.String),
  JabberUseSSL: Schema.optional(Schema.Boolean),
  JabberPort: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(65535)))),
  JabberAuthentication: Schema.Literal("JabberAuthPassword")
});
export type ComAppleJabberAccount = typeof ComAppleJabberAccount.Type;

/**
 * LDAP
 * The payload that configures a Lightweight Directory Access Protocol (LDAP) account.
 */
export const ComAppleLdapAccount = Schema.Struct({
  LDAPAccountDescription: Schema.optional(Schema.String),
  LDAPAccountHostName: Schema.String,
  LDAPAccountUserName: Schema.optional(Schema.String),
  LDAPAccountPassword: Schema.optional(Schema.String),
  LDAPAccountUseSSL: Schema.optional(Schema.Boolean),
  LDAPSearchSettings: Schema.optional(Schema.Array(Schema.Struct({
    LDAPSearchSettingDescription: Schema.optional(Schema.String),
    LDAPSearchSettingSearchBase: Schema.String,
    LDAPSearchSettingScope: Schema.optional(Schema.Literals(["LDAPSearchSettingScopeBase", "LDAPSearchSettingScopeOneLevel", "LDAPSearchSettingScopeSubtree"]))
  }))),
  VPNUUID: Schema.optional(Schema.String)
});
export type ComAppleLdapAccount = typeof ComAppleLdapAccount.Type;

/**
 * Login Items: Managed Items
 * The payload that configures a device's login items.
 */
export const ComAppleLoginitemsManaged = Schema.Struct({
  "AutoLaunchedApplicationDictionary-managed": Schema.Array(Schema.Struct({
    Path: Schema.String,
    Hide: Schema.optional(Schema.Boolean)
  }))
});
export type ComAppleLoginitemsManaged = typeof ComAppleLoginitemsManaged.Type;

/**
 * Login Window
 * The payload that configures Login Window behavior.
 */
export const ComAppleLoginwindow = Schema.Struct({
  SHOWFULLNAME: Schema.optional(Schema.Boolean),
  HideLocalUsers: Schema.optional(Schema.Boolean),
  IncludeNetworkUser: Schema.optional(Schema.Boolean),
  HideAdminUsers: Schema.optional(Schema.Boolean),
  SHOWOTHERUSERS_MANAGED: Schema.optional(Schema.Boolean),
  AdminHostInfo: Schema.optional(Schema.Literals(["HostName", "SystemVersion", "IPAddress"])),
  AllowList: Schema.optional(Schema.Array(Schema.String)),
  DenyList: Schema.optional(Schema.Array(Schema.String)),
  HideMobileAccounts: Schema.optional(Schema.Boolean),
  ShutDownDisabled: Schema.optional(Schema.Boolean),
  RestartDisabled: Schema.optional(Schema.Boolean),
  SleepDisabled: Schema.optional(Schema.Boolean),
  DisableConsoleAccess: Schema.optional(Schema.Boolean),
  LoginwindowText: Schema.optional(Schema.String),
  ShutDownDisabledWhileLoggedIn: Schema.optional(Schema.Boolean),
  RestartDisabledWhileLoggedIn: Schema.optional(Schema.Boolean),
  PowerOffDisabledWhileLoggedIn: Schema.optional(Schema.Boolean),
  LogOutDisabledWhileLoggedIn: Schema.optional(Schema.Boolean),
  DisableScreenLockImmediate: Schema.optional(Schema.Boolean),
  showInputMenu: Schema.optional(Schema.Boolean),
  DisableFDEAutoLogin: Schema.optional(Schema.Boolean),
  AutologinUsername: Schema.optional(Schema.String),
  AutologinPassword: Schema.optional(Schema.String)
});
export type ComAppleLoginwindow = typeof ComAppleLoginwindow.Type;

/**
 * Lights Out Management (LOM)
 * The payload that configures lights-out management (LOM) settings.
 */
export const ComAppleLom = Schema.Struct({
  DeviceCertificateUUID: Schema.optional(Schema.String),
  ControllerCertificateUUID: Schema.optional(Schema.String),
  DeviceCACertificateUUIDs: Schema.optional(Schema.Array(Schema.String)),
  ControllerCACertificateUUIDs: Schema.optional(Schema.Array(Schema.String))
});
export type ComAppleLom = typeof ComAppleLom.Type;

/**
 * Mail
 * The payload that configures a Mail account.
 */
export const ComAppleMailManaged = Schema.Struct({
  EmailAccountDescription: Schema.optional(Schema.String),
  EmailAccountName: Schema.optional(Schema.String),
  EmailAccountType: Schema.Literals(["EmailTypeIMAP", "EmailTypePOP"]),
  EmailAddress: Schema.optional(Schema.String),
  IncomingMailServerAuthentication: Schema.Literals(["EmailAuthNone", "EmailAuthPassword", "EmailAuthCRAMMD5", "EmailAuthNTLM", "EmailAuthHTTPMD5"]),
  IncomingMailServerHostName: Schema.String,
  IncomingMailServerPortNumber: Schema.optional(Schema.Int),
  IncomingMailServerUseSSL: Schema.optional(Schema.Boolean),
  IncomingMailServerUsername: Schema.optional(Schema.String),
  IncomingPassword: Schema.optional(Schema.String),
  OutgoingPassword: Schema.optional(Schema.String),
  OutgoingPasswordSameAsIncomingPassword: Schema.optional(Schema.Boolean),
  OutgoingMailServerAuthentication: Schema.Literals(["EmailAuthNone", "EmailAuthPassword", "EmailAuthCRAMMD5", "EmailAuthNTLM", "EmailAuthHTTPMD5"]),
  OutgoingMailServerHostName: Schema.String,
  OutgoingMailServerPortNumber: Schema.optional(Schema.Int),
  OutgoingMailServerUseSSL: Schema.optional(Schema.Boolean),
  OutgoingMailServerUsername: Schema.optional(Schema.String),
  PreventMove: Schema.optional(Schema.Boolean),
  PreventAppSheet: Schema.optional(Schema.Boolean),
  SMIMEEnabled: Schema.optional(Schema.Boolean),
  SMIMESigningEnabled: Schema.optional(Schema.Boolean),
  SMIMESigningCertificateUUID: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{12}$/)))),
  SMIMEEncryptionEnabled: Schema.optional(Schema.Boolean),
  SMIMEEncryptionCertificateUUID: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{12}$/)))),
  SMIMEEnablePerMessageSwitch: Schema.optional(Schema.Boolean),
  disableMailRecentsSyncing: Schema.optional(Schema.Boolean),
  allowMailDrop: Schema.optional(Schema.Boolean),
  IncomingMailServerIMAPPathPrefix: Schema.optional(Schema.String),
  SMIMESigningUserOverrideable: Schema.optional(Schema.Boolean),
  SMIMESigningCertificateUUIDUserOverrideable: Schema.optional(Schema.Boolean),
  SMIMEEncryptByDefault: Schema.optional(Schema.Boolean),
  SMIMEEncryptByDefaultUserOverrideable: Schema.optional(Schema.Boolean),
  SMIMEEncryptionCertificateUUIDUserOverrideable: Schema.optional(Schema.Boolean),
  SMIMEEnableEncryptionPerMessageSwitch: Schema.optional(Schema.Boolean),
  VPNUUID: Schema.optional(Schema.String)
});
export type ComAppleMailManaged = typeof ComAppleMailManaged.Type;

/**
 * Managed Preferences
 * The payload that configures managed preferences.
 */
export const ComAppleManagedclientPreferences = Schema.Struct({
  PayloadContent: Schema.Struct({
    ANY: Schema.Struct({
      Forced: Schema.optional(Schema.Array(Schema.Struct({
        mcx_preference_settings: Schema.Struct({
          ANY: Schema.optional(Schema.Unknown /* <any> */)
        })
      }))),
      "Set-Once": Schema.optional(Schema.Array(Schema.Struct({
        mcx_preference_settings: Schema.Struct({
          ANY: Schema.optional(Schema.Unknown /* <any> */)
        })
      })))
    })
  })
});
export type ComAppleManagedclientPreferences = typeof ComAppleManagedclientPreferences.Type;

/**
 * Accounts
 * The payload that configures guest accounts.
 */
export const ComAppleMcx = Schema.Struct({
  EnableGuestAccount: Schema.optional(Schema.Boolean),
  DisableGuestAccount: Schema.optional(Schema.Boolean)
});
export type ComAppleMcx = typeof ComAppleMcx.Type;

/**
 * Energy Saver
 * The payload that configures Energy Saver settings.
 */
export const ComAppleMcx1 = Schema.Struct({
  "com.apple.EnergySaver.desktop.ACPower": Schema.optional(Schema.Struct({
    "Display Sleep Timer": Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(180)))),
    "Disk Sleep Timer": Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(180)))),
    "System Sleep Timer": Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(180)))),
    "Reduce Processor Speed": Schema.optional(Schema.Literals([0, 1])),
    "Dynamic Power Step": Schema.optional(Schema.Literals([0, 1])),
    "Wake on LAN": Schema.optional(Schema.Literals([0, 1])),
    "Wake On Modem Ring": Schema.optional(Schema.Literals([0, 1])),
    "Automatic Restart On Power Loss": Schema.optional(Schema.Literals([0, 1]))
  })),
  "com.apple.EnergySaver.portable.ACPower": Schema.optional(Schema.Struct({
    "Display Sleep Timer": Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(180)))),
    "Disk Sleep Timer": Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(180)))),
    "System Sleep Timer": Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(180)))),
    "Reduce Processor Speed": Schema.optional(Schema.Literals([0, 1])),
    "Dynamic Power Step": Schema.optional(Schema.Literals([0, 1])),
    "Wake on LAN": Schema.optional(Schema.Literals([0, 1])),
    "Wake On Modem Ring": Schema.optional(Schema.Literals([0, 1])),
    "Automatic Restart On Power Loss": Schema.optional(Schema.Literals([0, 1]))
  })),
  "com.apple.EnergySaver.portable.BatteryPower": Schema.optional(Schema.Struct({
    "Display Sleep Timer": Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(180)))),
    "Disk Sleep Timer": Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(180)))),
    "System Sleep Timer": Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(180)))),
    "Reduce Processor Speed": Schema.optional(Schema.Literals([0, 1])),
    "Dynamic Power Step": Schema.optional(Schema.Literals([0, 1])),
    "Wake on LAN": Schema.optional(Schema.Literals([0, 1])),
    "Wake On Modem Ring": Schema.optional(Schema.Literals([0, 1])),
    "Automatic Restart On Power Loss": Schema.optional(Schema.Literals([0, 1]))
  })),
  "com.apple.EnergySaver.desktop.Schedule": Schema.optional(Schema.Struct({
    RepeatingPowerOn: Schema.optional(Schema.Struct({
      eventtype: Schema.Literals(["wake", "poweron", "wakepoweron", "sleep", "shutdown", "restart"]),
      weekdays: Schema.optional(Schema.Int),
      time: Schema.optional(Schema.Int)
    })),
    RepeatingPowerOff: Schema.optional(Schema.Struct({
      eventtype: Schema.Literals(["wake", "poweron", "wakepoweron", "sleep", "shutdown", "restart"]),
      weekdays: Schema.optional(Schema.Int),
      time: Schema.optional(Schema.Int)
    }))
  })),
  SleepDisabled: Schema.optional(Schema.Boolean)
});
export type ComAppleMcx1 = typeof ComAppleMcx1.Type;

/**
 * FDE FileVault Options
 * The payload that configures FileVault options.
 */
export const ComAppleMcx2 = Schema.Struct({
  dontAllowFDEDisable: Schema.optional(Schema.Boolean),
  dontAllowFDEEnable: Schema.optional(Schema.Boolean),
  DestroyFVKeyOnStandby: Schema.optional(Schema.Boolean)
});
export type ComAppleMcx2 = typeof ComAppleMcx2.Type;

/**
 * Mobile Accounts
 * The payload that configures mobile accounts on the device.
 */
export const ComAppleMcx3 = Schema.Struct({
  "com.apple.cachedaccounts.CreateAtLogin": Schema.optional(Schema.Boolean),
  "com.apple.cachedaccounts.WarnOnCreate": Schema.optional(Schema.Boolean),
  "cachedaccounts.WarnOnCreate.allowNever": Schema.optional(Schema.Boolean),
  "cachedaccounts.expiry.delete.disusedSeconds": Schema.optional(Schema.Int),
  "cachedaccounts.askForSecureTokenAuthBypass": Schema.optional(Schema.Boolean)
});
export type ComAppleMcx3 = typeof ComAppleMcx3.Type;

/**
 * Time Server
 * The payload that configures the time server.
 */
export const ComAppleMcx4 = Schema.Struct({
  timeServer: Schema.optional(Schema.String),
  timeZone: Schema.optional(Schema.String)
});
export type ComAppleMcx4 = typeof ComAppleMcx4.Type;

/**
 * Wi-Fi Managed Settings
 * The payload that configures managed Wi-Fi settings.
 */
export const ComAppleMcx5 = Schema.Struct({
  RequireAdminForIBSS: Schema.optional(Schema.Boolean),
  RequireAdminForAirPortNetworkChange: Schema.optional(Schema.Boolean),
  RequireAdminToTurnAirPortOnOff: Schema.optional(Schema.Boolean)
});
export type ComAppleMcx5 = typeof ComAppleMcx5.Type;

/**
 * FDE FileVault
 * The payload that configures FileVault.
 */
export const ComAppleMcxFilevault2 = Schema.Struct({
  Enable: Schema.Literals(["On", "Off"]),
  Defer: Schema.optional(Schema.Boolean),
  UserEntersMissingInfo: Schema.optional(Schema.Boolean),
  UseRecoveryKey: Schema.optional(Schema.Boolean),
  ShowRecoveryKey: Schema.optional(Schema.Boolean),
  OutputPath: Schema.optional(Schema.String),
  Certificate: Schema.optional(Schema.String),
  PayloadCertificateUUID: Schema.optional(Schema.String),
  Username: Schema.optional(Schema.String),
  Password: Schema.optional(Schema.String),
  UseKeychain: Schema.optional(Schema.Boolean),
  DeferForceAtUserLoginMaxBypassAttempts: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(-1), Schema.isLessThanOrEqualTo(9999)))),
  DeferDontAskAtUserLogout: Schema.optional(Schema.Boolean),
  ForceEnableInSetupAssistant: Schema.optional(Schema.Boolean)
});
export type ComAppleMcxFilevault2 = typeof ComAppleMcxFilevault2.Type;

/**
 * Login Window: Scripts
 * The payload that configures scripts to run at login and logout.
 */
export const ComAppleMcxloginscripts = Schema.Struct({
  loginscripts: Schema.optional(Schema.Array(Schema.Struct({
    filename: Schema.String,
    filedata: Schema.String
  }))),
  logoutscripts: Schema.optional(Schema.Array(Schema.Struct({
    filename: Schema.String,
    filedata: Schema.String
  }))),
  skipLoginHook: Schema.optional(Schema.Boolean),
  skipLogoutHook: Schema.optional(Schema.Boolean)
});
export type ComAppleMcxloginscripts = typeof ComAppleMcxloginscripts.Type;

/**
 * Managed Menu Extras
 * The payload that configures menu extras.
 */
export const ComAppleMcxmenuextras = Schema.Struct({
  delaySeconds: Schema.optional(Schema.Number),
  maxWaitSeconds: Schema.optional(Schema.Number),
  "AirPort.menu": Schema.optional(Schema.Boolean),
  "Battery.menu": Schema.optional(Schema.Boolean),
  "Bluetooth.menu": Schema.optional(Schema.Boolean),
  "CPU.menu": Schema.optional(Schema.Boolean),
  "Clock.menu": Schema.optional(Schema.Boolean),
  "Displays.menu": Schema.optional(Schema.Boolean),
  "Eject.menu": Schema.optional(Schema.Boolean),
  "Fax.menu": Schema.optional(Schema.Boolean),
  "HomeSync.menu": Schema.optional(Schema.Boolean),
  "iChat.menu": Schema.optional(Schema.Boolean),
  "Ink.menu": Schema.optional(Schema.Boolean),
  "IrDA.menu": Schema.optional(Schema.Boolean),
  "PCCard.menu": Schema.optional(Schema.Boolean),
  "PPP.menu": Schema.optional(Schema.Boolean),
  "PPPoE.menu": Schema.optional(Schema.Boolean),
  "RemoteDesktop.menu": Schema.optional(Schema.Boolean),
  "Script Menu.menu": Schema.optional(Schema.Boolean),
  "Spaces.menu": Schema.optional(Schema.Boolean),
  "Sync.menu": Schema.optional(Schema.Boolean),
  "TextInput.menu": Schema.optional(Schema.Boolean),
  "TimeMachine.menu": Schema.optional(Schema.Boolean),
  "UniversalAccess.menu": Schema.optional(Schema.Boolean),
  "User.menu": Schema.optional(Schema.Boolean),
  "VPN.menu": Schema.optional(Schema.Boolean),
  "Volume.menu": Schema.optional(Schema.Boolean),
  "WWAN.menu": Schema.optional(Schema.Boolean)
});
export type ComAppleMcxmenuextras = typeof ComAppleMcxmenuextras.Type;

/**
 * Printing
 * The payload that configures printers.
 */
export const ComAppleMcxprinting = Schema.Struct({
  RequireAdminToAddPrinters: Schema.optional(Schema.Boolean),
  AllowLocalPrinters: Schema.optional(Schema.Boolean),
  RequireAdminToPrintLocally: Schema.optional(Schema.Boolean),
  ShowOnlyManagedPrinters: Schema.optional(Schema.Boolean),
  PrintFooter: Schema.optional(Schema.Boolean),
  PrintMACAddress: Schema.optional(Schema.Boolean),
  FooterFontSize: Schema.optional(Schema.String),
  FooterFontName: Schema.optional(Schema.String),
  DefaultPrinter: Schema.optional(Schema.Struct({
    DeviceURI: Schema.optional(Schema.String),
    DisplayName: Schema.optional(Schema.String)
  })),
  UserPrinterList: Schema.optional(Schema.Struct({
    Printer: Schema.optional(Schema.Struct({
      DeviceURI: Schema.optional(Schema.String),
      DisplayName: Schema.optional(Schema.String),
      Location: Schema.optional(Schema.String),
      Model: Schema.optional(Schema.String),
      PrinterLocked: Schema.optional(Schema.Boolean),
      PPDURL: Schema.optional(Schema.String)
    }))
  }))
});
export type ComAppleMcxprinting = typeof ComAppleMcxprinting.Type;

/**
 * Time Machine
 * The payload that configures Time Machine.
 */
export const ComAppleMcxTimemachine = Schema.Struct({
  AutoBackup: Schema.optional(Schema.Boolean),
  BackupAllVolumes: Schema.optional(Schema.Boolean),
  BackupDestURL: Schema.String,
  BackupSizeMB: Schema.optional(Schema.Int),
  BackupSkipSys: Schema.optional(Schema.Boolean),
  MobileBackups: Schema.optional(Schema.Boolean),
  BasePaths: Schema.optional(Schema.Array(Schema.String)),
  SkipPaths: Schema.optional(Schema.Array(Schema.String))
});
export type ComAppleMcxTimemachine = typeof ComAppleMcxTimemachine.Type;

/**
 * MDM
 * The payload that configures mobile device management (MDM) settings.
 */
export const ComAppleMdm = Schema.Struct({
  IdentityCertificateUUID: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{12}$/))),
  Topic: Schema.String,
  ServerURL: Schema.String.pipe(Schema.check(Schema.isPattern(/^https:\/\/.*$/))),
  CheckInURL: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^https:\/\/.*$/)))),
  SignMessage: Schema.optional(Schema.Boolean),
  AccessRights: Schema.optional(Schema.Int),
  UseDevelopmentAPNS: Schema.optional(Schema.Boolean),
  ManagedAppleID: Schema.optional(Schema.String),
  AssignedManagedAppleID: Schema.optional(Schema.String),
  EnrollmentMode: Schema.optional(Schema.Literals(["BYOD", "ADDE"])),
  ServerURLPinningCertificateUUIDs: Schema.optional(Schema.Array(Schema.String)),
  CheckInURLPinningCertificateUUIDs: Schema.optional(Schema.Array(Schema.String)),
  PinningRevocationCheckRequired: Schema.optional(Schema.Boolean),
  ServerCapabilities: Schema.optional(Schema.Array(Schema.Literals(["com.apple.mdm.per-user-connections", "com.apple.mdm.bootstraptoken", "com.apple.mdm.token"]))),
  CheckOutWhenRemoved: Schema.optional(Schema.Boolean),
  RequiredAppIDForMDM: Schema.optional(Schema.Int),
  PromptUserToAllowBootstrapTokenForAuthentication: Schema.optional(Schema.Boolean)
});
export type ComAppleMdm = typeof ComAppleMdm.Type;

/**
 * Passcode
 * The payload that configures a passcode policy.
 */
export const ComAppleMobiledevicePasswordpolicy = Schema.Struct({
  allowSimple: Schema.optional(Schema.Boolean),
  forcePIN: Schema.optional(Schema.Boolean),
  maxFailedAttempts: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(2), Schema.isLessThanOrEqualTo(11)))),
  maxInactivity: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(15)))),
  maxPINAgeInDays: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(730)))),
  minComplexChars: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(4)))),
  minLength: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(16)))),
  requireAlphanumeric: Schema.optional(Schema.Boolean),
  pinHistory: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(50)))),
  maxGracePeriod: Schema.optional(Schema.Int),
  minutesUntilFailedLoginReset: Schema.optional(Schema.Int),
  changeAtNextAuth: Schema.optional(Schema.Boolean),
  customRegex: Schema.optional(Schema.Struct({
    passwordContentRegex: Schema.String,
    passwordContentDescription: Schema.optional(Schema.Struct({
      ANY: Schema.optional(Schema.String)
    }))
  }))
});
export type ComAppleMobiledevicePasswordpolicy = typeof ComAppleMobiledevicePasswordpolicy.Type;

/**
 * Network Usage Rules
 * The payload that configures network-usage rules.
 */
export const ComAppleNetworkusagerules = Schema.Struct({
  ApplicationRules: Schema.optional(Schema.Array(Schema.Struct({
    AppIdentifierMatches: Schema.optional(Schema.Array(Schema.String)),
    AllowRoamingCellularData: Schema.optional(Schema.Boolean),
    AllowCellularData: Schema.optional(Schema.Boolean)
  }))),
  SIMRules: Schema.optional(Schema.Array(Schema.Struct({
    ICCIDs: Schema.Array(Schema.String),
    WiFiAssistPolicy: Schema.Literals([2, 3])
  })))
});
export type ComAppleNetworkusagerules = typeof ComAppleNetworkusagerules.Type;

/**
 * Notifications
 * The payload that configures notifications.
 */
export const ComAppleNotificationsettings = Schema.Struct({
  NotificationSettings: Schema.Array(Schema.Struct({
    BundleIdentifier: Schema.String,
    NotificationsEnabled: Schema.optional(Schema.Boolean),
    ShowInNotificationCenter: Schema.optional(Schema.Boolean),
    ShowInLockScreen: Schema.optional(Schema.Boolean),
    AlertType: Schema.optional(Schema.Literals([0, 1, 2])),
    BadgesEnabled: Schema.optional(Schema.Boolean),
    SoundsEnabled: Schema.optional(Schema.Boolean),
    ShowInCarPlay: Schema.optional(Schema.Boolean),
    CriticalAlertEnabled: Schema.optional(Schema.Boolean),
    GroupingType: Schema.optional(Schema.Literals([0, 1, 2])),
    PreviewType: Schema.optional(Schema.Literals([0, 1, 2]))
  }))
});
export type ComAppleNotificationsettings = typeof ComAppleNotificationsettings.Type;

/**
 * NSExtension Management
 * The payload that configures the extensions that the system allows or disallows to run on the device.
 */
export const ComAppleNsextension = Schema.Struct({
  AllowedExtensions: Schema.optional(Schema.Array(Schema.String)),
  DeniedExtensions: Schema.optional(Schema.Array(Schema.String)),
  DeniedExtensionPoints: Schema.optional(Schema.Array(Schema.String))
});
export type ComAppleNsextension = typeof ComAppleNsextension.Type;

/**
 * macOS Server Account
 * The payload that configures a macOS Server account.
 */
export const ComAppleOsxserverAccount = Schema.Struct({
  HostName: Schema.String,
  UserName: Schema.String,
  Password: Schema.optional(Schema.String),
  AccountDescription: Schema.optional(Schema.String),
  ConfiguredAccounts: Schema.Array(Schema.Struct({
    Type: Schema.Literal("com.apple.osxserver.documents"),
    Port: Schema.optional(Schema.Int)
  }))
});
export type ComAppleOsxserverAccount = typeof ComAppleOsxserverAccount.Type;

/**
 * Security Preferences
 * The payload that configures security preferences.
 */
export const ComApplePreferenceSecurity = Schema.Struct({
  dontAllowPasswordResetUI: Schema.optional(Schema.Boolean),
  dontAllowLockMessageUI: Schema.optional(Schema.Boolean),
  dontAllowFireWallUI: Schema.optional(Schema.Boolean)
});
export type ComApplePreferenceSecurity = typeof ComApplePreferenceSecurity.Type;

/**
 * User Preferences
 * The payload that configures iCloud password preferences.
 */
export const ComApplePreferenceUsers = Schema.Struct({
  DisableUsingiCloudPassword: Schema.optional(Schema.Boolean)
});
export type ComApplePreferenceUsers = typeof ComApplePreferenceUsers.Type;

/**
 * Profile Removal Password
 * The payload that configures profile removal.
 */
export const ComAppleProfileremovalpassword = Schema.Struct({
  RemovalPassword: Schema.optional(Schema.String)
});
export type ComAppleProfileremovalpassword = typeof ComAppleProfileremovalpassword.Type;

/**
 * Global HTTP Proxy
 * The payload that configures a global HTTP proxy.
 */
export const ComAppleProxyHttpGlobal = Schema.Struct({
  ProxyType: Schema.optional(Schema.Literals(["Manual", "Auto"])),
  ProxyServer: Schema.optional(Schema.String),
  ProxyServerPort: Schema.optional(Schema.Int),
  ProxyUsername: Schema.optional(Schema.String),
  ProxyPassword: Schema.optional(Schema.String),
  ProxyPACURL: Schema.optional(Schema.String),
  ProxyPACFallbackAllowed: Schema.optional(Schema.Boolean),
  ProxyCaptiveLoginAllowed: Schema.optional(Schema.Boolean)
});
export type ComAppleProxyHttpGlobal = typeof ComAppleProxyHttpGlobal.Type;

/**
 * Relay
 * The payload that configures relay settings.
 */
export const ComAppleRelayManaged = Schema.Struct({
  Relays: Schema.Array(Schema.Struct({
    HTTP3RelayURL: Schema.optional(Schema.String),
    HTTP2RelayURL: Schema.optional(Schema.String),
    AdditionalHTTPHeaderFields: Schema.optional(Schema.Struct({
      ANY: Schema.String
    })),
    PayloadCertificateUUID: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{12}$/)))),
    RawPublicKeys: Schema.optional(Schema.Array(Schema.String))
  })),
  MatchDomains: Schema.optional(Schema.Array(Schema.String)),
  ExcludedDomains: Schema.optional(Schema.Array(Schema.String)),
  MatchFQDNs: Schema.optional(Schema.Array(Schema.String)),
  ExcludedFQDNs: Schema.optional(Schema.Array(Schema.String)),
  RelayUUID: Schema.optional(Schema.String),
  UIToggleEnabled: Schema.optional(Schema.Boolean),
  AllowDNSFailover: Schema.optional(Schema.Boolean)
});
export type ComAppleRelayManaged = typeof ComAppleRelayManaged.Type;

/**
 * Screensaver
 * The payload that configures the screen saver.
 */
export const ComAppleScreensaver = Schema.Struct({
  askForPassword: Schema.optional(Schema.Boolean),
  askForPasswordDelay: Schema.optional(Schema.Int),
  idleTime: Schema.optional(Schema.Int),
  loginWindowModulePath: Schema.optional(Schema.String),
  moduleName: Schema.String
});
export type ComAppleScreensaver = typeof ComAppleScreensaver.Type;

/**
 * Screensaver User
 * The payload that configures a user's screen saver settings.
 */
export const ComAppleScreensaverUser = Schema.Struct({
  moduleName: Schema.String,
  modulePath: Schema.optional(Schema.String),
  idleTime: Schema.optional(Schema.Int)
});
export type ComAppleScreensaverUser = typeof ComAppleScreensaverUser.Type;

/**
 * 802.1X: Second Active Ethernet
 * The payload that configures the second wired, active Ethernet interface.
 */
export const ComAppleSecondactiveethernetManaged = Schema.Struct({
  ANY: Schema.optional(Schema.Unknown /* <any> */)
});
export type ComAppleSecondactiveethernetManaged = typeof ComAppleSecondactiveethernetManaged.Type;

/**
 * 802.1X: Second Ethernet
 * The payload that configures the second wired Ethernet interface.
 */
export const ComAppleSecondethernetManaged = Schema.Struct({
  ANY: Schema.optional(Schema.Unknown /* <any> */)
});
export type ComAppleSecondethernetManaged = typeof ComAppleSecondethernetManaged.Type;

/**
 * ACME Certificate
 * The payload that configures Automated Certificate Management Environment (ACME) settings.
 */
export const ComAppleSecurityAcme = Schema.Struct({
  DirectoryURL: Schema.String,
  ClientIdentifier: Schema.String,
  KeySize: Schema.Int,
  KeyType: Schema.Literals(["RSA", "ECSECPrimeRandom"]),
  HardwareBound: Schema.Boolean,
  Subject: Schema.Array(Schema.Array(Schema.Array(Schema.String))),
  SubjectAltName: Schema.optional(Schema.Struct({
    rfc822Name: Schema.optional(Schema.String),
    dNSName: Schema.optional(Schema.String),
    uniformResourceIdentifier: Schema.optional(Schema.String),
    ntPrincipalName: Schema.optional(Schema.String)
  })),
  UsageFlags: Schema.optional(Schema.Int),
  ExtendedKeyUsage: Schema.optional(Schema.Array(Schema.String)),
  Attest: Schema.optional(Schema.Boolean),
  KeyIsExtractable: Schema.optional(Schema.Boolean),
  AllowAllAppsAccess: Schema.optional(Schema.Boolean)
});
export type ComAppleSecurityAcme = typeof ComAppleSecurityAcme.Type;

/**
 * Certificate Preference
 * The payload that configures a certificate preference.
 */
export const ComAppleSecurityCertificatepreference = Schema.Struct({
  Name: Schema.String,
  PayloadCertificateUUID: Schema.String
});
export type ComAppleSecurityCertificatepreference = typeof ComAppleSecurityCertificatepreference.Type;

/**
 * Certificate Revocation
 * The payload that configures certificate revocation checking.
 */
export const ComAppleSecurityCertificaterevocation = Schema.Struct({
  EnabledForCerts: Schema.optional(Schema.Array(Schema.Struct({
    Algorithm: Schema.Literal("sha256"),
    Hash: Schema.String
  })))
});
export type ComAppleSecurityCertificaterevocation = typeof ComAppleSecurityCertificaterevocation.Type;

/**
 * Certificate Transparency
 * The payload that configures certificate transparency enforcement.
 */
export const ComAppleSecurityCertificatetransparency = Schema.Struct({
  DisabledForCerts: Schema.optional(Schema.Array(Schema.Struct({
    Algorithm: Schema.Literal("sha256"),
    Hash: Schema.String
  }))),
  DisabledForDomains: Schema.optional(Schema.Array(Schema.String))
});
export type ComAppleSecurityCertificatetransparency = typeof ComAppleSecurityCertificatetransparency.Type;

/**
 * FDE Recovery Key Escrow
 * The payload that configures FileVault recovery key escrow.
 */
export const ComAppleSecurityFderecoverykeyescrow = Schema.Struct({
  Location: Schema.String,
  EncryptCertPayloadUUID: Schema.String,
  DeviceKey: Schema.optional(Schema.String)
});
export type ComAppleSecurityFderecoverykeyescrow = typeof ComAppleSecurityFderecoverykeyescrow.Type;

/**
 * FDE Recovery Key Redirection
 * The payload that configures FileVault recovery key redirection.
 */
export const ComAppleSecurityFderecoveryredirect = Schema.Struct({
  RedirectURL: Schema.String,
  EncryptCertPayloadUUID: Schema.String
});
export type ComAppleSecurityFderecoveryredirect = typeof ComAppleSecurityFderecoveryredirect.Type;

/**
 * Firewall
 * The payload that configures the firewall.
 */
export const ComAppleSecurityFirewall = Schema.Struct({
  EnableFirewall: Schema.Boolean,
  BlockAllIncoming: Schema.optional(Schema.Boolean),
  EnableStealthMode: Schema.optional(Schema.Boolean),
  Applications: Schema.optional(Schema.Array(Schema.Struct({
    BundleID: Schema.String,
    Allowed: Schema.Boolean
  }))),
  EnableLogging: Schema.optional(Schema.Boolean),
  LoggingOption: Schema.optional(Schema.Literals(["throttled", "brief", "detail"])),
  AllowSigned: Schema.optional(Schema.Boolean),
  AllowSignedApp: Schema.optional(Schema.Boolean)
});
export type ComAppleSecurityFirewall = typeof ComAppleSecurityFirewall.Type;

/**
 * Identity Preference
 * The payload that configures the user's identity on the device.
 */
export const ComAppleSecurityIdentitypreference = Schema.Struct({
  Name: Schema.String,
  PayloadCertificateUUID: Schema.String
});
export type ComAppleSecurityIdentitypreference = typeof ComAppleSecurityIdentitypreference.Type;

/**
 * Certificate (PEM)
 * The payload that configures a PEM-formatted certificate.
 */
export const ComAppleSecurityPem = Schema.Struct({
  PayloadCertificateFileName: Schema.optional(Schema.String),
  PayloadContent: Schema.String
});
export type ComAppleSecurityPem = typeof ComAppleSecurityPem.Type;

/**
 * Certificate (PKCS #1)
 * The payload that configures a PKCS #1-formatted certificate.
 */
export const ComAppleSecurityPkcs1 = Schema.Struct({
  PayloadCertificateFileName: Schema.optional(Schema.String),
  PayloadContent: Schema.String
});
export type ComAppleSecurityPkcs1 = typeof ComAppleSecurityPkcs1.Type;

/**
 * Certificate (PKCS #12)
 * The payload that configures a PKCS #12-formatted certificate.
 */
export const ComAppleSecurityPkcs12 = Schema.Struct({
  PayloadCertificateFileName: Schema.optional(Schema.String),
  PayloadContent: Schema.String,
  Password: Schema.optional(Schema.String),
  AllowAllAppsAccess: Schema.optional(Schema.Boolean),
  KeyIsExtractable: Schema.optional(Schema.Boolean)
});
export type ComAppleSecurityPkcs12 = typeof ComAppleSecurityPkcs12.Type;

/**
 * Certificate (Root)
 * The payload that configures a root certificate.
 */
export const ComAppleSecurityRoot = Schema.Struct({
  PayloadCertificateFileName: Schema.optional(Schema.String),
  PayloadContent: Schema.String
});
export type ComAppleSecurityRoot = typeof ComAppleSecurityRoot.Type;

/**
 * SCEP
 * The payload that configures Simple Certificate Enrollment Protocol (SCEP) settings.
 */
export const ComAppleSecurityScep = Schema.Struct({
  PayloadContent: Schema.Struct({
    URL: Schema.String,
    Name: Schema.optional(Schema.String),
    Subject: Schema.optional(Schema.Array(Schema.Array(Schema.Array(Schema.String)))),
    Challenge: Schema.optional(Schema.String),
    Keysize: Schema.optional(Schema.Literals([1024, 2048, 4096])),
    "Key Type": Schema.optional(Schema.String),
    "Key Usage": Schema.optional(Schema.Int),
    CAFingerprint: Schema.optional(Schema.String),
    Retries: Schema.optional(Schema.Int),
    RetryDelay: Schema.optional(Schema.Int),
    SubjectAltName: Schema.optional(Schema.Struct({
      rfc822Name: Schema.optional(Schema.String),
      dNSName: Schema.optional(Schema.String),
      uniformResourceIdentifier: Schema.optional(Schema.String),
      ntPrincipalName: Schema.optional(Schema.String)
    })),
    KeyIsExtractable: Schema.optional(Schema.Boolean),
    AllowAllAppsAccess: Schema.optional(Schema.Boolean)
  })
});
export type ComAppleSecurityScep = typeof ComAppleSecurityScep.Type;

/**
 * SmartCard
 * The payload that configures a smart card.
 */
export const ComAppleSecuritySmartcard = Schema.Struct({
  UserPairing: Schema.optional(Schema.Boolean),
  allowSmartCard: Schema.optional(Schema.Boolean),
  checkCertificateTrust: Schema.optional(Schema.Literals([0, 1, 2, 3])),
  oneCardPerUser: Schema.optional(Schema.Boolean),
  tokenRemovalAction: Schema.optional(Schema.Literals([0, 1])),
  enforceSmartCard: Schema.optional(Schema.Boolean)
});
export type ComAppleSecuritySmartcard = typeof ComAppleSecuritySmartcard.Type;

/**
 * Service Management - Managed Login Items
 * This payload that configures managed login items, which auto-enables and auto-allows matched items.
 */
export const ComAppleServicemanagement = Schema.Struct({
  Rules: Schema.Array(Schema.Struct({
    RuleType: Schema.Literals(["BundleIdentifier", "BundleIdentifierPrefix", "Label", "LabelPrefix", "TeamIdentifier"]),
    RuleValue: Schema.String,
    Comment: Schema.optional(Schema.String),
    TeamIdentifier: Schema.optional(Schema.String)
  }))
});
export type ComAppleServicemanagement = typeof ComAppleServicemanagement.Type;

/**
 * Setup Assistant
 * The payload that configures Setup Assistant settings.
 */
export const ComAppleSetupassistantManaged = Schema.Struct({
  SkipCloudSetup: Schema.optional(Schema.Boolean),
  SkipSiriSetup: Schema.optional(Schema.Boolean),
  SkipPrivacySetup: Schema.optional(Schema.Boolean),
  SkipiCloudStorageSetup: Schema.optional(Schema.Boolean),
  SkipTrueTone: Schema.optional(Schema.Boolean),
  SkipAppearance: Schema.optional(Schema.Boolean),
  SkipTouchIDSetup: Schema.optional(Schema.Boolean),
  SkipScreenTime: Schema.optional(Schema.Boolean),
  SkipAccessibility: Schema.optional(Schema.Boolean),
  SkipSetupItems: Schema.optional(Schema.Array(Schema.String)),
  SkipUnlockWithWatch: Schema.optional(Schema.Boolean),
  SkipWallpaper: Schema.optional(Schema.Boolean)
});
export type ComAppleSetupassistantManaged = typeof ComAppleSetupassistantManaged.Type;

/**
 * Lock Screen Message
 * The payload that configures a Lock Screen message.
 */
export const ComAppleShareddeviceconfiguration = Schema.Struct({
  AssetTagInformation: Schema.optional(Schema.String),
  IfLostReturnToMessage: Schema.optional(Schema.String),
  LockScreenFootnote: Schema.optional(Schema.String)
});
export type ComAppleShareddeviceconfiguration = typeof ComAppleShareddeviceconfiguration.Type;

/**
 * ShareKit
 * The payload that configures ShareKit.
 */
export const ComAppleSharekithelper = Schema.Struct({
  SHKAllowedShareServices: Schema.optional(Schema.Array(Schema.String)),
  SHKDeniedShareServices: Schema.optional(Schema.Array(Schema.String))
});
export type ComAppleSharekithelper = typeof ComAppleSharekithelper.Type;

/**
 * Software Update
 * The payload that configures the software update policy.
 */
export const ComAppleSoftwareupdate = Schema.Struct({
  CatalogURL: Schema.optional(Schema.String),
  AllowPreReleaseInstallation: Schema.optional(Schema.Boolean),
  "restrict-software-update-require-admin-to-install": Schema.optional(Schema.Boolean),
  AutomaticallyInstallMacOSUpdates: Schema.optional(Schema.Boolean),
  AutomaticallyInstallAppUpdates: Schema.optional(Schema.Boolean),
  AutomaticCheckEnabled: Schema.optional(Schema.Boolean),
  AutomaticDownload: Schema.optional(Schema.Boolean),
  CriticalUpdateInstall: Schema.optional(Schema.Boolean),
  ConfigDataInstall: Schema.optional(Schema.Boolean)
});
export type ComAppleSoftwareupdate = typeof ComAppleSoftwareupdate.Type;

/**
 * Single Sign-On
 * The payload that configures single sign-on (SSO).
 */
export const ComAppleSso = Schema.Struct({
  Name: Schema.String,
  Kerberos: Schema.optional(Schema.Struct({
    PrincipalName: Schema.optional(Schema.String),
    PayloadCertificateUUID: Schema.optional(Schema.String),
    Realm: Schema.String,
    URLPrefixMatches: Schema.optional(Schema.Array(Schema.String)),
    AppIdentifierMatches: Schema.optional(Schema.Array(Schema.String))
  }))
});
export type ComAppleSso = typeof ComAppleSso.Type;

/**
 * Subscribed Calendars
 * The payload that configures subscribed calendars.
 */
export const ComAppleSubscribedcalendarAccount = Schema.Struct({
  SubCalAccountDescription: Schema.optional(Schema.String),
  SubCalAccountHostName: Schema.String,
  SubCalAccountUsername: Schema.optional(Schema.String),
  SubCalAccountPassword: Schema.optional(Schema.String),
  SubCalAccountUseSSL: Schema.optional(Schema.Boolean),
  VPNUUID: Schema.optional(Schema.String)
});
export type ComAppleSubscribedcalendarAccount = typeof ComAppleSubscribedcalendarAccount.Type;

/**
 * System Policy - Kernel Extensions
 * The payload that configures the kernel extension policies.
 */
export const ComAppleSyspolicyKernelExtensionPolicy = Schema.Struct({
  AllowNonAdminUserApprovals: Schema.optional(Schema.Boolean),
  AllowUserOverrides: Schema.optional(Schema.Boolean),
  AllowedTeamIdentifiers: Schema.optional(Schema.Array(Schema.String)),
  AllowedKernelExtensions: Schema.optional(Schema.Struct({
    ANY: Schema.optional(Schema.Array(Schema.String))
  }))
});
export type ComAppleSyspolicyKernelExtensionPolicy = typeof ComAppleSyspolicyKernelExtensionPolicy.Type;

/**
 * Network Proxy Configuration
 * The payload that configures network proxies for a device.
 */
export const ComAppleSystemconfiguration = Schema.Struct({
  Proxies: Schema.Struct({
    FTPEnable: Schema.optional(Schema.Int),
    FTPPassive: Schema.optional(Schema.Int),
    FTPPort: Schema.optional(Schema.Int),
    FTPProxy: Schema.optional(Schema.String),
    GopherEnable: Schema.optional(Schema.Int),
    GopherPort: Schema.optional(Schema.Int),
    GopherProxy: Schema.optional(Schema.String),
    HTTPEnable: Schema.optional(Schema.Int),
    HTTPPort: Schema.optional(Schema.Int),
    HTTPProxy: Schema.optional(Schema.String),
    HTTPSEnable: Schema.optional(Schema.Int),
    HTTPSPort: Schema.optional(Schema.Int),
    HTTPSProxy: Schema.optional(Schema.String),
    ProxyAutoConfigEnable: Schema.optional(Schema.Int),
    ProxyAutoConfigURLString: Schema.optional(Schema.String),
    ProxyCaptiveLoginAllowed: Schema.optional(Schema.Int),
    RTSPEnable: Schema.optional(Schema.Int),
    RTSPPort: Schema.optional(Schema.Int),
    RTSPProxy: Schema.optional(Schema.String),
    SOCKSEnable: Schema.optional(Schema.Int),
    SOCKSPortinteger: Schema.optional(Schema.Int),
    SOCKSProxy: Schema.optional(Schema.String),
    FallBackAllowed: Schema.optional(Schema.Int),
    ExceptionsList: Schema.optional(Schema.Array(Schema.String))
  })
});
export type ComAppleSystemconfiguration = typeof ComAppleSystemconfiguration.Type;

/**
 * System Extensions
 * The payload that configures system extensions.
 */
export const ComAppleSystemExtensionPolicy = Schema.Struct({
  AllowUserOverrides: Schema.optional(Schema.Boolean),
  AllowedTeamIdentifiers: Schema.optional(Schema.Array(Schema.String)),
  AllowedSystemExtensionTypes: Schema.optional(Schema.Struct({
    ANY: Schema.optional(Schema.Array(Schema.String))
  })),
  AllowedSystemExtensions: Schema.optional(Schema.Struct({
    ANY: Schema.optional(Schema.Array(Schema.String))
  })),
  RemovableSystemExtensions: Schema.optional(Schema.Struct({
    ANY: Schema.optional(Schema.Array(Schema.String))
  })),
  NonRemovableSystemExtensions: Schema.optional(Schema.Struct({
    ANY: Schema.optional(Schema.Array(Schema.String))
  })),
  NonRemovableFromUISystemExtensions: Schema.optional(Schema.Struct({
    ANY: Schema.optional(Schema.Array(Schema.String))
  }))
});
export type ComAppleSystemExtensionPolicy = typeof ComAppleSystemExtensionPolicy.Type;

/**
 * System Logging
 * The payload that configures system logging.
 */
export const ComAppleSystemLogging = Schema.Struct({
  Processes: Schema.optional(Schema.Struct({
    ANY: Schema.optional(Schema.Unknown /* <any> */)
  })),
  Subsystems: Schema.optional(Schema.Struct({
    ANY: Schema.optional(Schema.Unknown /* <any> */)
  })),
  System: Schema.optional(Schema.Struct({
    ANY: Schema.optional(Schema.Unknown /* <any> */)
  }))
});
export type ComAppleSystemLogging = typeof ComAppleSystemLogging.Type;

/**
 * System Migration
 * The payload that configures system migration.
 */
export const ComAppleSystemmigration = Schema.Struct({
  CustomBehavior: Schema.optional(Schema.Array(Schema.Struct({
    Context: Schema.String,
    Paths: Schema.Array(Schema.Struct({
      SourcePath: Schema.String,
      SourcePathInUserHome: Schema.Boolean,
      TargetPath: Schema.String,
      TargetPathInUserHome: Schema.Boolean
    }))
  })))
});
export type ComAppleSystemmigration = typeof ComAppleSystemmigration.Type;

/**
 * System Policy Control
 * The payload that configures the system policy for assessments.
 */
export const ComAppleSystempolicyControl = Schema.Struct({
  EnableAssessment: Schema.optional(Schema.Boolean),
  AllowIdentifiedDevelopers: Schema.optional(Schema.Boolean),
  EnableXProtectMalwareUpload: Schema.optional(Schema.Boolean)
});
export type ComAppleSystempolicyControl = typeof ComAppleSystempolicyControl.Type;

/**
 * System Policy Managed
 * The payload that configures the Finder's contextual menu to bypass the system policy.
 */
export const ComAppleSystempolicyManaged = Schema.Struct({
  DisableOverride: Schema.optional(Schema.Boolean)
});
export type ComAppleSystempolicyManaged = typeof ComAppleSystempolicyManaged.Type;

/**
 * System Policy Rule
 * The payload that configures the system policy.
 */
export const ComAppleSystempolicyRule = Schema.Struct({
  Requirement: Schema.optional(Schema.String),
  Comment: Schema.optional(Schema.String),
  Priority: Schema.optional(Schema.Number),
  Expiration: Schema.optional(Schema.String),
  OperationType: Schema.optional(Schema.Literals(["operation:execute", "operation:install", "operation:lsopen"])),
  LeafCertificate: Schema.optional(Schema.String)
});
export type ComAppleSystempolicyRule = typeof ComAppleSystempolicyRule.Type;

/**
 * System Preferences
 * The payload that configures the preference panes.
 */
export const ComAppleSystempreferences = Schema.Struct({
  EnabledPreferencePanes: Schema.optional(Schema.Array(Schema.Literals(["com.apple.ClassroomSettings", "com.apple.Localization", "com.apple.preference.datetime", "com.apple.preference.desktopscreeneffect", "com.apple.preference.digihub.discs", "com.apple.preference.displays", "com.apple.preference.dock", "com.apple.preference.energysaver", "com.apple.preference.expose", "com.apple.preference.general", "com.apple.preference.ink", "com.apple.preference.keyboard", "com.apple.preference.mouse", "com.apple.preference.network", "com.apple.preference.notifications", "com.apple.preference.printfax", "com.apple.preference.screentime", "com.apple.preference.security", "com.apple.preference.sidecar", "com.apple.preference.sound", "com.apple.preference.speech", "com.apple.preference.spotlight", "com.apple.preference.startupdisk", "com.apple.preference.trackpad", "com.apple.preference.universalaccess", "com.apple.preferences.AppleIDPrefPane", "com.apple.preferences.appstore", "com.apple.preferences.Bluetooth", "com.apple.preferences.configurationprofiles", "com.apple.preferences.extensions", "com.apple.preferences.FamilySharingPrefPane", "com.apple.preferences.icloud", "com.apple.preferences.internetaccounts", "com.apple.preferences.parentalcontrols", "com.apple.preferences.password", "com.apple.preferences.sharing", "com.apple.preferences.softwareupdate", "com.apple.preferences.users", "com.apple.preferences.wallet", "com.apple.prefpanel.fibrechannel", "com.apple.prefs.backup", "com.apple.Xsan"]))),
  DisabledPreferencePanes: Schema.optional(Schema.Array(Schema.Literals(["com.apple.ClassroomSettings", "com.apple.Localization", "com.apple.preference.datetime", "com.apple.preference.desktopscreeneffect", "com.apple.preference.digihub.discs", "com.apple.preference.displays", "com.apple.preference.dock", "com.apple.preference.energysaver", "com.apple.preference.expose", "com.apple.preference.general", "com.apple.preference.ink", "com.apple.preference.keyboard", "com.apple.preference.mouse", "com.apple.preference.network", "com.apple.preference.notifications", "com.apple.preference.printfax", "com.apple.preference.screentime", "com.apple.preference.security", "com.apple.preference.sidecar", "com.apple.preference.sound", "com.apple.preference.speech", "com.apple.preference.spotlight", "com.apple.preference.startupdisk", "com.apple.preference.trackpad", "com.apple.preference.universalaccess", "com.apple.preferences.AppleIDPrefPane", "com.apple.preferences.appstore", "com.apple.preferences.Bluetooth", "com.apple.preferences.configurationprofiles", "com.apple.preferences.extensions", "com.apple.preferences.FamilySharingPrefPane", "com.apple.preferences.icloud", "com.apple.preferences.internetaccounts", "com.apple.preferences.parentalcontrols", "com.apple.preferences.password", "com.apple.preferences.sharing", "com.apple.preferences.softwareupdate", "com.apple.preferences.users", "com.apple.preferences.wallet", "com.apple.prefpanel.fibrechannel", "com.apple.prefs.backup", "com.apple.Xsan"]))),
  DisabledSystemSettings: Schema.optional(Schema.Array(Schema.Literals(["com.apple.Accessibility-Settings.extension", "com.apple.AirDrop-Handoff-Settings.extension", "com.apple.Battery-Settings.extension", "com.apple.BluetoothSettings", "com.apple.CD-DVD-Settings.extension", "com.apple.ClassKit-Settings.extension", "com.apple.Classroom-Settings.extension", "com.apple.ControlCenter-Settings.extension", "com.apple.Date-Time-Settings.extension", "com.apple.Desktop-Settings.extension", "com.apple.Displays-Settings.extension", "com.apple.ExtensionsPreferences", "com.apple.Family-Settings.extension", "com.apple.Focus-Settings.extension", "com.apple.Game-Center-Settings.extension", "com.apple.Game-Controller-Settings.extension", "com.apple.HeadphoneSettings", "com.apple.Internet-Accounts-Settings.extension", "com.apple.Keyboard-Settings.extension", "com.apple.Localization-Settings.extension", "com.apple.Lock-Screen-Settings.extension", "com.apple.LoginItems-Settings.extension", "com.apple.Mouse-Settings.extension", "com.apple.Network-Settings.extension", "com.apple.NetworkExtensionSettingsUI.NESettingsUIExtension", "com.apple.Notifications-Settings.extension", "com.apple.Passwords-Settings.extension", "com.apple.Print-Scan-Settings.extension", "com.apple.Screen-Time-Settings.extension", "com.apple.ScreenSaver-Settings.extension", "com.apple.Sharing-Settings.extension", "com.apple.Siri-Settings.extension", "com.apple.Software-Update-Settings.extension", "com.apple.Sound-Settings.extension", "com.apple.Startup-Disk-Settings.extension", "com.apple.Time-Machine-Settings.extension", "com.apple.Touch-ID-Settings.extension", "com.apple.Trackpad-Settings.extension", "com.apple.Transfer-Reset-Settings.extension", "com.apple.Users-Groups-Settings.extension", "com.apple.WalletSettingsExtension", "com.apple.Wallpaper-Settings.extension", "com.apple.settings.Storage", "com.apple.systempreferences.AppleIDSettings", "com.apple.wifi-settings-extension"])))
});
export type ComAppleSystempreferences = typeof ComAppleSystempreferences.Type;

/**
 * Media Management: Allowed Media
 * The payload that configures media management.
 */
export const ComAppleSystemuiserver = Schema.Struct({
  "logout-eject": Schema.optional(Schema.Struct({
    "all-media": Schema.optional(Schema.String),
    cd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    dvd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    bd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    blankcd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    blankdvd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    blankbd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    dvdram: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    "disk-image": Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    "harddisk-internal": Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    "harddisk-external": Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    networkdisk: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"])))
  })),
  "mount-controls": Schema.optional(Schema.Struct({
    "all-media": Schema.optional(Schema.String),
    cd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    dvd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    bd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    blankcd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    blankdvd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    blankbd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    dvdram: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    "disk-image": Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    "harddisk-internal": Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    "harddisk-external": Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    networkdisk: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"])))
  })),
  "unmount-controls": Schema.optional(Schema.Struct({
    "all-media": Schema.optional(Schema.String),
    cd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    dvd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    bd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    blankcd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    blankdvd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    blankbd: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    dvdram: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    "disk-image": Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    "harddisk-internal": Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    "harddisk-external": Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"]))),
    networkdisk: Schema.optional(Schema.Array(Schema.Literals(["authenticate", "read-only", "deny", "eject"])))
  }))
});
export type ComAppleSystemuiserver = typeof ComAppleSystemuiserver.Type;

/**
 * Privacy Preferences Policy Control
 * The payload that configures privacy preferences.
 */
export const ComAppleTccConfigurationProfilePolicy = Schema.Struct({
  Services: Schema.Struct({
    AddressBook: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    Calendar: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    Reminders: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    Photos: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    Camera: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    Microphone: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    Accessibility: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    PostEvent: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    SystemPolicyAllFiles: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    SystemPolicySysAdminFiles: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    AppleEvents: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    MediaLibrary: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    FileProviderPresence: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    ListenEvent: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    ScreenCapture: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    SpeechRecognition: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    SystemPolicyDesktopFolder: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    SystemPolicyDocumentsFolder: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    SystemPolicyDownloadsFolder: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    SystemPolicyNetworkVolumes: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    SystemPolicyRemovableVolumes: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    SystemPolicyAppBundles: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    SystemPolicyAppData: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    }))),
    BluetoothAlways: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      IdentifierType: Schema.Literals(["bundleID", "path"]),
      CodeRequirement: Schema.String,
      StaticCode: Schema.optional(Schema.Boolean),
      Allowed: Schema.optional(Schema.Boolean),
      Authorization: Schema.optional(Schema.Literals(["Allow", "Deny", "AllowStandardUserToSetSystemService"])),
      Comment: Schema.optional(Schema.String),
      AEReceiverIdentifier: Schema.optional(Schema.String),
      AEReceiverIdentifierType: Schema.optional(Schema.Literals(["bundleID", "path"])),
      AEReceiverCodeRequirement: Schema.optional(Schema.String)
    })))
  })
});
export type ComAppleTccConfigurationProfilePolicy = typeof ComAppleTccConfigurationProfilePolicy.Type;

/**
 * 802.1X: Third Active Ethernet
 * The payload that configures the third wired, active Ethernet interface.
 */
export const ComAppleThirdactiveethernetManaged = Schema.Struct({
  ANY: Schema.optional(Schema.Unknown /* <any> */)
});
export type ComAppleThirdactiveethernetManaged = typeof ComAppleThirdactiveethernetManaged.Type;

/**
 * 802.1X: Third Ethernet
 * The payload that configures the third wired Ethernet interface.
 */
export const ComAppleThirdethernetManaged = Schema.Struct({
  ANY: Schema.optional(Schema.Unknown /* <any> */)
});
export type ComAppleThirdethernetManaged = typeof ComAppleThirdethernetManaged.Type;

/**
 * TV Remote
 * The payload that configures the Apple TV remote.
 */
export const ComAppleTvremote = Schema.Struct({
  AllowedRemotes: Schema.optional(Schema.Array(Schema.Struct({
    RemoteDeviceID: Schema.String
  }))),
  AllowedTVs: Schema.optional(Schema.Array(Schema.Struct({
    TVDeviceID: Schema.String,
    TVDeviceName: Schema.optional(Schema.String)
  })))
});
export type ComAppleTvremote = typeof ComAppleTvremote.Type;

/**
 * Accessibility
 * The payload that configures the accessibility features of the device.
 */
export const ComAppleUniversalaccess = Schema.Struct({
  closeViewFarPoint: Schema.optional(Schema.Int),
  closeViewHotkeysEnabled: Schema.optional(Schema.Boolean),
  closeViewNearPoint: Schema.optional(Schema.Int),
  closeViewScrollWheelToggle: Schema.optional(Schema.Boolean),
  closeViewShowPreview: Schema.optional(Schema.Boolean),
  closeViewSmoothImages: Schema.optional(Schema.Boolean),
  contrast: Schema.optional(Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)))),
  flashScreen: Schema.optional(Schema.Boolean),
  grayscale: Schema.optional(Schema.Boolean),
  mouseDriver: Schema.optional(Schema.Boolean),
  mouseDriverCursorSize: Schema.optional(Schema.Int),
  mouseDriverIgnoreTrackpad: Schema.optional(Schema.Boolean),
  mouseDriverInitialDelay: Schema.optional(Schema.Int),
  mouseDriverMaxSpeed: Schema.optional(Schema.Int),
  slowKey: Schema.optional(Schema.Boolean),
  slowKeyBeepOn: Schema.optional(Schema.Boolean),
  slowKeyDelay: Schema.optional(Schema.Int),
  stereoAsMono: Schema.optional(Schema.Boolean),
  stickyKey: Schema.optional(Schema.Boolean),
  stickyKeyBeepOnModifier: Schema.optional(Schema.Boolean),
  stickyKeyShowWindow: Schema.optional(Schema.Boolean),
  voiceOverOnOffKey: Schema.optional(Schema.Boolean),
  whiteOnBlack: Schema.optional(Schema.Boolean)
});
export type ComAppleUniversalaccess = typeof ComAppleUniversalaccess.Type;

/**
 * VPN
 * The payload that configures a VPN.
 */
export const ComAppleVpnManaged = Schema.Struct({
  VPNType: Schema.Literals(["VPN", "L2TP", "IPSec", "IKEv2", "AlwaysOn", "TransparentProxy"]),
  VPNSubType: Schema.optional(Schema.String),
  UserDefinedName: Schema.String,
  VendorConfig: Schema.optional(Schema.Struct({
    Realm: Schema.optional(Schema.String),
    Role: Schema.optional(Schema.String),
    Group: Schema.optional(Schema.String),
    LoginGroupOrDomain: Schema.optional(Schema.String)
  })),
  VPN: Schema.optional(Schema.Struct({
    AuthName: Schema.optional(Schema.String),
    AuthPassword: Schema.optional(Schema.String),
    RemoteAddress: Schema.String,
    AuthenticationMethod: Schema.optional(Schema.Literals(["Password", "Certificate", "Password+Certificate"])),
    PayloadCertificateUUID: Schema.optional(Schema.String),
    ProviderBundleIdentifier: Schema.optional(Schema.String),
    ProviderDesignatedRequirement: Schema.optional(Schema.String),
    DisconnectOnIdle: Schema.optional(Schema.Literals([0, 1])),
    DisconnectOnIdleTimer: Schema.optional(Schema.Int),
    ProviderType: Schema.optional(Schema.Literals(["packet-tunnel", "app-proxy"])),
    IncludeAllNetworks: Schema.optional(Schema.Literals([0, 1])),
    EnforceRoutes: Schema.optional(Schema.Literals([0, 1])),
    ExcludeLocalNetworks: Schema.optional(Schema.Literals([0, 1])),
    ExcludeCellularServices: Schema.optional(Schema.Literals([0, 1])),
    ExcludeAPNs: Schema.optional(Schema.Literals([0, 1])),
    ExcludeDeviceCommunication: Schema.optional(Schema.Literals([0, 1])),
    OnDemandEnabled: Schema.optional(Schema.Literals([0, 1])),
    OnDemandUserOverrideDisabled: Schema.optional(Schema.Literals([0, 1])),
    OnDemandMatchDomainsAlways: Schema.optional(Schema.Array(Schema.String)),
    OnDemandMatchDomainsNever: Schema.optional(Schema.Array(Schema.String)),
    OnDemandMatchDomainsOnRetry: Schema.optional(Schema.Array(Schema.String)),
    OnDemandRules: Schema.optional(Schema.Array(Schema.Struct({
      Action: Schema.Literals(["Allow", "Connect", "Disconnect", "EvaluateConnection", "Ignore"]),
      ActionParameters: Schema.optional(Schema.Array(Schema.Struct({
        Domains: Schema.Array(Schema.String),
        DomainAction: Schema.Literals(["ConnectIfNeeded", "NeverConnect"]),
        RequiredDNSServers: Schema.optional(Schema.Array(Schema.String)),
        RequiredURLStringProbe: Schema.optional(Schema.String)
      }))),
      DNSDomainMatch: Schema.optional(Schema.Array(Schema.String)),
      DNSServerAddressMatch: Schema.optional(Schema.Array(Schema.String)),
      InterfaceTypeMatch: Schema.optional(Schema.Literals(["Ethernet", "WiFi", "Cellular"])),
      SSIDMatch: Schema.optional(Schema.Array(Schema.String)),
      URLStringProbe: Schema.optional(Schema.String)
    })))
  })),
  IPv4: Schema.optional(Schema.Struct({
    OverridePrimary: Schema.optional(Schema.Literals([0, 1]))
  })),
  PPP: Schema.optional(Schema.Struct({
    AuthName: Schema.optional(Schema.String),
    AuthPassword: Schema.optional(Schema.String),
    TokenCard: Schema.optional(Schema.Literals([0, 1])),
    CommRemoteAddress: Schema.optional(Schema.String),
    AuthEAPPlugins: Schema.optional(Schema.Array(Schema.Literals(["EAP-RSA", "EAP-TLS", "EAP-KRB"]))),
    AuthProtocol: Schema.optional(Schema.Array(Schema.Literal("EAP"))),
    CCPMPPE40Enabled: Schema.optional(Schema.Literals([0, 1])),
    CCPMPPE128Enabled: Schema.optional(Schema.Literals([0, 1])),
    CCPEnabled: Schema.optional(Schema.Literals([0, 1])),
    DisconnectOnIdle: Schema.optional(Schema.Literals([0, 1])),
    DisconnectOnIdleTimer: Schema.optional(Schema.Int)
  })),
  IPSec: Schema.optional(Schema.Struct({
    RemoteAddress: Schema.optional(Schema.String),
    AuthenticationMethod: Schema.optional(Schema.Literals(["SharedSecret", "Certificate"])),
    XAuthName: Schema.optional(Schema.String),
    XAuthPassword: Schema.optional(Schema.String),
    XAuthEnabled: Schema.optional(Schema.Literals([0, 1])),
    XAuthPasswordEncryption: Schema.optional(Schema.Literal("Prompt")),
    LocalIdentifier: Schema.optional(Schema.String),
    LocalIdentifierType: Schema.optional(Schema.Literal("KeyID")),
    SharedSecret: Schema.optional(Schema.String),
    PayloadCertificateUUID: Schema.optional(Schema.String),
    PromptForVPNPIN: Schema.optional(Schema.Boolean),
    DisconnectOnIdle: Schema.optional(Schema.Literals([0, 1])),
    DisconnectOnIdleTimer: Schema.optional(Schema.Int),
    OnDemandEnabled: Schema.optional(Schema.Literals([0, 1])),
    OnDemandMatchDomainsAlways: Schema.optional(Schema.Array(Schema.String)),
    OnDemandMatchDomainsNever: Schema.optional(Schema.Array(Schema.String)),
    OnDemandMatchDomainsOnRetry: Schema.optional(Schema.Array(Schema.String)),
    OnDemandRules: Schema.optional(Schema.Array(Schema.Struct({
      Action: Schema.Literals(["Allow", "Connect", "Disconnect", "EvaluateConnection", "Ignore"]),
      ActionParameters: Schema.optional(Schema.Array(Schema.Struct({
        Domains: Schema.Array(Schema.String),
        DomainAction: Schema.Literals(["ConnectIfNeeded", "NeverConnect"]),
        RequiredDNSServers: Schema.optional(Schema.Array(Schema.String)),
        RequiredURLStringProbe: Schema.optional(Schema.String)
      }))),
      DNSDomainMatch: Schema.optional(Schema.Array(Schema.String)),
      DNSServerAddressMatch: Schema.optional(Schema.Array(Schema.String)),
      InterfaceTypeMatch: Schema.optional(Schema.Literals(["Ethernet", "WiFi", "Cellular"])),
      SSIDMatch: Schema.optional(Schema.Array(Schema.String)),
      URLStringProbe: Schema.optional(Schema.String)
    })))
  })),
  IKEv2: Schema.optional(Schema.Struct({
    RemoteAddress: Schema.String,
    LocalIdentifier: Schema.String,
    RemoteIdentifier: Schema.String,
    AuthenticationMethod: Schema.Literals(["None", "SharedSecret", "Certificate"]),
    CertificateType: Schema.optional(Schema.Literals(["RSA", "ECDSA256", "ECDSA384", "ECDSA521", "RSA-PSS"])),
    PayloadCertificateUUID: Schema.optional(Schema.String),
    Password: Schema.optional(Schema.String),
    ProviderBundleIdentifier: Schema.optional(Schema.String),
    ProviderDesignatedRequirement: Schema.optional(Schema.String),
    SharedSecret: Schema.optional(Schema.String),
    ExtendedAuthEnabled: Schema.optional(Schema.Literals([0, 1])),
    AuthName: Schema.optional(Schema.String),
    AuthPassword: Schema.optional(Schema.String),
    OnDemandEnabled: Schema.optional(Schema.Literals([0, 1])),
    OnDemandUserOverrideDisabled: Schema.optional(Schema.Literals([0, 1])),
    OnDemandRules: Schema.optional(Schema.Array(Schema.Struct({
      Action: Schema.Literals(["Allow", "Connect", "Disconnect", "EvaluateConnection", "Ignore"]),
      ActionParameters: Schema.optional(Schema.Array(Schema.Struct({
        Domains: Schema.Array(Schema.String),
        DomainAction: Schema.Literals(["ConnectIfNeeded", "NeverConnect"]),
        RequiredDNSServers: Schema.optional(Schema.Array(Schema.String)),
        RequiredURLStringProbe: Schema.optional(Schema.String)
      }))),
      DNSDomainMatch: Schema.optional(Schema.Array(Schema.String)),
      DNSServerAddressMatch: Schema.optional(Schema.Array(Schema.String)),
      InterfaceTypeMatch: Schema.optional(Schema.Literals(["Ethernet", "WiFi", "Cellular"])),
      SSIDMatch: Schema.optional(Schema.Array(Schema.String)),
      URLStringProbe: Schema.optional(Schema.String)
    }))),
    DeadPeerDetectionRate: Schema.optional(Schema.Literals(["None", "Low", "Medium", "High"])),
    ServerCertificateIssuerCommonName: Schema.optional(Schema.String),
    ServerCertificateCommonName: Schema.optional(Schema.String),
    TLSMinimumVersion: Schema.optional(Schema.Literals(["1.0", "1.1", "1.2"])),
    TLSMaximumVersion: Schema.optional(Schema.Literals(["1.0", "1.1", "1.2"])),
    UseConfigurationAttributeInternalIPSubnet: Schema.optional(Schema.Literals([0, 1])),
    DisableMOBIKE: Schema.optional(Schema.Literals([0, 1])),
    DisableRedirect: Schema.optional(Schema.Literals([0, 1])),
    DisconnectOnIdle: Schema.optional(Schema.Literals([0, 1])),
    DisconnectOnIdleTimer: Schema.optional(Schema.Int),
    NATKeepAliveOffloadEnable: Schema.optional(Schema.Literals([0, 1])),
    NATKeepAliveInterval: Schema.optional(Schema.Int),
    EnablePFS: Schema.optional(Schema.Literals([0, 1])),
    EnableCertificateRevocationCheck: Schema.optional(Schema.Literals([0, 1])),
    EnableFallback: Schema.optional(Schema.Literals([0, 1])),
    MTU: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1280), Schema.isLessThanOrEqualTo(1400)))),
    ProviderType: Schema.optional(Schema.Literals(["packet-tunnel", "app-proxy"])),
    IncludeAllNetworks: Schema.optional(Schema.Literals([0, 1])),
    EnforceRoutes: Schema.optional(Schema.Literals([0, 1])),
    ExcludeLocalNetworks: Schema.optional(Schema.Literals([0, 1])),
    ExcludeCellularServices: Schema.optional(Schema.Literals([0, 1])),
    ExcludeAPNs: Schema.optional(Schema.Literals([0, 1])),
    ExcludeDeviceCommunication: Schema.optional(Schema.Literals([0, 1])),
    PPK: Schema.optional(Schema.String),
    PPKIdentifier: Schema.optional(Schema.String),
    PPKMandatory: Schema.optional(Schema.Literals([0, 1])),
    AllowPostQuantumKeyExchangeFallback: Schema.optional(Schema.Literals([0, 1])),
    EnforceStrictAlgorithmSelection: Schema.optional(Schema.Literals([0, 1])),
    IKESecurityAssociationParameters: Schema.optional(Schema.Struct({
      EncryptionAlgorithm: Schema.optional(Schema.Literals(["DES", "3DES", "AES-128", "AES-256", "AES-128-GCM", "AES-256-GCM", "ChaCha20Poly1305"])),
      IntegrityAlgorithm: Schema.optional(Schema.Literals(["SHA1-96", "SHA1-160", "SHA2-256", "SHA2-384", "SHA2-512"])),
      DiffieHellmanGroup: Schema.optional(Schema.Literals([1, 2, 5, 14, 15, 16, 17, 18, 19, 20, 21, 31, 32])),
      PostQuantumKeyExchangeMethods: Schema.optional(Schema.Array(Schema.Literals([0, 36, 37]))),
      LifeTimeInMinutes: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(10), Schema.isLessThanOrEqualTo(1440))))
    })),
    ChildSecurityAssociationParameters: Schema.optional(Schema.Struct({
      EncryptionAlgorithm: Schema.optional(Schema.Literals(["DES", "3DES", "AES-128", "AES-256", "AES-128-GCM", "AES-256-GCM", "ChaCha20Poly1305"])),
      IntegrityAlgorithm: Schema.optional(Schema.Literals(["SHA1-96", "SHA1-160", "SHA2-256", "SHA2-384", "SHA2-512"])),
      DiffieHellmanGroup: Schema.optional(Schema.Literals([1, 2, 5, 14, 15, 16, 17, 18, 19, 20, 21, 31, 32])),
      PostQuantumKeyExchangeMethods: Schema.optional(Schema.Array(Schema.Literals([0, 36, 37]))),
      LifeTimeInMinutes: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(10), Schema.isLessThanOrEqualTo(1440))))
    }))
  })),
  DNS: Schema.optional(Schema.Struct({
    DNSProtocol: Schema.Literals(["Cleartext", "HTTPS", "TLS"]),
    ServerURL: Schema.optional(Schema.String),
    ServerName: Schema.optional(Schema.String),
    ServerAddresses: Schema.Array(Schema.String),
    SearchDomains: Schema.optional(Schema.Array(Schema.String)),
    DomainName: Schema.optional(Schema.String),
    SupplementalMatchDomains: Schema.optional(Schema.Array(Schema.String)),
    SupplementalMatchDomainsNoSearch: Schema.optional(Schema.Literals([0, 1])),
    PayloadCertificateUUID: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{12}$/))))
  })),
  Proxies: Schema.optional(Schema.Struct({
    ProxyAutoConfigEnable: Schema.optional(Schema.Literals([0, 1])),
    ProxyAutoDiscoveryEnable: Schema.optional(Schema.Literals([0, 1])),
    ProxyAutoConfigURLString: Schema.optional(Schema.String),
    SupplementalMatchDomains: Schema.optional(Schema.Array(Schema.String)),
    HTTPEnable: Schema.optional(Schema.Literals([0, 1])),
    HTTPProxy: Schema.optional(Schema.String),
    HTTPPort: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(65535)))),
    HTTPProxyUsername: Schema.optional(Schema.String),
    HTTPProxyPassword: Schema.optional(Schema.String),
    HTTPSEnable: Schema.optional(Schema.Literals([0, 1])),
    HTTPSProxy: Schema.optional(Schema.String),
    HTTPSPort: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(65535))))
  })),
  AlwaysOn: Schema.optional(Schema.Struct({
    UIToggleEnabled: Schema.optional(Schema.Literals([0, 1])),
    TunnelConfigurations: Schema.Array(Schema.Struct({
      ProtocolType: Schema.Literal("IKEv2"),
      Interfaces: Schema.optional(Schema.Array(Schema.Literals(["Cellular", "WiFi"])))
    })),
    ServiceExceptions: Schema.optional(Schema.Array(Schema.Struct({
      ServiceName: Schema.Literals(["VoiceMail", "AirPrint", "CellularServices", "DeviceCommunication"]),
      Action: Schema.Literals(["Allow", "Drop"])
    }))),
    ApplicationExceptions: Schema.optional(Schema.Array(Schema.Struct({
      BundleIdentifier: Schema.String,
      LimitToProtocols: Schema.optional(Schema.Array(Schema.Literal("UDP")))
    }))),
    AllowCaptiveWebSheet: Schema.optional(Schema.Literals([0, 1])),
    AllowAllCaptiveNetworkPlugins: Schema.optional(Schema.Literals([0, 1])),
    AllowedCaptiveNetworkPlugins: Schema.optional(Schema.Array(Schema.Struct({
      BundleIdentifier: Schema.String
    })))
  })),
  TransparentProxy: Schema.optional(Schema.Struct({
    AuthenticationMethod: Schema.optional(Schema.Literals(["Password", "Certificate", "Password+Certificate"])),
    DisconnectOnIdle: Schema.optional(Schema.Literals([0, 1])),
    DisconnectOnIdleTimer: Schema.optional(Schema.Int),
    EnforceRoutes: Schema.optional(Schema.Literals([0, 1])),
    OnDemandEnabled: Schema.optional(Schema.Literals([0, 1])),
    OnDemandRules: Schema.optional(Schema.Array(Schema.Struct({
      Action: Schema.Literals(["Allow", "Connect", "Disconnect", "EvaluateConnection", "Ignore"]),
      ActionParameters: Schema.optional(Schema.Array(Schema.Struct({
        Domains: Schema.Array(Schema.String),
        DomainAction: Schema.Literals(["ConnectIfNeeded", "NeverConnect"]),
        RequiredDNSServers: Schema.optional(Schema.Array(Schema.String)),
        RequiredURLStringProbe: Schema.optional(Schema.String)
      }))),
      DNSDomainMatch: Schema.optional(Schema.Array(Schema.String)),
      DNSServerAddressMatch: Schema.optional(Schema.Array(Schema.String)),
      InterfaceTypeMatch: Schema.optional(Schema.Literals(["Ethernet", "WiFi", "Cellular"])),
      SSIDMatch: Schema.optional(Schema.Array(Schema.String)),
      URLStringProbe: Schema.optional(Schema.String)
    }))),
    PayloadCertificateUUID: Schema.optional(Schema.String),
    Password: Schema.optional(Schema.String),
    ProviderBundleIdentifier: Schema.optional(Schema.String),
    ProviderDesignatedRequirement: Schema.optional(Schema.String),
    ProviderType: Schema.optional(Schema.Literals(["packet-tunnel", "app-proxy"])),
    Order: Schema.optional(Schema.Int)
  }))
});
export type ComAppleVpnManaged = typeof ComAppleVpnManaged.Type;

/**
 * App-Layer VPN
 * The payload that configures a per-app VPN.
 */
export const ComAppleVpnManagedApplayer = Schema.Struct({
  VPNUUID: Schema.String,
  CellularSliceUUID: Schema.optional(Schema.String),
  SafariDomains: Schema.optional(Schema.Array(Schema.String)),
  MailDomains: Schema.optional(Schema.Array(Schema.String)),
  CalendarDomains: Schema.optional(Schema.Array(Schema.String)),
  ContactsDomains: Schema.optional(Schema.Array(Schema.String)),
  AssociatedDomains: Schema.optional(Schema.Array(Schema.String)),
  ExcludedDomains: Schema.optional(Schema.Array(Schema.String)),
  OnDemandMatchAppEnabled: Schema.optional(Schema.Boolean),
  SMBDomains: Schema.optional(Schema.Array(Schema.String))
});
export type ComAppleVpnManagedApplayer = typeof ComAppleVpnManagedApplayer.Type;

/**
 * App-to-App-Layer VPN Mapping
 * The payload that configures per-app VPN settings.
 */
export const ComAppleVpnManagedAppmapping = Schema.Struct({
  AppLayerVPNMapping: Schema.Array(Schema.Struct({
    Identifier: Schema.String,
    VPNUUID: Schema.String,
    DesignatedRequirement: Schema.String,
    SigningIdentifier: Schema.String,
    Path: Schema.optional(Schema.String),
    MatchTools: Schema.optional(Schema.Array(Schema.Struct({
      DesignatedRequirement: Schema.String,
      SigningIdentifier: Schema.String,
      Path: Schema.optional(Schema.String)
    })))
  }))
});
export type ComAppleVpnManagedAppmapping = typeof ComAppleVpnManagedAppmapping.Type;

/**
 * Web Clip
 * The profile that configures web clips on the device.
 */
export const ComAppleWebclipManaged = Schema.Struct({
  Precomposed: Schema.optional(Schema.Boolean),
  FullScreen: Schema.optional(Schema.Boolean),
  URL: Schema.String,
  Icon: Schema.optional(Schema.String),
  IsRemovable: Schema.optional(Schema.Boolean),
  Label: Schema.String,
  IgnoreManifestScope: Schema.optional(Schema.Boolean),
  TargetApplicationBundleIdentifier: Schema.optional(Schema.String)
});
export type ComAppleWebclipManaged = typeof ComAppleWebclipManaged.Type;

/**
 * Web Content Filter
 * The payload that configures web content filters.
 */
export const ComAppleWebcontentFilter = Schema.Struct({
  FilterType: Schema.optional(Schema.Literals(["BuiltIn", "Plugin"])),
  SafariHistoryRetentionEnabled: Schema.optional(Schema.Boolean),
  AutoFilterEnabled: Schema.optional(Schema.Boolean),
  PermittedURLs: Schema.optional(Schema.Array(Schema.String)),
  BlacklistedURLs: Schema.optional(Schema.Array(Schema.String)),
  DenyListURLs: Schema.optional(Schema.Array(Schema.String)),
  HideDenyListURLs: Schema.optional(Schema.Boolean),
  WhitelistedBookmarks: Schema.optional(Schema.Array(Schema.Struct({
    URL: Schema.String,
    Title: Schema.String
  }))),
  AllowListBookmarks: Schema.optional(Schema.Array(Schema.Struct({
    URL: Schema.String,
    Title: Schema.String
  }))),
  UserDefinedName: Schema.optional(Schema.String),
  PluginBundleID: Schema.optional(Schema.String),
  ServerAddress: Schema.optional(Schema.String),
  UserName: Schema.optional(Schema.String),
  Password: Schema.optional(Schema.String),
  PayloadCertificateUUID: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{12}$/)))),
  Organization: Schema.optional(Schema.String),
  VendorConfig: Schema.optional(Schema.Struct({
    ANY: Schema.Unknown /* <any> */
  })),
  FilterBrowsers: Schema.optional(Schema.Boolean),
  FilterSockets: Schema.optional(Schema.Boolean),
  FilterDataProviderDesignatedRequirement: Schema.optional(Schema.String),
  FilterDataProviderBundleIdentifier: Schema.optional(Schema.String),
  FilterPackets: Schema.optional(Schema.Boolean),
  FilterPacketProviderDesignatedRequirement: Schema.optional(Schema.String),
  FilterPacketProviderBundleIdentifier: Schema.optional(Schema.String),
  FilterGrade: Schema.optional(Schema.Literals(["firewall", "inspector"])),
  ContentFilterUUID: Schema.optional(Schema.String),
  FilterURLs: Schema.optional(Schema.Boolean),
  URLFilterParameters: Schema.optional(Schema.Struct({
    URLFilterControlProviderDesignatedRequirement: Schema.optional(Schema.String),
    URLFilterControlProviderBundleIdentifier: Schema.String,
    PIRServerURL: Schema.String,
    PIRPrivacyPassIssuerURL: Schema.String,
    PIRAuthenticationToken: Schema.String,
    URLFilterFailClosed: Schema.optional(Schema.Boolean),
    URLPrefilterFetchFrequency: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(2700))))
  }))
});
export type ComAppleWebcontentFilter = typeof ComAppleWebcontentFilter.Type;

/**
 * Wi-Fi
 * The payload that configures Wi-Fi settings.
 */
export const ComAppleWifiManaged = Schema.Struct({
  AutoJoin: Schema.optional(Schema.Boolean),
  SSID_STR: Schema.optional(Schema.String),
  HIDDEN_NETWORK: Schema.optional(Schema.Boolean),
  ProxyType: Schema.optional(Schema.Literals(["None", "Manual", "Auto"])),
  EncryptionType: Schema.optional(Schema.Literals(["WEP", "WPA", "WPA2", "WPA3", "Any", "None"])),
  Password: Schema.optional(Schema.String),
  PayloadCertificateUUID: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{12}$/)))),
  EAPClientConfiguration: Schema.optional(Schema.Struct({
    AcceptEAPTypes: Schema.Array(Schema.Literals([13, 17, 18, 21, 23, 25, 43])),
    UserName: Schema.optional(Schema.String),
    UserPassword: Schema.optional(Schema.String),
    PayloadCertificateAnchorUUID: Schema.optional(Schema.Array(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{12}$/))))),
    TLSTrustedCertificates: Schema.optional(Schema.Array(Schema.String)),
    TLSTrustedServerNames: Schema.optional(Schema.Array(Schema.String)),
    TLSAllowTrustExceptions: Schema.optional(Schema.Boolean),
    TLSCertificateIsRequired: Schema.optional(Schema.Boolean),
    TTLSInnerAuthentication: Schema.optional(Schema.Literals(["PAP", "EAP", "CHAP", "MSCHAP", "MSCHAPv2"])),
    TLSMinimumVersion: Schema.optional(Schema.Literals(["1.0", "1.1", "1.2", "1.3"])),
    TLSMaximumVersion: Schema.optional(Schema.Literals(["1.0", "1.1", "1.2", "1.3"])),
    OuterIdentity: Schema.optional(Schema.String),
    EAPFASTUsePAC: Schema.optional(Schema.Boolean),
    EAPFASTProvisionPAC: Schema.optional(Schema.Boolean),
    EAPFASTProvisionPACAnonymously: Schema.optional(Schema.Boolean),
    EAPSIMNumberOfRANDs: Schema.optional(Schema.Literals([2, 3])),
    SystemModeCredentialsSource: Schema.optional(Schema.String),
    SystemModeUseOpenDirectoryCredentials: Schema.optional(Schema.Boolean),
    OneTimeUserPassword: Schema.optional(Schema.Boolean)
  })),
  DisplayedOperatorName: Schema.optional(Schema.String),
  DomainName: Schema.optional(Schema.String),
  RoamingConsortiumOIs: Schema.optional(Schema.Array(Schema.String.pipe(Schema.check(Schema.isPattern(/^([0-9A-Za-z]{6})|([0-9A-Za-z]{9})$/))))),
  ServiceProviderRoamingEnabled: Schema.optional(Schema.Boolean),
  IsHotspot: Schema.optional(Schema.Boolean),
  HESSID: Schema.optional(Schema.String),
  NAIRealmNames: Schema.optional(Schema.Array(Schema.String)),
  MCCAndMNCs: Schema.optional(Schema.Array(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]{6}$/))))),
  CaptiveBypass: Schema.optional(Schema.Boolean),
  QoSMarkingPolicy: Schema.optional(Schema.Struct({
    QoSMarkingAllowListAppIdentifiers: Schema.optional(Schema.Array(Schema.String)),
    QoSMarkingWhitelistedAppIdentifiers: Schema.optional(Schema.Array(Schema.String)),
    QoSMarkingAppleAudioVideoCalls: Schema.optional(Schema.Boolean),
    QoSMarkingEnabled: Schema.optional(Schema.Boolean)
  })),
  SetupModes: Schema.optional(Schema.Array(Schema.Literals(["System", "Loginwindow"]))),
  EnableIPv6: Schema.optional(Schema.Boolean),
  TLSCertificateRequired: Schema.optional(Schema.Boolean),
  ProxyServer: Schema.optional(Schema.String),
  ProxyServerPort: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(65535)))),
  ProxyUsername: Schema.optional(Schema.String),
  ProxyPassword: Schema.optional(Schema.String),
  ProxyPACURL: Schema.optional(Schema.String),
  ProxyPACFallbackAllowed: Schema.optional(Schema.Boolean),
  DisableAssociationMACRandomization: Schema.optional(Schema.Boolean),
  AllowJoinBeforeFirstUnlock: Schema.optional(Schema.Boolean)
});
export type ComAppleWifiManaged = typeof ComAppleWifiManaged.Type;

/**
 * Xsan
 * The payload that configures an Xsan client system.
 */
export const ComAppleXsan = Schema.Struct({
  sanName: Schema.String,
  sanConfigURLs: Schema.optional(Schema.Array(Schema.String)),
  fsnameservers: Schema.optional(Schema.Array(Schema.String)),
  sanAuthMethod: Schema.optional(Schema.Literal("auth_secret")),
  sharedSecret: Schema.String
});
export type ComAppleXsan = typeof ComAppleXsan.Type;

/**
 * Xsan Preferences
 * The payload that configures the Xsan preferences that define the volumes that automatically mount at startup.
 */
export const ComAppleXsanPreferences = Schema.Struct({
  onlyMount: Schema.optional(Schema.Array(Schema.String)),
  denyMount: Schema.optional(Schema.Array(Schema.String)),
  denyDLC: Schema.optional(Schema.Array(Schema.String)),
  preferDLC: Schema.optional(Schema.Array(Schema.String)),
  useDLC: Schema.optional(Schema.Boolean)
});
export type ComAppleXsanPreferences = typeof ComAppleXsanPreferences.Type;

/**
 * Common Payload Keys
 * The properties common to all payloads.
 */
export const Commonpayloadkeys = Schema.Struct({
  PayloadIdentifier: Schema.String,
  PayloadUUID: Schema.String,
  PayloadType: Schema.String,
  PayloadVersion: Schema.Literal(1),
  PayloadDescription: Schema.optional(Schema.String),
  PayloadDisplayName: Schema.optional(Schema.String),
  PayloadOrganization: Schema.optional(Schema.String)
});
export type Commonpayloadkeys = typeof Commonpayloadkeys.Type;

/**
 * Global Preferences
 * The payload to configure global preferences.
 */
export const Globalpreferences = Schema.Struct({
  MultipleSessionEnabled: Schema.optional(Schema.Boolean),
  "com.apple.autologout.AutoLogOutDelay": Schema.optional(Schema.Number)
});
export type Globalpreferences = typeof Globalpreferences.Type;

/**
 * Login Window: Login Items
 * The payload that configures login behavior.
 */
export const Loginwindow = Schema.Struct({
  DisableLoginItemsSuppression: Schema.optional(Schema.Boolean)
});
export type Loginwindow = typeof Loginwindow.Type;

/**
 * Top Level
 * The top-level payload properties for all profiles.
 */
export const Toplevel = Schema.Struct({
  PayloadIdentifier: Schema.String,
  PayloadUUID: Schema.String,
  PayloadType: Schema.Literal("Configuration"),
  PayloadVersion: Schema.Literal(1),
  PayloadContent: Schema.Array(Schema.Struct({
    ANY: Schema.Unknown /* <any> */
  })),
  EncryptedPayloadContent: Schema.optional(Schema.String),
  PayloadDescription: Schema.optional(Schema.String),
  PayloadDisplayName: Schema.optional(Schema.String),
  PayloadOrganization: Schema.optional(Schema.String),
  PayloadRemovalDisallowed: Schema.optional(Schema.Boolean),
  PayloadScope: Schema.optional(Schema.Literals(["System", "User"])),
  RemovalDate: Schema.optional(Schema.String),
  DurationUntilRemoval: Schema.optional(Schema.Number),
  PayloadExpirationDate: Schema.optional(Schema.String),
  TargetDeviceType: Schema.optional(Schema.Literals([0, 1, 2, 3, 4, 5, 6])),
  ConsentText: Schema.optional(Schema.Struct({
    ConsentTextItem: Schema.Struct({
      ANY: Schema.String
    })
  }))
});
export type Toplevel = typeof Toplevel.Type;
