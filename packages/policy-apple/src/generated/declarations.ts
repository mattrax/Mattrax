// Auto-generated from https://github.com/apple/device-management
// Do not edit manually.

import { Schema } from "effect";

/**
 * Account:CalDAV
 * The declaration to configure a Calendar account.
 */
export const ComAppleConfigurationAccountCaldav = Schema.Struct({
  VisibleName: Schema.optional(Schema.String),
  HostName: Schema.String,
  Port: Schema.optional(Schema.Int),
  Path: Schema.optional(Schema.String),
  AuthenticationCredentialsAssetReference: Schema.optional(Schema.String)
});
export type ComAppleConfigurationAccountCaldav = typeof ComAppleConfigurationAccountCaldav.Type;

/**
 * Account:CardDAV
 * The declaration to configure a Contacts account.
 */
export const ComAppleConfigurationAccountCarddav = Schema.Struct({
  VisibleName: Schema.optional(Schema.String),
  HostName: Schema.String,
  Port: Schema.optional(Schema.Int),
  Path: Schema.optional(Schema.String),
  AuthenticationCredentialsAssetReference: Schema.optional(Schema.String)
});
export type ComAppleConfigurationAccountCarddav = typeof ComAppleConfigurationAccountCarddav.Type;

/**
 * Account:Exchange
 * The declaration to configure an Exchange account.
 */
export const ComAppleConfigurationAccountExchange = Schema.Struct({
  VisibleName: Schema.optional(Schema.String),
  EnabledProtocolTypes: Schema.Array(Schema.Literals(["EAS", "EWS"])),
  UserIdentityAssetReference: Schema.optional(Schema.String),
  HostName: Schema.optional(Schema.String),
  Port: Schema.optional(Schema.Int),
  Path: Schema.optional(Schema.String),
  ExternalHostName: Schema.optional(Schema.String),
  ExternalPort: Schema.optional(Schema.Int),
  "External Path": Schema.optional(Schema.String),
  OAuth: Schema.optional(Schema.Struct({
    Enabled: Schema.Boolean,
    SignInURL: Schema.optional(Schema.String),
    TokenRequestURL: Schema.optional(Schema.String)
  })),
  AuthenticationCredentialsAssetReference: Schema.optional(Schema.String),
  AuthenticationIdentityAssetReference: Schema.optional(Schema.String),
  SMIME: Schema.optional(Schema.Struct({
    Signing: Schema.optional(Schema.Struct({
      Enabled: Schema.Boolean,
      IdentityAssetReference: Schema.optional(Schema.String),
      UserOverrideable: Schema.optional(Schema.Boolean),
      IdentityUserOverrideable: Schema.optional(Schema.Boolean)
    })),
    Encryption: Schema.optional(Schema.Struct({
      Enabled: Schema.Boolean,
      IdentityAssetReference: Schema.optional(Schema.String),
      UserOverrideable: Schema.optional(Schema.Boolean),
      IdentityUserOverrideable: Schema.optional(Schema.Boolean),
      PerMessageSwitchEnabled: Schema.optional(Schema.Boolean)
    }))
  })),
  MailServiceActive: Schema.optional(Schema.Boolean),
  LockMailService: Schema.optional(Schema.Boolean),
  ContactsServiceActive: Schema.optional(Schema.Boolean),
  LockContactsService: Schema.optional(Schema.Boolean),
  CalendarServiceActive: Schema.optional(Schema.Boolean),
  LockCalendarService: Schema.optional(Schema.Boolean),
  RemindersServiceActive: Schema.optional(Schema.Boolean),
  LockRemindersService: Schema.optional(Schema.Boolean),
  NotesServiceActive: Schema.optional(Schema.Boolean),
  LockNotesService: Schema.optional(Schema.Boolean)
});
export type ComAppleConfigurationAccountExchange = typeof ComAppleConfigurationAccountExchange.Type;

