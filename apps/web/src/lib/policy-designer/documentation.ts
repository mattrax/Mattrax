import type { Collection, PlatformId, Property } from "./catalog";

/**
 * Documentation links for catalogue entries.
 *
 * Windows settings carry a `source` URL from Microsoft's Policy CSP reference,
 * so those links are derived from the catalogue. Apple has no stable URL scheme
 * for its payload and declaration types, so the developer.apple.com pages are a
 * curated map keyed by the catalogue identifier. Unknown Apple types fall back
 * to the platform's index page rather than to a guessed (and possibly dead)
 * URL.
 */

const APPLE_DOCS = "https://developer.apple.com/documentation/devicemanagement";

/** Index of every configuration-profile payload type Apple documents. */
export const APPLE_PROFILE_DOCS = `${APPLE_DOCS}/profile-specific-payload-keys`;

/** Index of every DDM declaration type Apple documents. */
export const APPLE_DECLARATION_DOCS = `${APPLE_DOCS}/devicemanagement-declarations`;

/** Landing page used when an entry is neither a profile nor a declaration. */
export const APPLE_DEVICE_MANAGEMENT_DOCS = APPLE_DOCS;

/** Microsoft's Policy CSP reference, the source behind every Windows link. */
export const WINDOWS_CSP_DOCS =
  "https://learn.microsoft.com/en-us/windows/client-management/mdm/configuration-service-provider-reference";

/**
 * Profile payload types (`PayloadType`) to their page on developer.apple.com.
 * Apple titles pages after the payload rather than its identifier, so the slug
 * cannot be derived. Types Apple no longer documents (AIM, Jabber, Dashboard,
 * the old macOS Server account) are deliberately absent and use the fallback.
 */
