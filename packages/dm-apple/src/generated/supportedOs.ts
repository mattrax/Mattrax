// Auto-generated from https://github.com/apple/device-management
// Do not edit manually. Regenerate with `pnpm exec tsx packages/dm-apple/scripts/generate-schemas.ts`.

/**
 * Per-OS version support for an Apple payload or declaration type, taken from
 * the schema's `supportedOS` block. An OS the payload does not support is
 * absent rather than mapped to a version.
 */
export type AppleSupportedOs = Partial<
  Record<
    "iOS" | "iPadOS" | "macOS" | "tvOS" | "visionOS" | "watchOS",
    { readonly introduced: string; readonly deprecated?: string; readonly removed?: string }
  >
>;

/** Keyed by `payloadtype` for profiles and `declarationtype` for declarations. */
export const APPLE_SUPPORTED_OS: Readonly<Record<string, AppleSupportedOs>> = {
  ".GlobalPreferences": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.ADCertificate.managed": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.AIM.account": {
    macOS: { introduced: "10.7", deprecated: "10.13", removed: "10.14" },
  },
  "com.apple.airplay": {
    iOS: { introduced: "7.0" },
    macOS: { introduced: "10.10" },
  },
  "com.apple.airplay.security": {
    tvOS: { introduced: "11.0" },
  },
  "com.apple.airprint": {
    iOS: { introduced: "7.0" },
    macOS: { introduced: "10.10" },
    visionOS: { introduced: "2.0" },
  },
  "com.apple.apn.managed": {
    iOS: { introduced: "4.0", deprecated: "7.0" },
  },
  "com.apple.app.lock": {
    iOS: { introduced: "6.0" },
    tvOS: { introduced: "10.2" },
  },
  "com.apple.applicationaccess": {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
    tvOS: { introduced: "9.0" },
    visionOS: { introduced: "1.1" },
    watchOS: { introduced: "10.0" },
  },
  "com.apple.applicationaccess.new": {
    macOS: { introduced: "10.7", deprecated: "27.0" },
  },
  "com.apple.appstore": {
    macOS: { introduced: "10.9" },
  },
  "com.apple.asam": {
    macOS: { introduced: "10.13.4" },
  },
  "com.apple.AssetCache.managed": {
    macOS: { introduced: "10.13.4", deprecated: "27.0" },
  },
  "com.apple.associated-domains": {
    macOS: { introduced: "10.15" },
  },
  "com.apple.caldav.account": {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.carddav.account": {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.cellular": {
    iOS: { introduced: "7.0" },
    watchOS: { introduced: "3.2" },
  },
  "com.apple.cellularprivatenetwork.managed": {
    iOS: { introduced: "17.0" },
  },
  "com.apple.conferenceroomdisplay": {
    tvOS: { introduced: "10.2" },
  },
  "com.apple.configuration.accessibility.settings": {
    iOS: { introduced: "27.0" },
    macOS: { introduced: "27.0" },
    visionOS: { introduced: "27.0" },
  },
  "com.apple.configuration.account.caldav": {
    iOS: { introduced: "15.0" },
    macOS: { introduced: "13.0" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.configuration.account.carddav": {
    iOS: { introduced: "15.0" },
    macOS: { introduced: "13.0" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.configuration.account.exchange": {
    iOS: { introduced: "15.0" },
    macOS: { introduced: "13.0" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.configuration.account.google": {
    iOS: { introduced: "15.0" },
    macOS: { introduced: "13.0" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.configuration.account.ldap": {
    iOS: { introduced: "15.0" },
    macOS: { introduced: "13.0" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.configuration.account.mail": {
    iOS: { introduced: "15.0" },
    macOS: { introduced: "13.0" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.configuration.account.settings": {
    macOS: { introduced: "27.2" },
  },
  "com.apple.configuration.account.subscribed-calendar": {
    iOS: { introduced: "15.0" },
    macOS: { introduced: "14.0" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.configuration.app.managed": {
    iOS: { introduced: "17.2" },
    macOS: { introduced: "26.0" },
    visionOS: { introduced: "2.4" },
  },
  "com.apple.configuration.app.settings": {
    iOS: { introduced: "27.0" },
    macOS: { introduced: "27.0" },
    tvOS: { introduced: "27.0" },
    visionOS: { introduced: "27.0" },
  },
  "com.apple.configuration.audio-accessory.settings": {
    iOS: { introduced: "26.0" },
  },
  "com.apple.configuration.content-cache.settings": {
    macOS: { introduced: "27.0" },
  },
  "com.apple.configuration.diskmanagement.settings": {
    macOS: { introduced: "15.0" },
  },
  "com.apple.configuration.extensible-sso": {
    iOS: { introduced: "27.0" },
    macOS: { introduced: "27.0" },
    visionOS: { introduced: "27.0" },
  },
  "com.apple.configuration.external-intelligence.settings": {
    iOS: { introduced: "26.4" },
    macOS: { introduced: "26.4" },
    visionOS: { introduced: "26.4" },
  },
  "com.apple.configuration.intelligence.settings": {
    iOS: { introduced: "26.4" },
    macOS: { introduced: "26.4" },
    visionOS: { introduced: "26.4" },
  },
  "com.apple.configuration.keyboard.settings": {
    iOS: { introduced: "26.4" },
    macOS: { introduced: "26.4" },
  },
  "com.apple.configuration.legacy": {
    iOS: { introduced: "15.0" },
    macOS: { introduced: "13.0" },
    tvOS: { introduced: "16.0" },
    visionOS: { introduced: "1.1" },
    watchOS: { introduced: "10.0" },
  },
  "com.apple.configuration.legacy.interactive": {
    iOS: { introduced: "15.0" },
    macOS: { introduced: "13.0" },
    tvOS: { introduced: "16.0" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.configuration.management.status-subscriptions": {
    iOS: { introduced: "15.0" },
    macOS: { introduced: "13.0" },
    tvOS: { introduced: "16.0" },
    visionOS: { introduced: "1.1" },
    watchOS: { introduced: "10.0" },
  },
  "com.apple.configuration.management.test": {
    iOS: { introduced: "15.0" },
    macOS: { introduced: "13.0" },
    tvOS: { introduced: "16.0" },
    visionOS: { introduced: "1.1" },
    watchOS: { introduced: "10.0" },
  },
  "com.apple.configuration.math.settings": {
    iOS: { introduced: "18.0" },
    macOS: { introduced: "15.0" },
  },
  "com.apple.configuration.migration-assistant.settings": {
    macOS: { introduced: "26.4" },
  },
  "com.apple.configuration.network.dns-proxy": {
    iOS: { introduced: "27.0" },
    macOS: { introduced: "27.0" },
    visionOS: { introduced: "27.0" },
  },
  "com.apple.configuration.network.dns-settings": {
    iOS: { introduced: "27.0" },
    macOS: { introduced: "27.0" },
    visionOS: { introduced: "27.0" },
  },
  "com.apple.configuration.network.relay": {
    iOS: { introduced: "27.0" },
    macOS: { introduced: "27.0" },
    visionOS: { introduced: "27.0" },
  },
  "com.apple.configuration.network.vpn.always-on": {
    iOS: { introduced: "27.0" },
    visionOS: { introduced: "27.0" },
  },
  "com.apple.configuration.network.vpn.ikev2": {
    iOS: { introduced: "27.0" },
    macOS: { introduced: "27.0" },
    tvOS: { introduced: "27.0" },
    visionOS: { introduced: "27.0" },
  },
  "com.apple.configuration.network.vpn.ipsec": {
    iOS: { introduced: "27.0" },
    macOS: { introduced: "27.0" },
    visionOS: { introduced: "27.0" },
  },
  "com.apple.configuration.network.vpn.vpn-plugin": {
    iOS: { introduced: "27.0" },
    macOS: { introduced: "27.0" },
    tvOS: { introduced: "27.0" },
    visionOS: { introduced: "27.0" },
  },
  "com.apple.configuration.package": {
    macOS: { introduced: "26.0" },
  },
  "com.apple.configuration.passcode.settings": {
    iOS: { introduced: "15.0" },
    macOS: { introduced: "13.0" },
    visionOS: { introduced: "2.0" },
    watchOS: { introduced: "10.0" },
  },
  "com.apple.configuration.safari.bookmarks": {
    iOS: { introduced: "26.0" },
    macOS: { introduced: "26.0" },
    visionOS: { introduced: "26.0" },
  },
  "com.apple.configuration.safari.extensions.settings": {
    iOS: { introduced: "18.0" },
    macOS: { introduced: "15.0" },
    visionOS: { introduced: "26.0" },
  },
  "com.apple.configuration.safari.settings": {
    iOS: { introduced: "26.0" },
    macOS: { introduced: "26.0" },
    visionOS: { introduced: "26.0" },
  },
  "com.apple.configuration.screensharing.connection": {
    macOS: { introduced: "14.0" },
  },
  "com.apple.configuration.screensharing.connection.group": {
    macOS: { introduced: "14.0" },
  },
  "com.apple.configuration.screensharing.host.settings": {
    macOS: { introduced: "14.0" },
  },
  "com.apple.configuration.security.certificate": {
    iOS: { introduced: "17.0" },
    macOS: { introduced: "14.0" },
    tvOS: { introduced: "17.0" },
    visionOS: { introduced: "1.1" },
    watchOS: { introduced: "10.0" },
  },
  "com.apple.configuration.security.identity": {
    iOS: { introduced: "17.0" },
    macOS: { introduced: "14.0" },
    tvOS: { introduced: "17.0" },
    visionOS: { introduced: "1.1" },
    watchOS: { introduced: "10.0" },
  },
  "com.apple.configuration.security.passkey.attestation": {
    iOS: { introduced: "17.0" },
    macOS: { introduced: "14.0" },
  },
  "com.apple.configuration.services.background-tasks": {
    macOS: { introduced: "15.0" },
  },
  "com.apple.configuration.services.configuration-files": {
    macOS: { introduced: "14.0" },
  },
  "com.apple.configuration.siri.settings": {
    iOS: { introduced: "26.4" },
    macOS: { introduced: "26.4" },
    tvOS: { introduced: "27.0" },
    visionOS: { introduced: "26.4" },
    watchOS: { introduced: "26.4" },
  },
  "com.apple.configuration.softwareupdate.enforcement.specific": {
    iOS: { introduced: "17.0" },
    macOS: { introduced: "14.0" },
    tvOS: { introduced: "18.4" },
    visionOS: { introduced: "26.0" },
  },
  "com.apple.configuration.softwareupdate.settings": {
    iOS: { introduced: "18.0" },
    macOS: { introduced: "15.0" },
    tvOS: { introduced: "18.4" },
    visionOS: { introduced: "26.0" },
  },
  "com.apple.configuration.watch.enrollment": {
    iOS: { introduced: "17.0" },
  },
  "com.apple.configuration.webcontent-filter.plugin": {
    iOS: { introduced: "27.0" },
    macOS: { introduced: "27.0" },
    visionOS: { introduced: "27.0" },
  },
  "com.apple.configurationprofile.identification": {
    macOS: { introduced: "10.7", deprecated: "15.4" },
  },
  "com.apple.dashboard": {
    macOS: { introduced: "10.7", deprecated: "10.15", removed: "10.15" },
  },
  "com.apple.declarations": {
    iOS: { introduced: "17.0" },
    macOS: { introduced: "14.0" },
    tvOS: { introduced: "17.0" },
    visionOS: { introduced: "1.0" },
    watchOS: { introduced: "10.0" },
  },
  "com.apple.desktop": {
    macOS: { introduced: "10.10" },
  },
  "com.apple.Dictionary": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.DirectoryService.managed": {
    macOS: { introduced: "10.8" },
  },
  "com.apple.DiscRecording": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.dnsProxy.managed": {
    iOS: { introduced: "11.0", deprecated: "27.0" },
    macOS: { introduced: "10.15", deprecated: "27.0" },
    visionOS: { introduced: "1.1", deprecated: "27.0" },
  },
  "com.apple.dnsSettings.managed": {
    iOS: { introduced: "14.0", deprecated: "27.0" },
    macOS: { introduced: "11.0", deprecated: "27.0" },
    visionOS: { introduced: "1.0", deprecated: "27.0" },
  },
  "com.apple.dock": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.domains": {
    iOS: { introduced: "8.0" },
    macOS: { introduced: "10.10" },
    visionOS: { introduced: "2.0" },
  },
  "com.apple.eas.account": {
    iOS: { introduced: "4.0" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.education": {
    iOS: { introduced: "9.3" },
    macOS: { introduced: "10.14" },
  },
  "com.apple.ews.account": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.extensiblesso": {
    iOS: { introduced: "13.0" },
    macOS: { introduced: "10.15" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.familycontrols.contentfilter": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.familycontrols.timelimits.v2": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.fileproviderd": {
    macOS: { introduced: "11.0" },
  },
  "com.apple.finder": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.firstactiveethernet.managed": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.firstethernet.managed": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.font": {
    iOS: { introduced: "7.0" },
    macOS: { introduced: "10.9" },
    visionOS: { introduced: "2.0" },
  },
  "com.apple.gamed": {
    macOS: { introduced: "10.9" },
  },
  "com.apple.globalethernet.managed": {
    iOS: { introduced: "17.0" },
    macOS: { introduced: "10.13" },
    tvOS: { introduced: "17.0" },
  },
  "com.apple.google-oauth": {
    iOS: { introduced: "9.3" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.homescreenlayout": {
    iOS: { introduced: "9.3" },
    tvOS: { introduced: "11.0" },
  },
  "com.apple.ironwood.support": {
    macOS: { introduced: "10.9", deprecated: "10.13" },
  },
  "com.apple.jabber.account": {
    macOS: { introduced: "10.7", deprecated: "10.14", removed: "10.14" },
  },
  "com.apple.ldap.account": {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.loginitems.managed": {
    macOS: { introduced: "10.13" },
  },
  "com.apple.loginwindow": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.lom": {
    macOS: { introduced: "11.0" },
  },
  "com.apple.mail.managed": {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.ManagedClient.preferences": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.MCX": {
    macOS: { introduced: "10.9" },
  },
  "com.apple.MCX.FileVault2": {
    macOS: { introduced: "10.9" },
  },
  "com.apple.MCX.TimeMachine": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.mcxloginscripts": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.mcxMenuExtras": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.mcxprinting": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.mdm": {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
    tvOS: { introduced: "9.0" },
    visionOS: { introduced: "1.1" },
    watchOS: { introduced: "10.0" },
  },
  "com.apple.mobiledevice.passwordpolicy": {
    iOS: { introduced: "4.0", deprecated: "27.0" },
    macOS: { introduced: "10.7", deprecated: "27.0" },
    visionOS: { introduced: "2.0", deprecated: "27.0" },
    watchOS: { introduced: "10.0", deprecated: "27.0" },
  },
  "com.apple.networkusagerules": {
    iOS: { introduced: "9.0" },
  },
  "com.apple.notificationsettings": {
    iOS: { introduced: "9.3" },
    macOS: { introduced: "10.15" },
  },
  "com.apple.NSExtension": {
    macOS: { introduced: "10.13" },
  },
  "com.apple.osxserver.account": {
    iOS: { introduced: "9.0", deprecated: "12.0", removed: "12.0" },
  },
  "com.apple.preference.security": {
    macOS: { introduced: "10.10" },
  },
  "com.apple.preference.users": {
    macOS: { introduced: "10.12" },
  },
  "com.apple.profileRemovalPassword": {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
    tvOS: { introduced: "9.0" },
  },
  "com.apple.proxy.http.global": {
    iOS: { introduced: "6.0" },
    macOS: { introduced: "10.9" },
    tvOS: { introduced: "9.0" },
    visionOS: { introduced: "2.0" },
  },
  "com.apple.relay.managed": {
    iOS: { introduced: "17.0", deprecated: "27.0" },
    macOS: { introduced: "14.0", deprecated: "27.0" },
    tvOS: { introduced: "17.0" },
    visionOS: { introduced: "1.0", deprecated: "27.0" },
  },
  "com.apple.screensaver": {
    macOS: { introduced: "10.11" },
  },
  "com.apple.screensaver.user": {
    macOS: { introduced: "10.11" },
  },
  "com.apple.secondactiveethernet.managed": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.secondethernet.managed": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.security.acme": {
    iOS: { introduced: "16.0" },
    macOS: { introduced: "13.1" },
    tvOS: { introduced: "16.0" },
    visionOS: { introduced: "1.0" },
    watchOS: { introduced: "9.0" },
  },
  "com.apple.security.certificatepreference": {
    macOS: { introduced: "10.12" },
  },
  "com.apple.security.certificaterevocation": {
    iOS: { introduced: "14.2" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.security.certificatetransparency": {
    iOS: { introduced: "12.1.1" },
    macOS: { introduced: "10.14.2" },
    tvOS: { introduced: "12.1.1" },
    visionOS: { introduced: "1.0" },
    watchOS: { introduced: "5.1.1" },
  },
  "com.apple.security.FDERecoveryKeyEscrow": {
    macOS: { introduced: "10.13" },
  },
  "com.apple.security.FDERecoveryRedirect": {
    macOS: { introduced: "10.9", deprecated: "10.13" },
  },
  "com.apple.security.firewall": {
    macOS: { introduced: "10.12" },
  },
  "com.apple.security.identitypreference": {
    macOS: { introduced: "10.12" },
  },
  "com.apple.security.pem": {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
    tvOS: { introduced: "9.0" },
    visionOS: { introduced: "1.0" },
    watchOS: { introduced: "3.0" },
  },
  "com.apple.security.pkcs1": {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
    tvOS: { introduced: "9.0" },
    visionOS: { introduced: "1.0" },
    watchOS: { introduced: "3.0" },
  },
  "com.apple.security.pkcs12": {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
    tvOS: { introduced: "9.0" },
    visionOS: { introduced: "1.0" },
    watchOS: { introduced: "3.0" },
  },
  "com.apple.security.root": {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
    tvOS: { introduced: "9.0" },
    visionOS: { introduced: "1.0" },
    watchOS: { introduced: "3.0" },
  },
  "com.apple.security.scep": {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
    tvOS: { introduced: "9.0" },
    visionOS: { introduced: "1.0" },
    watchOS: { introduced: "3.0" },
  },
  "com.apple.security.smartcard": {
    macOS: { introduced: "10.12.4" },
  },
  "com.apple.servicemanagement": {
    macOS: { introduced: "13.0" },
  },
  "com.apple.SetupAssistant.managed": {
    iOS: { introduced: "14.0" },
    macOS: { introduced: "10.12" },
  },
  "com.apple.shareddeviceconfiguration": {
    iOS: { introduced: "9.3" },
  },
  "com.apple.ShareKitHelper": {
    macOS: { introduced: "10.9", deprecated: "10.12" },
  },
  "com.apple.SoftwareUpdate": {
    macOS: { introduced: "10.7", deprecated: "26.0", removed: "27.0" },
  },
  "com.apple.sso": {
    iOS: { introduced: "7.0", deprecated: "26.0" },
  },
  "com.apple.subscribedcalendar.account": {
    iOS: { introduced: "4.0" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.syspolicy.kernel-extension-policy": {
    macOS: { introduced: "10.13.2" },
  },
  "com.apple.system-extension-policy": {
    macOS: { introduced: "10.15" },
  },
  "com.apple.system.logging": {
    macOS: { introduced: "10.12" },
  },
  "com.apple.SystemConfiguration": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.systemmigration": {
    macOS: { introduced: "10.12.4" },
  },
  "com.apple.systempolicy.control": {
    macOS: { introduced: "10.8" },
  },
  "com.apple.systempolicy.managed": {
    macOS: { introduced: "10.8" },
  },
  "com.apple.systempolicy.rule": {
    macOS: { introduced: "10.8" },
  },
  "com.apple.systempreferences": {
    macOS: { introduced: "10.7", deprecated: "13.0" },
  },
  "com.apple.systemuiserver": {
    macOS: { introduced: "10.7", deprecated: "11.0" },
  },
  "com.apple.TCC.configuration-profile-policy": {
    macOS: { introduced: "10.14" },
  },
  "com.apple.thirdactiveethernet.managed": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.thirdethernet.managed": {
    macOS: { introduced: "10.7" },
  },
  "com.apple.tvremote": {
    iOS: { introduced: "11.3" },
    tvOS: { introduced: "11.3" },
  },
  "com.apple.universalaccess": {
    macOS: { introduced: "10.9" },
  },
  "com.apple.vpn.managed": {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
    tvOS: { introduced: "17.0" },
    visionOS: { introduced: "1.0" },
  },
  "com.apple.vpn.managed.applayer": {
    iOS: { introduced: "7.0" },
    macOS: { introduced: "10.9" },
    visionOS: { introduced: "1.1" },
    watchOS: { introduced: "10.0" },
  },
  "com.apple.vpn.managed.appmapping": {
    macOS: { introduced: "10.9" },
  },
  "com.apple.webClip.managed": {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
  },
  "com.apple.webcontent-filter": {
    iOS: { introduced: "7.0" },
    macOS: { introduced: "10.15" },
    visionOS: { introduced: "1.1" },
  },
  "com.apple.wifi.managed": {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
    tvOS: { introduced: "9.0" },
    visionOS: { introduced: "1.0" },
    watchOS: { introduced: "3.2" },
  },
  "com.apple.xsan": {
    macOS: { introduced: "10.10" },
  },
  "com.apple.xsan.preferences": {
    macOS: { introduced: "10.11" },
  },
  CommonPayloadKeys: {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
    tvOS: { introduced: "9.0" },
    visionOS: { introduced: "1.0" },
    watchOS: { introduced: "1.0" },
  },
  loginwindow: {
    macOS: { introduced: "10.7" },
  },
  TopLevel: {
    iOS: { introduced: "4.0" },
    macOS: { introduced: "10.7" },
    tvOS: { introduced: "9.0" },
    visionOS: { introduced: "1.0" },
    watchOS: { introduced: "1.0" },
  },
};

/**
 * OS versions that first support the Declarative Management engine
 * (`DeclarativeManagement` command). A device below these versions cannot apply
 * a declaration, so policy delivery must use legacy profiles instead.
 */
export const APPLE_DECLARATIVE_PROTOCOL_SUPPORT: AppleSupportedOs = {
  iOS: { introduced: "15.0" },
  macOS: { introduced: "13.0" },
  tvOS: { introduced: "16.0" },
  visionOS: { introduced: "1.1" },
  watchOS: { introduced: "10.0" },
};