/**
 * Account:Google
 * The declaration to configure a Google account.
 */
export const ComAppleConfigurationAccountGoogle = Schema.Struct({
  VisibleName: Schema.optional(Schema.String),
  UserIdentityAssetReference: Schema.String
});
export type ComAppleConfigurationAccountGoogle = typeof ComAppleConfigurationAccountGoogle.Type;

/**
 * Account:LDAP
 * The declaration to configure a Lightweight Directory Access Protocol (LDAP) account.
 */
export const ComAppleConfigurationAccountLdap = Schema.Struct({
  VisibleName: Schema.optional(Schema.String),
  HostName: Schema.String,
  Port: Schema.optional(Schema.Int),
  AuthenticationCredentialsAssetReference: Schema.optional(Schema.String),
  SearchSettings: Schema.optional(Schema.Array(Schema.Struct({
    VisibleDescription: Schema.optional(Schema.String),
    SearchBase: Schema.String,
    Scope: Schema.optional(Schema.Literals(["Base", "OneLevel", "Subtree"]))
  })))
});
export type ComAppleConfigurationAccountLdap = typeof ComAppleConfigurationAccountLdap.Type;

/**
 * Account:Mail
 * The declaration to configure a Mail account.
 */
export const ComAppleConfigurationAccountMail = Schema.Struct({
  VisibleName: Schema.optional(Schema.String),
  UserIdentityAssetReference: Schema.optional(Schema.String),
  IncomingServer: Schema.Struct({
    ServerType: Schema.Literals(["IMAP", "POP"]),
    HostName: Schema.String,
    Port: Schema.optional(Schema.Int),
    AuthenticationMethod: Schema.Literals(["None", "Password", "CRAMMD5", "NTLM", "HTTPMD5"]),
    AuthenticationCredentialsAssetReference: Schema.optional(Schema.String),
    IMAPPathPrefix: Schema.optional(Schema.String)
  }),
  OutgoingServer: Schema.Struct({
    HostName: Schema.String,
    Port: Schema.optional(Schema.Int),
    AuthenticationMethod: Schema.Literals(["None", "Password", "CRAMMD5", "NTLM", "HTTPMD5"]),
    AuthenticationCredentialsAssetReference: Schema.optional(Schema.String)
  }),
  SMIME: Schema.optional(Schema.Struct({
    Signing: Schema.optional(Schema.Struct({
      Enabled: Schema.Boolean,
      IdentityAssetReference: Schema.optional(Schema.String),
      UserOverrideable: Schema.optional(Schema.Boolean),
      IdentityUserOverrideable: Schema.optional(Schema.Boolean)
    })),
    Encryption: Schema.optional(Schema.Struct({
      Enabled: Schema.Boolean,
      IdentityAssetReference: Schema.optional(Schema.String),
      UserOverrideable: Schema.optional(Schema.Boolean),
      IdentityUserOverrideable: Schema.optional(Schema.Boolean),
      PerMessageSwitchEnabled: Schema.optional(Schema.Boolean)
    }))
  }))
});
export type ComAppleConfigurationAccountMail = typeof ComAppleConfigurationAccountMail.Type;

/**
 * Account:Subscribed Calendar
 * The declaration to configure a subscribed calendar.
 */
export const ComAppleConfigurationAccountSubscribedCalendar = Schema.Struct({
  VisibleName: Schema.optional(Schema.String),
  CalendarURL: Schema.String,
  AuthenticationCredentialsAssetReference: Schema.optional(Schema.String)
});
export type ComAppleConfigurationAccountSubscribedCalendar = typeof ComAppleConfigurationAccountSubscribedCalendar.Type;

/**
 * App:Managed
 * The declaration to configure a managed app.
 */