const PROFILE_SLUGS = {
  ".GlobalPreferences": "globalpreferences",
  TopLevel: "toplevel",
  "com.apple.ADCertificate.managed": "activedirectorycertificate",
  "com.apple.AssetCache.managed": "contentcachingservice",
  "com.apple.Dictionary": "parentalcontrolsdictionary",
  "com.apple.DirectoryService.managed": "directoryservice",
  "com.apple.DiscRecording": "mediamanagementdiscburning",
  "com.apple.MCX.FileVault2": "fdefilevault",
  "com.apple.MCX.TimeMachine": "timemachine",
  "com.apple.ManagedClient.preferences": "managedpreferences",
  "com.apple.NSExtension": "nsextensionmanagement",
  "com.apple.SetupAssistant.managed": "setupassistant",
  "com.apple.ShareKitHelper": "sharekit",
  "com.apple.SoftwareUpdate": "softwareupdate",
  "com.apple.SystemConfiguration": "networkproxyconfiguration",
  "com.apple.TCC.configuration-profile-policy": "privacypreferencespolicycontrol",
  "com.apple.airplay.security": "airplaysecurity",
  "com.apple.airplay": "airplay",
  "com.apple.airprint": "airprint",
  "com.apple.apn.managed": "apn",
  "com.apple.app.lock": "applock",
  "com.apple.applicationaccess.new": "parentalcontrolsapplicationrestrictions",
  "com.apple.applicationaccess": "restrictions",
  "com.apple.appstore": "appstore",
  "com.apple.asam": "autonomoussingleappmode",
  "com.apple.associated-domains": "associateddomains",
  "com.apple.caldav.account": "caldav",
  "com.apple.carddav.account": "carddav",
  "com.apple.cellular": "cellular",
  "com.apple.cellularprivatenetwork.managed": "cellularprivatenetwork",
  "com.apple.conferenceroomdisplay": "conferenceroomdisplay",
  "com.apple.configurationprofile.identification": "identification",
  "com.apple.declarations": "declarations",
  "com.apple.desktop": "desktop",
  "com.apple.dnsProxy.managed": "dnsproxy",
  "com.apple.dnsSettings.managed": "dnssettings",
  "com.apple.dock": "dock",
  "com.apple.domains": "domains",
  "com.apple.eas.account": "exchangeactivesync",
  "com.apple.education": "educationconfiguration",
  "com.apple.ews.account": "exchangewebservices",
  "com.apple.familycontrols.contentfilter": "parentalcontrolscontentfilter",
  "com.apple.familycontrols.timelimits.v2": "parentalcontrolstimelimits",
  "com.apple.fileproviderd": "fileprovider",
  "com.apple.finder": "finder",
  "com.apple.firstactiveethernet.managed": "8021xfirstactiveethernet",
  "com.apple.firstethernet.managed": "8021xfirstethernet",
  "com.apple.font": "font",
  "com.apple.gamed": "parentalcontrolsgamecenter",
  "com.apple.globalethernet.managed": "8021xglobalethernet",
  "com.apple.google-oauth": "googleaccount",
  "com.apple.homescreenlayout": "homescreenlayout",
  "com.apple.ironwood.support": "parentalcontroldictationandprofanity",
  "com.apple.ldap.account": "ldap",
  "com.apple.loginitems.managed": "loginitemsmanageditems",
  "com.apple.loginwindow": "loginwindow",
  "com.apple.lom": "lightsoutmanagementlom",
  "com.apple.mail.managed": "mail",
  "com.apple.mcxMenuExtras": "managedmenuextras",
  "com.apple.mcxloginscripts": "loginwindowscripts",
  "com.apple.mcxprinting": "printing",
  "com.apple.mdm": "mdm",
  "com.apple.mobiledevice.passwordpolicy": "passcode",
  "com.apple.networkusagerules": "networkusagerules",
  "com.apple.notificationsettings": "notifications",
  "com.apple.preference.security": "securitypreferences",
  "com.apple.preference.users": "userpreferences",
  "com.apple.profileRemovalPassword": "profileremovalpassword",
  "com.apple.proxy.http.global": "globalhttpproxy",
  "com.apple.relay.managed": "relay",
  "com.apple.screensaver.user": "screensaveruser",
  "com.apple.screensaver": "screensaver",
  "com.apple.secondactiveethernet.managed": "8021xsecondactiveethernet",
  "com.apple.secondethernet.managed": "8021xsecondethernet",
  "com.apple.security.FDERecoveryKeyEscrow": "fderecoverykeyescrow",
  "com.apple.security.FDERecoveryRedirect": "fderecoverykeyredirection",
  "com.apple.security.acme": "acmecertificate",
  "com.apple.security.certificatepreference": "certificatepreference",
  "com.apple.security.certificaterevocation": "certificaterevocation",
  "com.apple.security.certificatetransparency": "certificatetransparency",
  "com.apple.security.firewall": "firewall",
  "com.apple.security.identitypreference": "identitypreference",
  "com.apple.security.pem": "certificatepem",
  "com.apple.security.pkcs1": "certificatepkcs1",
  "com.apple.security.pkcs12": "certificatepkcs12",
  "com.apple.security.root": "certificateroot",
  "com.apple.security.scep": "scep",
  "com.apple.security.smartcard": "smartcard",
  "com.apple.servicemanagement": "servicemanagementmanagedloginitems",
  "com.apple.shareddeviceconfiguration": "lockscreenmessage",
  "com.apple.sso": "singlesignon",
  "com.apple.subscribedcalendar.account": "subscribedcalendars",
  "com.apple.syspolicy.kernel-extension-policy": "systempolicykernelextensions",
  "com.apple.system-extension-policy": "systemextensions",
  "com.apple.system.logging": "systemlogging",
  "com.apple.systemmigration": "systemmigration",
  "com.apple.systempolicy.control": "systempolicycontrol",
  "com.apple.systempolicy.managed": "systempolicymanaged",
  "com.apple.systempolicy.rule": "systempolicyrule",
  "com.apple.systempreferences": "systempreferences",
  "com.apple.systemuiserver": "mediamanagementallowedmedia",
  "com.apple.thirdactiveethernet.managed": "8021xthirdactiveethernet",
  "com.apple.thirdethernet.managed": "8021xthirdethernet",
  "com.apple.tvremote": "tvremote",
  "com.apple.universalaccess": "accessibility",
  "com.apple.vpn.managed.applayer": "applayervpn",
  "com.apple.vpn.managed.appmapping": "apptoapplayervpnmapping",
  "com.apple.vpn.managed": "vpn",
  "com.apple.webClip.managed": "webclip",
  "com.apple.webcontent-filter": "webcontentfilter",
  "com.apple.wifi.managed": "wifi",
  "com.apple.xsan.preferences": "xsanpreferences",
  "com.apple.xsan": "xsan",
  loginwindow: "loginwindowloginitems",
} satisfies Record<string, string>;

/**
 * Payload types that appear more than once in Apple's documentation. The
 * catalogue stores them as separate collections with the same identifier, so
 * the collection name is the only way to pick the right page.
 */
const PROFILE_COLLECTION_SLUGS = {
  "com.apple.MCX": {
    Accounts: "accounts",
    "Energy Saver": "energysaver",
    "FDE FileVault Options": "fdefilevaultoptions",
    "Mobile Accounts": "mobileaccounts",
    "Time Server": "timeserver",
    "Wi-Fi Managed Settings": "wifimanagedsettings",
  },
  "com.apple.extensiblesso": {
    "Extensible Single Sign-On": "extensiblesinglesignon",
    "Extensible Single Sign-On (Kerberos)": "extensiblesinglesignonkerberos",
  },
} satisfies Record<string, Record<string, string>>;

/** DDM declaration types to their page on developer.apple.com. */
const DECLARATION_SLUGS = {
  "com.apple.activation.simple": "activationsimple",
  "com.apple.asset.credential.acme": "assetcredentialacme",
  "com.apple.asset.credential.certificate": "assetcredentialcertificate",
  "com.apple.asset.credential.identity": "assetcredentialidentity",
  "com.apple.asset.credential.scep": "assetcredentialscep",
  "com.apple.asset.credential.userpassword": "assetcredentialusernameandpassword",
  "com.apple.asset.data": "assetdata",
  "com.apple.asset.useridentity": "assetuseridentity",
  "com.apple.configuration.accessibility.settings": "accessibilitysettings",
  "com.apple.configuration.account.caldav": "accountcaldav",
  "com.apple.configuration.account.carddav": "accountcarddav",
  "com.apple.configuration.account.exchange": "accountexchange",
  "com.apple.configuration.account.google": "accountgoogle",
  "com.apple.configuration.account.ldap": "accountldap",
  "com.apple.configuration.account.mail": "accountmail",
  "com.apple.configuration.account.subscribed-calendar": "accountsubscribedcalendar",
  "com.apple.configuration.app.managed": "appmanaged",
  "com.apple.configuration.app.settings": "appsettings",
  "com.apple.configuration.audio-accessory.settings": "audioaccessorysettings",
  "com.apple.configuration.content-cache.settings": "contentcaching",
  "com.apple.configuration.diskmanagement.settings": "diskmanagementsettings",
  "com.apple.configuration.extensible-sso": "extensiblesso",
  "com.apple.configuration.external-intelligence.settings": "externalintelligencesettings",
  "com.apple.configuration.intelligence.settings": "intelligencesettings",
  "com.apple.configuration.keyboard.settings": "keyboardsettings",
  "com.apple.configuration.legacy.interactive": "legacyinteractiveprofile",
  "com.apple.configuration.legacy": "legacyprofile",
  "com.apple.configuration.management.status-subscriptions": "managementstatussubscriptions",
  "com.apple.configuration.management.test": "managementtest",
  "com.apple.configuration.math.settings": "mathsettings",
  "com.apple.configuration.migration-assistant.settings": "migrationassistantsettings",
  "com.apple.configuration.network.dns-proxy": "networkdnsproxy",
  "com.apple.configuration.network.dns-settings": "networkdnssettings",
  "com.apple.configuration.network.relay": "networkrelay",
  "com.apple.configuration.network.vpn.always-on": "networkvpnalwayson",
  "com.apple.configuration.network.vpn.ikev2": "networkvpnikev2",
  "com.apple.configuration.network.vpn.ipsec": "networkvpnipsec",
  "com.apple.configuration.network.vpn.vpn-plugin": "networkvpnvpnplugin",
  "com.apple.configuration.package": "package",
  "com.apple.configuration.passcode.settings": "passcodesettings",
  "com.apple.configuration.safari.bookmarks": "safaribookmarks",
  "com.apple.configuration.safari.extensions.settings": "safariextensionsettings",
  "com.apple.configuration.safari.settings": "safarisettings",
  "com.apple.configuration.screensharing.connection.group": "screensharingconnectiongroup",
  "com.apple.configuration.screensharing.connection": "screensharingconnection",
  "com.apple.configuration.screensharing.host.settings": "screensharinghostsettings",
  "com.apple.configuration.security.certificate": "securitycertificate",
  "com.apple.configuration.security.identity": "securityidentity",
  "com.apple.configuration.security.passkey.attestation": "securitypasskeyattestation",
  "com.apple.configuration.services.background-tasks": "servicesbackgroundtasks",
  "com.apple.configuration.services.configuration-files": "servicesconfigurationfiles",
  "com.apple.configuration.siri.settings": "sirisettings",
  "com.apple.configuration.softwareupdate.enforcement.specific":
    "softwareupdateenforcementspecific",
  "com.apple.configuration.softwareupdate.settings": "softwareupdatesettings",
  "com.apple.configuration.watch.enrollment": "watchenrollment",
  "com.apple.configuration.webcontent-filter.plugin": "webcontentfilterplugin",
  "com.apple.management.organization-info": "managementorganizationinformation",
  "com.apple.management.properties": "managementproperties",
  "com.apple.management.server-capabilities": "managementservercapabilities",
} satisfies Record<string, string>;