export const ComAppleConfigurationAppManaged = Schema.Struct({
  AppStoreID: Schema.optional(Schema.String),
  BundleID: Schema.optional(Schema.String),
  ManifestURL: Schema.optional(Schema.String),
  AppComposedIdentifier: Schema.optional(Schema.String),
  iOSApp: Schema.optional(Schema.Boolean),
  InstallBehavior: Schema.optional(Schema.Struct({
    Install: Schema.optional(Schema.Literals(["Optional", "Required"])),
    License: Schema.optional(Schema.Struct({
      Assignment: Schema.optional(Schema.Literals(["Device", "User"])),
      VPPType: Schema.optional(Schema.Literals(["Device", "User"]))
    })),
    Version: Schema.optional(Schema.Int),
    AllowDownloadsOverCellular: Schema.optional(Schema.Literals(["AlwaysOn", "AlwaysOff", "StoreSettings"]))
  })),
  UpdateBehavior: Schema.optional(Schema.Struct({
    AutomaticAppUpdates: Schema.Literals(["AlwaysOn", "AlwaysOff", "StoreSettings"])
  })),
  IncludeInBackup: Schema.optional(Schema.Boolean),
  Attributes: Schema.optional(Schema.Struct({
    AssociatedDomains: Schema.optional(Schema.Array(Schema.String)),
    AssociatedDomainsEnableDirectDownloads: Schema.optional(Schema.Boolean),
    CellularSliceUUID: Schema.optional(Schema.String),
    ContentFilterUUID: Schema.optional(Schema.String),
    DNSProxyUUID: Schema.optional(Schema.String),
    Hideable: Schema.optional(Schema.Boolean),
    Lockable: Schema.optional(Schema.Boolean),
    RelayUUID: Schema.optional(Schema.String),
    TapToPayScreenLock: Schema.optional(Schema.Boolean),
    VPNUUID: Schema.optional(Schema.String)
  })),
  AppConfig: Schema.optional(Schema.Struct({
    DataAssetReference: Schema.optional(Schema.String),
    Passwords: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      AssetReference: Schema.String
    }))),
    Identities: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      AssetReference: Schema.String
    }))),
    Certificates: Schema.optional(Schema.Array(Schema.Struct({
      Identifier: Schema.String,
      AssetReference: Schema.String
    })))
  })),
  ExtensionConfigs: Schema.optional(Schema.Struct({
    ANY: Schema.optional(Schema.Struct({
      DataAssetReference: Schema.optional(Schema.String),
      Passwords: Schema.optional(Schema.Array(Schema.Struct({
        Identifier: Schema.String,
        AssetReference: Schema.String
      }))),
      Identities: Schema.optional(Schema.Array(Schema.Struct({
        Identifier: Schema.String,
        AssetReference: Schema.String
      }))),
      Certificates: Schema.optional(Schema.Array(Schema.Struct({
        Identifier: Schema.String,
        AssetReference: Schema.String
      })))
    }))
  })),
  LegacyAppConfigAssetReference: Schema.optional(Schema.String)
});
export type ComAppleConfigurationAppManaged = typeof ComAppleConfigurationAppManaged.Type;

/**
 * Audio Accessory:Settings
 * The declaration to configure audio accessory settings.
 */
export const ComAppleConfigurationAudioAccessorySettings = Schema.Struct({
  TemporaryPairing: Schema.optional(Schema.Struct({
    Disabled: Schema.optional(Schema.Boolean),
    Configuration: Schema.optional(Schema.Struct({
      UnpairingTime: Schema.Struct({
        Policy: Schema.Literals(["None", "Hour"]),
        Hour: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(23))))
      })
    }))
  }))
});
export type ComAppleConfigurationAudioAccessorySettings = typeof ComAppleConfigurationAudioAccessorySettings.Type;

/**
 * Disk Management:Settings
 * The declaration to configure disk management settings on the device.
 */
export const ComAppleConfigurationDiskmanagementSettings = Schema.Struct({
  Restrictions: Schema.optional(Schema.Struct({
    ExternalStorage: Schema.optional(Schema.Literals(["Allowed", "ReadOnly", "Disallowed"])),
    NetworkStorage: Schema.optional(Schema.Literals(["Allowed", "ReadOnly", "Disallowed"]))
  }))
});
export type ComAppleConfigurationDiskmanagementSettings = typeof ComAppleConfigurationDiskmanagementSettings.Type;

/**
 * External Intelligence Settings
 * The declaration to configure External Intelligence Integrations settings.
 */
export const ComAppleConfigurationExternalIntelligenceSettings = Schema.Struct({
  Enabled: Schema.optional(Schema.Boolean),
  AllowSignIn: Schema.optional(Schema.Boolean),
  AllowedWorkspaceIDs: Schema.optional(Schema.Array(Schema.String))
});
export type ComAppleConfigurationExternalIntelligenceSettings = typeof ComAppleConfigurationExternalIntelligenceSettings.Type;

/**
 * Intelligence Settings
 * The declaration to configure Apple Intelligence settings.
 */
export const ComAppleConfigurationIntelligenceSettings = Schema.Struct({
  AllowAppleIntelligenceReport: Schema.optional(Schema.Boolean),
  AllowGenmoji: Schema.optional(Schema.Boolean),
  AllowImagePlayground: Schema.optional(Schema.Boolean),
  AllowImageWand: Schema.optional(Schema.Boolean),
  AllowPersonalizedHandwritingResults: Schema.optional(Schema.Boolean),
  AllowVisualIntelligenceSummary: Schema.optional(Schema.Boolean),
  AllowWritingTools: Schema.optional(Schema.Boolean),
  Apps: Schema.optional(Schema.Struct({
    Mail: Schema.optional(Schema.Struct({
      AllowSmartReplies: Schema.optional(Schema.Boolean),
      AllowSummary: Schema.optional(Schema.Boolean)
    })),
    Notes: Schema.optional(Schema.Struct({
      AllowTranscription: Schema.optional(Schema.Boolean),
      AllowTranscriptionSummary: Schema.optional(Schema.Boolean)
    })),
    Safari: Schema.optional(Schema.Struct({
      AllowSummary: Schema.optional(Schema.Boolean)
    }))
  })),
  ForceOnDeviceOnlyDictation: Schema.optional(Schema.Boolean),
  ForceOnDeviceOnlyTranslation: Schema.optional(Schema.Boolean)
});
export type ComAppleConfigurationIntelligenceSettings = typeof ComAppleConfigurationIntelligenceSettings.Type;

/**
 * Keyboard Settings
 * The declaration to configure keyboard settings.
 */
export const ComAppleConfigurationKeyboardSettings = Schema.Struct({
  AllowAutoCorrection: Schema.optional(Schema.Boolean),
  AllowDefinitionLookup: Schema.optional(Schema.Boolean),
  AllowDictation: Schema.optional(Schema.Boolean),
  AllowMathKeyboardSuggestions: Schema.optional(Schema.Boolean),
  AllowPredictiveText: Schema.optional(Schema.Boolean),
  AllowSlideToType: Schema.optional(Schema.Boolean),
  AllowSpellCheck: Schema.optional(Schema.Boolean),
  AllowTextReplacement: Schema.optional(Schema.Boolean)
});
export type ComAppleConfigurationKeyboardSettings = typeof ComAppleConfigurationKeyboardSettings.Type;

/**
 * Legacy Profile
 * The declaration to configure a legacy profile.
 */
export const ComAppleConfigurationLegacy = Schema.Struct({
  ProfileURL: Schema.String
});
export type ComAppleConfigurationLegacy = typeof ComAppleConfigurationLegacy.Type;

/**
 * Legacy Interactive Profile
 * The declaration to configure an interactive legacy profile.
 */