const slugFor = <T>(table: Record<string, T>, key: string): T | undefined => table[key];

const appleSlug = (identifier: string, name?: string) => {
  const byName = slugFor(PROFILE_COLLECTION_SLUGS, identifier);

  return (byName ? slugFor(byName, name ?? "") : undefined) ?? slugFor(PROFILE_SLUGS, identifier);
};

/**
 * The developer.apple.com page for a catalogue entry.
 *
 * Unknown and legacy types resolve to the profile or declaration index instead
 * of a guessed slug, so the link is always valid. An unknown kind (a future
 * catalogue surface) lands on the Device Management landing page.
 */
export const appleDocumentationUrl = (
  collection: Pick<Collection, "kind" | "identifier" | "name">,
) => {
  if (collection.kind === "declaration") {
    const slug = slugFor(DECLARATION_SLUGS, collection.identifier);

    return slug ? `${APPLE_DOCS}/${slug}` : APPLE_DECLARATION_DOCS;
  }

  if (collection.kind === "profile") {
    const slug = appleSlug(collection.identifier, collection.name);

    return slug ? `${APPLE_DOCS}/${slug}` : APPLE_PROFILE_DOCS;
  }

  return APPLE_DEVICE_MANAGEMENT_DOCS;
};

/**
 * The page for a raw `PayloadType` value, used when a mobileconfig is previewed
 * outside the catalogue (uploaded profiles). Unknown types link to the payload
 * index for the same reason as above.
 */
export const applePayloadDocumentationUrl = (payloadType: string | undefined) => {
  const slug = payloadType ? slugFor(PROFILE_SLUGS, payloadType) : undefined;

  return slug ? `${APPLE_DOCS}/${slug}` : APPLE_PROFILE_DOCS;
};

const safeHttpsUrl = (value: string | undefined) => {
  if (!value) return undefined;

  try {
    const url = new URL(value);

    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

/**
 * A Windows setting's documentation URL. Properties without their own source
 * fall back to the collection's CSP reference page, and then to Microsoft's
 * Policy CSP index, so the link never points at an empty or invalid URL.
 */
export const windowsPropertyDocumentationUrl = (
  collectionSource: string | undefined,
  propertySource: string | undefined,
) => safeHttpsUrl(propertySource) ?? safeHttpsUrl(collectionSource) ?? WINDOWS_CSP_DOCS;

/** A Windows collection's documentation URL (always the CSP reference today). */
export const windowsCollectionDocumentationUrl = (collectionSource: string | undefined) =>
  safeHttpsUrl(collectionSource) ?? WINDOWS_CSP_DOCS;

/** The documentation URL to show alongside a catalogue entry, or undefined. */
export const collectionDocumentationUrl = (
  platform: PlatformId,
  collection: Pick<Collection, "kind" | "identifier" | "name" | "source">,
): string | undefined => {
  if (platform === "apple") return appleDocumentationUrl(collection);

  if (platform === "windows") return windowsCollectionDocumentationUrl(collection.source);

  return undefined;
};

/** The documentation URL for a setting being edited, or undefined. */
export const propertyDocumentationUrl = (
  platform: PlatformId,
  property: Pick<Property, "source">,
  collectionSource: string | undefined,
): string | undefined => {
  if (platform === "windows")
    return windowsPropertyDocumentationUrl(collectionSource, property.source);

  return undefined;
};