export const ComAppleConfigurationLegacyInteractive = Schema.Struct({
  ProfileURL: Schema.String,
  VisibleName: Schema.String
});
export type ComAppleConfigurationLegacyInteractive = typeof ComAppleConfigurationLegacyInteractive.Type;

/**
 * Management:Status Subscriptions
 * The declaration to configure status subscriptions.
 */
export const ComAppleConfigurationManagementStatusSubscriptions = Schema.Struct({
  StatusItems: Schema.Array(Schema.Struct({
    Name: Schema.String
  }))
});
export type ComAppleConfigurationManagementStatusSubscriptions = typeof ComAppleConfigurationManagementStatusSubscriptions.Type;

/**
 * Management:Test
 * The declaration to test declarative device management.
 */
export const ComAppleConfigurationManagementTest = Schema.Struct({
  Echo: Schema.String,
  EchoDataAssetReference: Schema.optional(Schema.String),
  ReturnStatus: Schema.optional(Schema.Literals(["Installed", "Failed", "Unlocked"]))
});
export type ComAppleConfigurationManagementTest = typeof ComAppleConfigurationManagementTest.Type;

/**
 * Math Settings
 * The declaration to configure the math and calculator apps.
 */
export const ComAppleConfigurationMathSettings = Schema.Struct({
  Calculator: Schema.optional(Schema.Struct({
    BasicMode: Schema.optional(Schema.Struct({
      AddSquareRoot: Schema.Boolean
    })),
    ScientificMode: Schema.optional(Schema.Struct({
      Enabled: Schema.Boolean
    })),
    ProgrammerMode: Schema.optional(Schema.Struct({
      Enabled: Schema.Boolean
    })),
    MathNotesMode: Schema.optional(Schema.Struct({
      Enabled: Schema.Boolean
    })),
    InputModes: Schema.optional(Schema.Struct({
      UnitConversion: Schema.Boolean,
      RPN: Schema.Boolean
    }))
  })),
  SystemBehavior: Schema.optional(Schema.Struct({
    KeyboardSuggestions: Schema.Boolean,
    MathNotes: Schema.Boolean
  }))
});
export type ComAppleConfigurationMathSettings = typeof ComAppleConfigurationMathSettings.Type;

/**
 * Migration Assistant Settings
 * The declaration to configure Migration Assistant settings.
 */
export const ComAppleConfigurationMigrationAssistantSettings = Schema.Struct({
  ShouldDoManagedMigration: Schema.Boolean,
  ExcludedAccounts: Schema.optional(Schema.Array(Schema.String)),
  ExcludedPaths: Schema.optional(Schema.Array(Schema.String)),
  RequiredPaths: Schema.optional(Schema.Array(Schema.String)),
  ShouldMigrateSecurityPrivacySettings: Schema.Boolean
});
export type ComAppleConfigurationMigrationAssistantSettings = typeof ComAppleConfigurationMigrationAssistantSettings.Type;

/**
 * Package
 * The declaration to install a package.
 */
export const ComAppleConfigurationPackage = Schema.Struct({
  ManifestURL: Schema.String,
  InstallBehavior: Schema.optional(Schema.Struct({
    Install: Schema.optional(Schema.Literals(["Optional", "Required"]))
  }))
});
export type ComAppleConfigurationPackage = typeof ComAppleConfigurationPackage.Type;

/**
 * Passcode:Settings
 * The declaration to configure passcode policy settings.
 */
export const ComAppleConfigurationPasscodeSettings = Schema.Struct({
  RequirePasscode: Schema.optional(Schema.Boolean),
  RequireAlphanumericPasscode: Schema.optional(Schema.Boolean),
  RequireComplexPasscode: Schema.optional(Schema.Boolean),
  MinimumLength: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(16)))),
  MinimumComplexCharacters: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(4)))),
  MaximumFailedAttempts: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(2), Schema.isLessThanOrEqualTo(11)))),
  FailedAttemptsResetInMinutes: Schema.optional(Schema.Int),
  MaximumGracePeriodInMinutes: Schema.optional(Schema.Int),
  MaximumInactivityInMinutes: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(15)))),
  MaximumPasscodeAgeInDays: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(730)))),
  PasscodeReuseLimit: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(50)))),
  ChangeAtNextAuth: Schema.optional(Schema.Boolean),
  CustomRegex: Schema.optional(Schema.Struct({
    Regex: Schema.String,
    Description: Schema.optional(Schema.Struct({
      ANY: Schema.optional(Schema.String)
    }))
  }))
});
export type ComAppleConfigurationPasscodeSettings = typeof ComAppleConfigurationPasscodeSettings.Type;

const makeManagedbookmarksBookmarksFolder = (): Schema.Schema<any> => Schema.Struct({
    Title: Schema.String,
    URL: Schema.optional(Schema.String),
    Folder: Schema.optional(Schema.Array(Schema.suspend(() => ManagedbookmarksBookmarksFolder)))
  });
export const ManagedbookmarksBookmarksFolder = makeManagedbookmarksBookmarksFolder();
export type ManagedbookmarksBookmarksFolder = typeof ManagedbookmarksBookmarksFolder.Type;

/**
 * Safari:Bookmarks
 * The declaration to configure managed bookmarks in Safari.
 */
export const ComAppleConfigurationSafariBookmarks = Schema.Struct({
  ManagedBookmarks: Schema.optional(Schema.Array(Schema.Struct({
    GroupIdentifier: Schema.String,
    Title: Schema.String,
    Bookmarks: Schema.Array(Schema.Struct({
      Title: Schema.String,
      URL: Schema.optional(Schema.String),
      Folder: Schema.optional(Schema.Array(Schema.suspend(() => ManagedbookmarksBookmarksFolder)))
    }))
  })))
});
export type ComAppleConfigurationSafariBookmarks = typeof ComAppleConfigurationSafariBookmarks.Type;

/**
 * Safari:Extension Settings
 * The declaration to configure Safari Extensions.
 */
export const ComAppleConfigurationSafariExtensionsSettings = Schema.Struct({
  ManagedExtensions: Schema.optional(Schema.Struct({
    ANY: Schema.optional(Schema.Struct({
      State: Schema.optional(Schema.Literals(["Allowed", "AlwaysOn", "AlwaysOff"])),
      PrivateBrowsing: Schema.optional(Schema.Literals(["Allowed", "AlwaysOn", "AlwaysOff"])),
      AllowedDomains: Schema.optional(Schema.Array(Schema.String)),
      DeniedDomains: Schema.optional(Schema.Array(Schema.String))
    }))
  }))
});
export type ComAppleConfigurationSafariExtensionsSettings = typeof ComAppleConfigurationSafariExtensionsSettings.Type;

/**
 * Safari:Settings
 * The declaration to configure Safari settings.
 */
export const ComAppleConfigurationSafariSettings = Schema.Struct({
  AcceptCookies: Schema.optional(Schema.Literals(["Never", "CurrentWebsite", "VisitedWebsites", "Always"])),
  AllowDisablingFraudWarning: Schema.optional(Schema.Boolean),
  AllowHistoryClearing: Schema.optional(Schema.Boolean),
  AllowJavaScript: Schema.optional(Schema.Boolean),
  AllowPrivateBrowsing: Schema.optional(Schema.Boolean),
  AllowPopups: Schema.optional(Schema.Boolean),
  AllowSummary: Schema.optional(Schema.Boolean),
  NewTabStartPage: Schema.optional(Schema.Struct({
    PageType: Schema.Literals(["Start", "Home", "Extension"]),
    HomepageURL: Schema.optional(Schema.String),
    ExtensionIdentifier: Schema.optional(Schema.String)
  }))
});
export type ComAppleConfigurationSafariSettings = typeof ComAppleConfigurationSafariSettings.Type;

/**
 * Screen Sharing:Connection
 * The declaration to configure a connection to a screen-sharing host.
 */
export const ComAppleConfigurationScreensharingConnection = Schema.Struct({
  ConnectionUUID: Schema.String,
  DisplayName: Schema.String,
  HostName: Schema.String,
  Port: Schema.optional(Schema.Int),
  DisplayConfiguration: Schema.Struct({
    DisplayType: Schema.Literals(["Virtual1", "Virtual2"])
  }),
  AuthenticationCredentialsAssetReference: Schema.optional(Schema.String)
});
export type ComAppleConfigurationScreensharingConnection = typeof ComAppleConfigurationScreensharingConnection.Type;

/**
 * Screen Sharing:Connection Group
 * The declaration to configure a group of screen-sharing connections.
 */
export const ComAppleConfigurationScreensharingConnectionGroup = Schema.Struct({
  ConnectionGroupUUID: Schema.String,
  GroupName: Schema.String,
  Members: Schema.Array(Schema.String)
});
export type ComAppleConfigurationScreensharingConnectionGroup = typeof ComAppleConfigurationScreensharingConnectionGroup.Type;

/**
 * Screen Sharing:Host Settings
 * The declaration to configure screen-sharing host settings and restrictions.
 */
export const ComAppleConfigurationScreensharingHostSettings = Schema.Struct({
  MaximumVirtualDisplays: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(2)))),
  PortBase: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1024), Schema.isLessThanOrEqualTo(65535)))),
  PreventCopyFilesFromHost: Schema.optional(Schema.Boolean),
  PreventCopyFilesToHost: Schema.optional(Schema.Boolean),
  PreventHighPerformanceConnections: Schema.optional(Schema.Boolean)
});
export type ComAppleConfigurationScreensharingHostSettings = typeof ComAppleConfigurationScreensharingHostSettings.Type;

/**
 * Security:Certificate
 * The declaration to add a certificate to the device.
 */
export const ComAppleConfigurationSecurityCertificate = Schema.Struct({
  CredentialAssetReference: Schema.String
});
export type ComAppleConfigurationSecurityCertificate = typeof ComAppleConfigurationSecurityCertificate.Type;

/**
 * Security:Identity
 * The declaration to install an identity on the device.
 */
export const ComAppleConfigurationSecurityIdentity = Schema.Struct({
  CredentialAssetReference: Schema.String,
  AllowAllAppsAccess: Schema.optional(Schema.Boolean),
  KeyIsExtractable: Schema.optional(Schema.Boolean)
});
export type ComAppleConfigurationSecurityIdentity = typeof ComAppleConfigurationSecurityIdentity.Type;

/**
 * Security:Passkey:Attestation
 * The declaration to configure the device to allow WebAuthn enterprise attestation for certain passkeys.
 */
export const ComAppleConfigurationSecurityPasskeyAttestation = Schema.Struct({
  AttestationIdentityAssetReference: Schema.String,
  AttestationIdentityKeyIsExtractable: Schema.optional(Schema.Boolean),
  RelyingParties: Schema.Array(Schema.String)
});
export type ComAppleConfigurationSecurityPasskeyAttestation = typeof ComAppleConfigurationSecurityPasskeyAttestation.Type;

/**
 * Services Background Tasks
 * The declaration to configure background tasks.
 */
export const ComAppleConfigurationServicesBackgroundTasks = Schema.Struct({
  TaskType: Schema.String,
  TaskDescription: Schema.optional(Schema.String),
  ExecutableAssetReference: Schema.optional(Schema.String),
  LaunchdConfigurations: Schema.optional(Schema.Array(Schema.Struct({
    FileAssetReference: Schema.String,
    Context: Schema.Literals(["daemon", "agent"])
  })))
});
export type ComAppleConfigurationServicesBackgroundTasks = typeof ComAppleConfigurationServicesBackgroundTasks.Type;

/**
 * Services Configuration Files
 * The managed configuration files for services.
 */
export const ComAppleConfigurationServicesConfigurationFiles = Schema.Struct({
  ServiceType: Schema.String,
  DataAssetReference: Schema.String
});
export type ComAppleConfigurationServicesConfigurationFiles = typeof ComAppleConfigurationServicesConfigurationFiles.Type;

/**
 * Siri Settings
 * The declaration to configure Siri settings.
 */
export const ComAppleConfigurationSiriSettings = Schema.Struct({
  Enabled: Schema.optional(Schema.Boolean),
  AllowUserGeneratedContent: Schema.optional(Schema.Boolean),
  AllowWhileLocked: Schema.optional(Schema.Boolean),
  ForceProfanityFilter: Schema.optional(Schema.Boolean)
});
export type ComAppleConfigurationSiriSettings = typeof ComAppleConfigurationSiriSettings.Type;

/**
 * Software Update:Enforcement:Specific
 * A software update enforcement policy for a specific OS release.
 */
export const ComAppleConfigurationSoftwareupdateEnforcementSpecific = Schema.Struct({
  TargetOSVersion: Schema.String,
  TargetBuildVersion: Schema.optional(Schema.String),
  TargetLocalDateTime: Schema.String,
  DetailsURL: Schema.optional(Schema.String)
});
export type ComAppleConfigurationSoftwareupdateEnforcementSpecific = typeof ComAppleConfigurationSoftwareupdateEnforcementSpecific.Type;

/**
 * Software Update:Settings
 * The declaration to configure software updates.
 */
export const ComAppleConfigurationSoftwareupdateSettings = Schema.Struct({
  Notifications: Schema.optional(Schema.Boolean),
  Deferrals: Schema.optional(Schema.Struct({
    CombinedPeriodInDays: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(90)))),
    MajorPeriodInDays: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(90)))),
    MinorPeriodInDays: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(90)))),
    SystemPeriodInDays: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(90))))
  })),
  RecommendedCadence: Schema.optional(Schema.Literals(["All", "Oldest", "Newest"])),
  AutomaticActions: Schema.optional(Schema.Struct({
    Download: Schema.optional(Schema.Literals(["Allowed", "AlwaysOn", "AlwaysOff"])),
    InstallOSUpdates: Schema.optional(Schema.Literals(["Allowed", "AlwaysOn", "AlwaysOff"])),
    InstallSecurityUpdate: Schema.optional(Schema.Literals(["Allowed", "AlwaysOn", "AlwaysOff"]))
  })),
  RapidSecurityResponse: Schema.optional(Schema.Struct({
    Enable: Schema.optional(Schema.Boolean),
    EnableRollback: Schema.optional(Schema.Boolean)
  })),
  AllowStandardUserOSUpdates: Schema.optional(Schema.Boolean),
  Beta: Schema.optional(Schema.Struct({
    ProgramEnrollment: Schema.optional(Schema.Literals(["Allowed", "AlwaysOn", "AlwaysOff"])),
    OfferPrograms: Schema.optional(Schema.Array(Schema.Struct({
      Description: Schema.String,
      Token: Schema.String
    }))),
    RequireProgram: Schema.optional(Schema.Struct({
      Description: Schema.String,
      Token: Schema.String
    }))
  }))
});
export type ComAppleConfigurationSoftwareupdateSettings = typeof ComAppleConfigurationSoftwareupdateSettings.Type;

/**
 * Watch:Enrollment
 * The declaration to configure an MDMv1 profile for Apple Watch enrollment.
 */
export const ComAppleConfigurationWatchEnrollment = Schema.Struct({
  EnrollmentProfileURL: Schema.String,
  AnchorCertificateAssetReferences: Schema.optional(Schema.Array(Schema.String))
});
export type ComAppleConfigurationWatchEnrollment = typeof ComAppleConfigurationWatchEnrollment.Type;
