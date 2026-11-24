import type { CatalogueDeployment, CatalogueTitle } from "./schema.js";

/**
 * The curated catalogue.
 *
 * Rules for entries:
 *
 * - Identifiers are verified (Apple ids through the public lookup API, Microsoft
 *   Store ids through the listing, Android package names from Play).
 * - A direct URL is only present when the vendor publishes a stable,
 *   unauthenticated download for it. Versioned URLs (Adobe Reader, Slack MSI,
 *   Blender MSI) are deliberately absent; their method points at the vendor page
 *   and says an administrator must supply the package.
 * - The catalogue never carries a SHA-256 or version. A vendor "latest" URL has
 *   neither, and a versioned URL would go stale the day it was written.
 */

const appStore = (
  target: "macos" | "ios" | "ipados" | "tvos" | "visionos",
  storeId: string,
  bundleId: string,
  note?: string,
): CatalogueDeployment => ({
  id: `${target}-app-store`,
  platform: "apple",
  target,
  kind: "apple-app-store",
  storeId,
  bundleId,
  note:
    note ??
    "Deployed through InstallApplication. Apps and Books licensing is used when a VPP token is configured.",
});

const applePkg = (url: string, bundleId: string, note?: string): CatalogueDeployment => ({
  id: "macos-pkg",
  platform: "apple",
  target: "macos",
  kind: "apple-pkg",
  url,
  bundleId,
  note:
    note ??
    "Vendor PKG installed with InstallEnterpriseApplication. Mattrax does not hash-verify a vendor URL; the vendor controls the bytes and the version.",
});

const appleUpload = (bundleId: string, url: string, note: string): CatalogueDeployment => ({
  id: "macos-upload",
  platform: "apple",
  target: "macos",
  kind: "apple-upload",
  url,
  bundleId,
  note,
});

const windowsMsi = (
  url: string,
  note = "MSI installed through EnterpriseDesktopAppManagement. Enter the ProductCode from the signed MSI; Google, Mozilla and others rotate it with the package.",
): CatalogueDeployment => ({
  id: "windows-msi",
  platform: "win",
  target: "windows",
  kind: "windows-msi",
  url,
  requiresProductCode: true,
  note,
});

const windowsStore = (microsoftStoreId: string, note?: string): CatalogueDeployment => ({
  id: "windows-store",
  platform: "win",
  target: "windows",
  kind: "windows-store",
  microsoftStoreId,
  note:
    note ??
    "Microsoft Store/MSIX delivery is not wired into the Windows MDM path yet (#568). The listing is recorded so the title can be added without re-research.",
});

const windowsExe = (url: string, note?: string): CatalogueDeployment => ({
  id: "windows-exe",
  platform: "win",
  target: "windows",
  kind: "windows-exe",
  url,
  note:
    note ??
    "The vendor ships an EXE, which needs the Win32 app path (mattraxd install commands) tracked in #568. It cannot be installed over OMA-DM.",
});

const windowsMsix = (url: string, note?: string): CatalogueDeployment => ({
  id: "windows-msix",
  platform: "win",
  target: "windows",
  kind: "windows-msix",
  url,
  note:
    note ??
    "MSIX delivery through EnterpriseModernAppManagement is tracked in #568; the file is recorded so packaging work does not start from scratch.",
});

const vendorDownload = (
  target: "macos" | "windows" | "ios" | "ipados" | "android",
  platform: "apple" | "win" | "android",
  url: string,
  note: string,
): CatalogueDeployment => ({
  id: `${target}-vendor-download`,
  platform,
  target,
  kind: "vendor-download",
  url,
  note,
});

const play = (packageName: string, note?: string): CatalogueDeployment => ({
  id: "android-play",
  platform: "android",
  target: "android",
  kind: "android-play",
  packageName,
  note:
    note ??
    "Assigned through Managed Google Play. The package must be approved for the enterprise in the Google Admin console.",
});

const iosStore = (storeId: string, bundleId: string): CatalogueDeployment => ({
  ...appStore("ios", storeId, bundleId),
  id: "ios-app-store",
});

const iosPlay = (storeId: string, bundleId: string, packageName: string) => [
  iosStore(storeId, bundleId),
  play(packageName),
];

const microsoftMobile = (appleId: string, appleBundleId: string, androidPackage: string) =>
  iosPlay(appleId, appleBundleId, androidPackage);

const googleMobile = (appleId: string, appleBundleId: string, androidPackage: string) =>
  iosPlay(appleId, appleBundleId, androidPackage);

export const CATALOGUE_TITLES: ReadonlyArray<CatalogueTitle> = [
  {
    id: "google-chrome",
    name: "Google Chrome",
    vendor: "Google",
    description:
      "Google's browser. The enterprise MSI/PKG builds support managed policies; the consumer DMG does not install as a managed Mac app without repackaging.",
    category: "browsers",
    aliases: ["chrome", "google browser"],
    website: "https://www.google.com/chrome/",
    platforms: ["macos", "windows", "ios", "ipados", "android"],
    popularity: 100,
    notes:
      "Google publishes a signed PKG for enterprise deployment separately from the consumer download. If you use the DMG, repackage and sign it before upload.",
    deployments: [
      appleUpload(
        "com.google.Chrome",
        "https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg",
        "Google ships a universal DMG. Repackage it as a signed PKG, then upload the PKG to this entry. The DMG itself is not installable by the Apple MDM channel.",
      ),
      windowsMsi("https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi"),
      appStore("ios", "535886823", "com.google.chrome.ios"),
      play("com.android.chrome"),
    ],
  },
  {
    id: "microsoft-edge",
    name: "Microsoft Edge",
    vendor: "Microsoft",
    description:
      "Chromium-based browser with enterprise policy support. Microsoft publishes stable PKG and MSI links that follow the current release channel.",
    category: "browsers",
    aliases: ["edge", "ms edge"],
    website: "https://www.microsoft.com/edge",
    platforms: ["macos", "windows", "ios", "ipados", "android"],
    popularity: 92,
    deployments: [
      applePkg(
        "https://go.microsoft.com/fwlink/?linkid=2093504",
        "com.microsoft.edgemac",
        "The fwlink resolves to Microsoft's current Edge PKG. It is not version-pinned.",
      ),
      windowsMsi("https://go.microsoft.com/fwlink/?linkid=2093437"),
      windowsStore("XPFFTQ037JWMHS"),
      appStore("ios", "1288723196", "com.microsoft.msedge"),
      play("com.microsoft.emmx"),
    ],
  },
  {
    id: "mozilla-firefox",
    name: "Mozilla Firefox",
    vendor: "Mozilla",
    description:
      "Mozilla's browser. Firefox publishes a signed macOS PKG and a Windows MSI, both following the current release channel.",
    category: "browsers",
    aliases: ["firefox", "mozilla"],
    website: "https://www.mozilla.org/firefox/",
    platforms: ["macos", "windows", "ios", "ipados", "android"],
    popularity: 80,
    deployments: [
      applePkg(
        "https://download.mozilla.org/?product=firefox-pkg-latest-ssl&os=osx&lang=en-US",
        "org.mozilla.firefox",
        "Mozilla's signed PKG redirect follows the current Firefox release. The URL is not version-pinned.",
      ),
      windowsMsi(
        "https://download.mozilla.org/?product=firefox-msi-latest-ssl&os=win64&lang=en-US",
        "This redirect resolves to the current MSI. Read its ProductCode after download.",
      ),
      windowsStore("9NZVDKPMR9RD"),
      appStore("ios", "989804926", "org.mozilla.ios.Firefox"),
      play("org.mozilla.firefox"),
    ],
  },
  {
    id: "brave-browser",
    name: "Brave",
    vendor: "Brave Software",
    description:
      "Privacy-focused Chromium browser. Consumer downloads are DMG/EXE only, so managed macOS installs need repackaging.",
    category: "browsers",
    aliases: ["brave", "brave browser"],
    website: "https://brave.com/download/",
    platforms: ["macos", "windows", "ios", "ipados", "android"],
    popularity: 58,
    deployments: [
      appleUpload(
        "com.brave.Browser",
        "https://brave.com/download/",
        "Download the universal DMG and repackage it as a signed PKG before upload.",
      ),
      windowsExe("https://brave.com/download/"),
      appStore("ios", "1052879175", "com.brave.ios.browser"),
      play("com.brave.browser"),
    ],
  },
  {
    id: "slack",
    name: "Slack",
    vendor: "Salesforce",
    description:
      "Team messaging and collaboration. Slack's desktop MSI is released per version; the Microsoft Store listing is the simplest Windows route once Store delivery lands.",
    category: "communication",
    aliases: ["slack", "slack app"],
    website: "https://slack.com/",
    platforms: ["macos", "windows", "ios", "ipados", "android", "web"],
    popularity: 96,
    deployments: [
      appStore("macos", "803453959", "com.tinyspeck.slackmacgap"),
      appleUpload(
        "com.tinyspeck.slackmacgap",
        "https://slack.com/downloads/mac",
        "The App Store build is the simplest managed macOS route. This DMG alternative must be repackaged as a signed PKG before upload; Slack's enterprise MSI is Windows-only.",
      ),
      windowsStore("9WZDNCRDK3WP"),
      windowsExe(
        "https://slack.com/downloads/windows",
        "Slack publishes an enterprise MSI per release. Supply the MSI URL and ProductCode once Win32/MSI packaging is available (#568/#589).",
      ),
      ...iosPlay("618783545", "com.tinyspeck.chatlyio", "com.Slack"),
    ],
  },
  {
    id: "microsoft-teams",
    name: "Microsoft Teams",
    vendor: "Microsoft",
    description:
      "Chat, meetings and calling. Microsoft publishes a managed macOS PKG for the new Teams client; Windows uses the MSIX/Store package.",
    category: "communication",
    aliases: ["teams", "ms teams"],
    website: "https://www.microsoft.com/microsoft-teams/",
    platforms: ["macos", "windows", "ios", "ipados", "android", "web"],
    popularity: 95,
    deployments: [
      applePkg(
        "https://go.microsoft.com/fwlink/?linkid=2249065",
        "com.microsoft.teams2",
        "Microsoft's fwlink resolves to the current new Teams PKG. It installs the Teams 2 client, not classic Teams.",
      ),
      windowsStore("XP8BT8DW290MPQ"),
      windowsMsix(
        "https://go.microsoft.com/fwlink/?linkid=2196106",
        "Microsoft ships Teams as an MSIX bootstrapper. MSIX delivery is part of #568.",
      ),
      ...iosPlay("1113153706", "com.microsoft.skype.teams", "com.microsoft.teams"),
    ],
  },
  {
    id: "zoom-workplace",
    name: "Zoom Workplace",
    vendor: "Zoom Communications",
    description:
      "Video meetings and workplace chat. Zoom publishes stable latest-channel PKG and MSI links.",
    category: "communication",
    aliases: ["zoom", "zoom meetings"],
    website: "https://zoom.us/",
    platforms: ["macos", "windows", "ios", "ipados", "android", "web"],
    popularity: 94,
    deployments: [
      applePkg(
        "https://zoom.us/client/latest/Zoom.pkg",
        "us.zoom.xos",
        "The latest-channel PKG. The URL is not version-pinned, so an install picks up whatever Zoom currently publishes.",
      ),
      windowsMsi("https://zoom.us/client/latest/ZoomInstallerFull.msi"),
      ...iosPlay("546505307", "us.zoom.videomeetings", "us.zoom.videomeetings"),
    ],
  },
  {
    id: "discord",
    name: "Discord",
    vendor: "Discord",
    description:
      "Voice, video and text chat used by communities and some support teams. Desktop builds are DMG/EXE only.",
    category: "communication",
    aliases: ["discord"],
    website: "https://discord.com/",
    platforms: ["macos", "windows", "ios", "ipados", "android", "web"],
    popularity: 55,
    deployments: [
      appleUpload(
        "com.hammerandchisel.discord",
        "https://discord.com/api/download?platform=osx",
        "The redirect returns a DMG. Repackage it as a signed PKG before upload.",
      ),
      windowsExe("https://discord.com/api/download?platform=win"),
      ...iosPlay("985746746", "com.hammerandchisel.discord", "com.discord"),
    ],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    vendor: "Meta",
    description:
      "End-to-end encrypted messaging. WhatsApp's Mac app is a direct download; Windows uses the Microsoft Store listing.",
    category: "communication",
    aliases: ["whatsapp", "whats app"],
    website: "https://www.whatsapp.com/download",
    platforms: ["macos", "windows", "ios", "ipados", "android", "web"],
    popularity: 74,
    deployments: [
      vendorDownload(
        "macos",
        "apple",
        "https://www.whatsapp.com/download",
        "WhatsApp publishes the macOS build directly. It is not a signed PKG, so it needs repackaging before the Apple MDM path can install it.",
      ),
      windowsStore("9NKSQGP7F2NH"),
      ...iosPlay("310633997", "net.whatsapp.WhatsApp", "com.whatsapp"),
    ],
  },
  {
    id: "signal",
    name: "Signal",
    vendor: "Signal Messenger",
    description:
      "End-to-end encrypted messaging and calling. Desktop builds are DMG/EXE only; mobile apps are on the public stores.",
    category: "communication",
    aliases: ["signal", "signal messenger"],
    website: "https://signal.org/download/",
    platforms: ["macos", "windows", "ios", "ipados", "android"],
    popularity: 60,
    deployments: [
      appleUpload(
        "org.whispersystems.signal-desktop",
        "https://signal.org/download/",
        "Download the universal DMG and repackage it as a signed PKG before upload.",
      ),
      windowsExe("https://signal.org/download/windows/"),
      ...iosPlay("874139669", "org.whispersystems.signal", "org.thoughtcrime.securesms"),
    ],
  },
  {
    id: "webex",
    name: "Webex",
    vendor: "Cisco",
    description:
      "Meetings and messaging for Cisco estates. Desktop builds are direct downloads; mobile apps are on the public stores.",
    category: "communication",
    aliases: ["webex", "cisco webex"],
    website: "https://www.webex.com/",
    platforms: ["macos", "windows", "ios", "ipados", "android", "web"],
    popularity: 45,
    deployments: [
      appleUpload(
        "com.cisco.webexmeetingsapp",
        "https://www.webex.com/downloads.html",
        "Webex ships a DMG. Repackage it as a signed PKG before upload.",
      ),
      windowsExe("https://www.webex.com/downloads.html"),
      ...iosPlay("833967564", "com.cisco.squared", "com.cisco.wx2.android"),
    ],
  },
  {
    id: "microsoft-365-apps",
    name: "Microsoft 365 Apps",
    vendor: "Microsoft",
    description:
      "The Office suite for Mac and Windows: Word, Excel, PowerPoint, Outlook, OneDrive and OneNote. Microsoft's macOS package installs the suite together; Windows uses the Office Deployment Tool.",
    category: "productivity",
    aliases: ["office", "microsoft office", "m365", "office suite"],
    website: "https://www.microsoft.com/microsoft-365/enterprise",
    platforms: ["macos", "windows"],
    popularity: 97,
    notes:
      "The macOS PKG is a multi-app distribution package. Mattrax records it under com.microsoft.Word so inventory has one bundle to reconcile; the package installs every Office app it contains. Windows ODT produces a setup.exe, not an MSI, so it is not deployable until the Win32 path (#568) or an administratively built MSI exists.",
    deployments: [
      applePkg(
        "https://go.microsoft.com/fwlink/?linkid=525133",
        "com.microsoft.Word",
        "Microsoft's fwlink resolves to the current Microsoft 365 for Mac PKG. It is a suite installer; the inline manifest names com.microsoft.Word, which is the bundle inventory reconciles.",
      ),
      vendorDownload(
        "windows",
        "win",
        "https://www.microsoft.com/microsoft-365/enterprise/office-deployment-tool",
        "The Office Deployment Tool downloads and runs setup.exe. That needs the Win32 app path (#568), or an MSI built and signed by your packaging team.",
      ),
    ],
  },
  {
    id: "microsoft-word",
    name: "Microsoft Word",
    vendor: "Microsoft",
    description:
      "Microsoft's word processor for iPhone, iPad and Android. Desktop Word is installed by the Microsoft 365 Apps suite.",
    category: "productivity",
    aliases: ["word", "ms word"],
    website: "https://www.microsoft.com/microsoft-365/word",
    platforms: ["ios", "ipados", "android", "web"],
    popularity: 88,
    deployments: microsoftMobile(
      "586447913",
      "com.microsoft.Office.Word",
      "com.microsoft.office.word",
    ),
  },
  {
    id: "microsoft-excel",
    name: "Microsoft Excel",
    vendor: "Microsoft",
    description:
      "Microsoft's spreadsheet app for iPhone, iPad and Android. Desktop Excel is installed by the Microsoft 365 Apps suite.",
    category: "productivity",
    aliases: ["excel", "ms excel", "spreadsheet"],
    website: "https://www.microsoft.com/microsoft-365/excel",
    platforms: ["ios", "ipados", "android", "web"],
    popularity: 86,
    deployments: microsoftMobile(
      "586683407",
      "com.microsoft.Office.Excel",
      "com.microsoft.office.excel",
    ),
  },
  {
    id: "microsoft-powerpoint",
    name: "Microsoft PowerPoint",
    vendor: "Microsoft",
    description:
      "Microsoft's presentation app for iPhone, iPad and Android. Desktop PowerPoint is installed by the Microsoft 365 Apps suite.",
    category: "productivity",
    aliases: ["powerpoint", "ms powerpoint", "slides"],
    website: "https://www.microsoft.com/microsoft-365/powerpoint",
    platforms: ["ios", "ipados", "android", "web"],
    popularity: 78,
    deployments: microsoftMobile(
      "586449534",
      "com.microsoft.Office.Powerpoint",
      "com.microsoft.office.powerpoint",
    ),
  },
  {
    id: "microsoft-outlook",
    name: "Microsoft Outlook",
    vendor: "Microsoft",
    description:
      "Email and calendar for iPhone, iPad and Android. Desktop Outlook is installed by the Microsoft 365 Apps suite.",
    category: "productivity",
    aliases: ["outlook", "ms outlook", "email"],
    website: "https://www.microsoft.com/microsoft-365/outlook",
    platforms: ["ios", "ipados", "android", "web"],
    popularity: 87,
    deployments: microsoftMobile(
      "951937596",
      "com.microsoft.Office.Outlook",
      "com.microsoft.office.outlook",
    ),
  },
  {
    id: "microsoft-onedrive",
    name: "Microsoft OneDrive",
    vendor: "Microsoft",
    description:
      "Microsoft's file sync client for iPhone, iPad and Android. Desktop OneDrive is installed by the Microsoft 365 Apps suite.",
    category: "utilities",
    aliases: ["onedrive", "ms onedrive", "file sync"],
    website: "https://www.microsoft.com/microsoft-365/onedrive",
    platforms: ["ios", "ipados", "android", "web"],
    popularity: 75,
    deployments: microsoftMobile("477537958", "com.microsoft.skydrive", "com.microsoft.skydrive"),
  },
  {
    id: "microsoft-onenote",
    name: "Microsoft OneNote",
    vendor: "Microsoft",
    description:
      "Microsoft's note-taking app for iPhone, iPad and Android. Desktop OneNote is installed by the Microsoft 365 Apps suite.",
    category: "productivity",
    aliases: ["onenote", "ms onenote", "notes"],
    website: "https://www.microsoft.com/microsoft-365/onenote",
    platforms: ["ios", "ipados", "android", "web"],
    popularity: 64,
    deployments: microsoftMobile(
      "410395246",
      "com.microsoft.onenote",
      "com.microsoft.office.onenote",
    ),
  },
  {
    id: "notion",
    name: "Notion",
    vendor: "Notion Labs",
    description:
      "Docs, wikis and project databases. Desktop builds are DMG/EXE; the Microsoft Store package is the cleanest Windows option once Store delivery lands.",
    category: "productivity",
    aliases: ["notion", "wiki"],
    website: "https://www.notion.com/",
    platforms: ["macos", "windows", "ios", "ipados", "android", "web"],
    popularity: 70,
    deployments: [
      appleUpload(
        "notion.id",
        "https://www.notion.com/desktop/mac",
        "Notion publishes a DMG. Repackage it as a signed PKG before upload.",
      ),
      windowsStore("XPDBVSS44R0L9H"),
      windowsExe("https://www.notion.com/desktop/windows"),
      ...iosPlay("1232780281", "notion.id", "notion.id"),
    ],
  },
  {
    id: "asana",
    name: "Asana",
    vendor: "Asana",
    description:
      "Work management and project tracking. Mattrax lists the mobile apps; desktop use is through the browser.",
    category: "business",
    aliases: ["asana", "project management"],
    website: "https://asana.com/",
    platforms: ["ios", "ipados", "android", "web"],
    popularity: 48,
    deployments: iosPlay("489969512", "com.asana.Asana", "com.asana.app"),
  },
  {
    id: "trello",
    name: "Trello",
    vendor: "Atlassian",
    description:
      "Kanban boards and lightweight task tracking. Trello publishes a Mac App Store build, a Microsoft Store app and mobile apps.",
    category: "business",
    aliases: ["trello", "kanban", "atlassian"],
    website: "https://trello.com/",
    platforms: ["macos", "windows", "ios", "ipados", "android", "web"],
    popularity: 52,
    deployments: [
      appStore("macos", "1278508951", "com.atlassian.trello"),
      windowsStore("9NBLGGH4XXVW"),
      ...iosPlay("461504587", "com.fogcreek.trello", "com.trello"),
    ],
  },
  {
    id: "todoist",
    name: "Todoist",
    vendor: "Doist",
    description:
      "Task management with a Mac App Store build and mobile apps. The Mac build is a normal managed App Store install.",
    category: "business",
    aliases: ["todoist", "tasks", "to do"],
    website: "https://todoist.com/",
    platforms: ["macos", "ios", "ipados", "android", "web"],
    popularity: 46,
    deployments: [
      appStore("macos", "585829637", "com.todoist.mac.Todoist"),
      ...iosPlay("572688855", "com.todoist.ios", "com.todoist"),
    ],
  },
  {
    id: "gmail",
    name: "Gmail",
    vendor: "Google",
    description:
      "Google's mail client for iPhone, iPad and Android. Managed Google Workspace accounts can also use the web client.",
    category: "communication",
    aliases: ["gmail", "google mail"],
    website: "https://mail.google.com/",
    platforms: ["ios", "ipados", "android", "web"],
    popularity: 82,
    deployments: googleMobile("422689480", "com.google.Gmail", "com.google.android.gm"),
  },
  {
    id: "google-meet",
    name: "Google Meet",
    vendor: "Google",
    description:
      "Google Workspace video meetings. The Android package still uses Google's original Tachyon identifier.",
    category: "communication",
    aliases: ["meet", "google meet", "google hangouts"],
    website: "https://meet.google.com/",
    platforms: ["ios", "ipados", "android", "web"],
    popularity: 68,
    deployments: googleMobile(
      "1096918571",
      "com.google.Tachyon",
      "com.google.android.apps.tachyon",
    ),
  },
  {
    id: "google-drive",
    name: "Google Drive",
    vendor: "Google",
    description:
      "Google Drive for desktop and mobile. The desktop client is a DMG on macOS and an EXE on Windows.",
    category: "utilities",
    aliases: ["drive", "google drive", "file sync"],
    website: "https://www.google.com/drive/download/",
    platforms: ["macos", "windows", "ios", "ipados", "android", "web"],
    popularity: 72,
    deployments: [
      appleUpload(
        "com.google.drivefs",
        "https://dl.google.com/drive-file-stream/GoogleDrive.dmg",
        "Google ships a DMG. Repackage it as a signed PKG before upload.",
      ),
      windowsExe("https://www.google.com/drive/download/"),
      ...iosPlay("507874739", "com.google.Drive", "com.google.android.apps.docs"),
    ],
  },
  {
    id: "visual-studio-code",
    name: "Visual Studio Code",
    vendor: "Microsoft",
    description:
      "Source code editor with an extension marketplace. Microsoft ships a macOS ZIP and a Windows EXE; there is no managed package from the vendor.",
    category: "developer",
    aliases: ["vscode", "vs code", "code editor"],
    website: "https://code.visualstudio.com/",
    platforms: ["macos", "windows", "web"],
    popularity: 85,
    notes:
      "The macOS build is an .app in a ZIP. Repackage it as a signed PKG for managed installation. vscode.dev is the browser build; it cannot install extensions on the device.",
    deployments: [
      appleUpload(
        "com.microsoft.VSCode",
        "https://code.visualstudio.com/download",
        "Download the macOS ZIP, repackage it as a signed PKG and upload it.",
      ),
      windowsExe("https://code.visualstudio.com/download"),
    ],
  },
  {
    id: "zed",
    name: "Zed",
    vendor: "Zed Industries",
    description:
      "Collaborative code editor for macOS. Distributed as a DMG, so managed deployment needs a signed PKG.",
    category: "developer",
    aliases: ["zed", "zed editor"],
    website: "https://zed.dev/",
    platforms: ["macos"],
    popularity: 50,
    deployments: [
      appleUpload(
        "dev.zed.Zed",
        "https://zed.dev/download",
        "Download the DMG, repackage it as a signed PKG and upload it. Zed publishes separate Apple-silicon and Intel builds.",
      ),
    ],
  },
  {
    id: "iterm2",
    name: "iTerm2",
    vendor: "George Nachman",
    description:
      "Terminal emulator for macOS with split panes, profiles and tmux integration. Distributed as a ZIP, so it needs a signed PKG.",
    category: "developer",
    aliases: ["iterm", "iterm2", "terminal"],
    website: "https://iterm2.com/",
    platforms: ["macos"],
    popularity: 62,
    deployments: [
      appleUpload(
        "com.googlecode.iterm2",
        "https://iterm2.com/downloads.html",
        "Download the stable ZIP, repackage it as a signed PKG and upload it.",
      ),
    ],
  },
  {
    id: "ghostty",
    name: "Ghostty",
    vendor: "Ghostty",
    description:
      "Fast, native terminal emulator for macOS. Distributed as a DMG; Linux builds exist but are not managed by Mattrax.",
    category: "developer",
    aliases: ["ghostty", "terminal"],
    website: "https://ghostty.org/",
    platforms: ["macos"],
    popularity: 42,
    deployments: [
      appleUpload(
        "com.mitchellh.ghostty",
        "https://ghostty.org/download",
        "Download the universal DMG, repackage it as a signed PKG and upload it.",
      ),
    ],
  },
  {
    id: "windows-terminal",
    name: "Windows Terminal",
    vendor: "Microsoft",
    description:
      "Microsoft's tabbed terminal for Windows. Distributed through the Microsoft Store/MSIX, which needs the Windows Store path (#568).",
    category: "developer",
    aliases: ["terminal", "windows terminal", "wt"],
    website: "https://aka.ms/terminal",
    platforms: ["windows"],
    popularity: 66,
    deployments: [windowsStore("9N0DX20HK701")],
  },
  {
    id: "github-desktop",
    name: "GitHub Desktop",
    vendor: "GitHub",
    description:
      "Git client with a graphical diff and review flow. macOS ships a ZIP; Windows ships an EXE.",
    category: "developer",
    aliases: ["github desktop", "git", "github"],
    website: "https://desktop.github.com/",
    platforms: ["macos", "windows"],
    popularity: 54,
    deployments: [
      appleUpload(
        "com.github.GitHubClient",
        "https://desktop.github.com/download/",
        "Download the macOS ZIP, repackage it as a signed PKG and upload it.",
      ),
      windowsExe("https://central.github.com/deployments/desktop/desktop/latest/win32"),
    ],
  },
  {
    id: "docker-desktop",
    name: "Docker Desktop",
    vendor: "Docker",
    description:
      "Containers and Kubernetes for developer machines. macOS ships a DMG; Windows ships an EXE and has a Microsoft Store listing.",
    category: "developer",
    aliases: ["docker", "docker desktop", "containers"],
    website: "https://www.docker.com/products/docker-desktop/",
    platforms: ["macos", "windows"],
    popularity: 68,
    notes:
      "Docker Desktop licensing differs for large organisations; check Docker's subscription terms before a fleet-wide deployment.",
    deployments: [
      appleUpload(
        "com.docker.docker",
        "https://www.docker.com/products/docker-desktop/",
        "Download the DMG for the right architecture, repackage it as a signed PKG and upload it.",
      ),
      windowsExe("https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"),
      windowsStore("XP8CBJ40XLBWKX"),
    ],
  },
  {
    id: "postman",
    name: "Postman",
    vendor: "Postman",
    description: "API client and collection runner. macOS ships a ZIP; Windows ships an EXE.",
    category: "developer",
    aliases: ["postman", "api client"],
    website: "https://www.postman.com/downloads/",
    platforms: ["macos", "windows", "web"],
    popularity: 58,
    deployments: [
      appleUpload(
        "com.postmanlabs.mac",
        "https://www.postman.com/downloads/",
        "Download the macOS ZIP, repackage it as a signed PKG and upload it.",
      ),
      windowsExe("https://dl.pstmn.io/download/latest/win64"),
    ],
  },
  {
    id: "xcode",
    name: "Xcode",
    vendor: "Apple",
    description:
      "Apple's IDE and toolchain. Distributed through the Mac App Store, so it deploys through the normal App Store/VPP path.",
    category: "developer",
    aliases: ["xcode", "apple developer"],
    website: "https://developer.apple.com/xcode/",
    platforms: ["macos"],
    popularity: 65,
    notes:
      "Xcode is a very large download and requires a compatible macOS version. The App Store install is managed; command-line tools still need xcode-select.",
    deployments: [appStore("macos", "497799835", "com.apple.dt.Xcode")],
  },
  {
    id: "1password",
    name: "1Password",
    vendor: "AgileBits",
    description:
      "Password manager with a signed macOS PKG and Windows MSI, plus mobile store apps. Business plans use 1Password.com for vault provisioning.",
    category: "security",
    aliases: ["1password", "one password", "password manager"],
    website: "https://1password.com/",
    platforms: ["macos", "windows", "ios", "ipados", "android", "web"],
    popularity: 90,
    deployments: [
      applePkg(
        "https://downloads.1password.com/mac/1Password.pkg",
        "com.1password.1password",
        "1Password's signed PKG tracks the current release. Confirm the licence and account details separately; the package does not carry them.",
      ),
      windowsMsi(
        "https://downloads.1password.com/win/1PasswordSetup-latest.msi",
        "The latest-channel MSI. Enter the ProductCode from the downloaded MSI.",
      ),
      windowsStore("9NZWS5X28P0J"),
      ...iosPlay("1511601750", "com.1password.1password", "com.onepassword.android"),
    ],
  },
  {
    id: "bitwarden",
    name: "Bitwarden",
    vendor: "Bitwarden",
    description:
      "Open-source password manager. Desktop builds are DMG/EXE; the Microsoft Store app is available for Windows.",
    category: "security",
    aliases: ["bitwarden", "password manager"],
    website: "https://bitwarden.com/download/",
    platforms: ["macos", "windows", "ios", "ipados", "android", "web"],
    popularity: 66,
    deployments: [
      appStore("macos", "1352778147", "com.bitwarden.desktop"),
      appleUpload(
        "com.bitwarden.desktop",
        "https://bitwarden.com/download/",
        "The App Store build is the simplest managed macOS route. This DMG alternative must be repackaged as a signed PKG before upload.",
      ),
      windowsStore("9PJSDV0VPK04"),
      windowsExe("https://bitwarden.com/download/"),
      ...iosPlay("1137397744", "com.8bit.bitwarden", "com.x8bit.bitwarden"),
    ],
  },
  {
    id: "lastpass",
    name: "LastPass",
    vendor: "LastPass",
    description:
      "Password manager. Desktop downloads are DMG/EXE; mobile apps are on the public stores.",
    category: "security",
    aliases: ["lastpass", "password manager"],
    website: "https://www.lastpass.com/",
    platforms: ["macos", "windows", "ios", "ipados", "android", "web"],
    popularity: 40,
    deployments: [
      vendorDownload(
        "macos",
        "apple",
        "https://lastpass.com/misc_download2.php",
        "LastPass publishes a DMG directly. It needs repackaging and signing before the Apple MDM path can install it.",
      ),
      windowsExe("https://lastpass.com/misc_download2.php"),
      ...iosPlay("324613447", "com.lastpass.ilastpass", "com.lastpass.lpandroid"),
    ],
  },
  {
    id: "nordvpn",
    name: "NordVPN",
    vendor: "Nord Security",
    description:
      "VPN client. Desktop builds are direct downloads; mobile apps are on the public stores.",
    category: "security",
    aliases: ["nordvpn", "vpn", "nord"],
    website: "https://nordvpn.com/download/",
    platforms: ["macos", "windows", "ios", "ipados", "android"],
    popularity: 44,
    notes:
      "VPN profiles and team credentials are provisioned in Nord's admin console; the installer alone does not enrol a device in a team.",
    deployments: [
      vendorDownload(
        "macos",
        "apple",
        "https://nordvpn.com/download/mac/",
        "The macOS build is a DMG. Repackage it as a signed PKG before the Apple MDM path can install it.",
      ),
      windowsExe("https://nordvpn.com/download/windows/"),
      ...iosPlay("905953485", "com.nordvpn.NordVPN", "com.nordvpn.android"),
    ],
  },
  {
    id: "tailscale",
    name: "Tailscale",
    vendor: "Tailscale",
    description:
      "WireGuard-based mesh VPN. Tailscale publishes a signed macOS PKG; the Windows MSI is versioned and needs an administrator-supplied URL.",
    category: "security",
    aliases: ["tailscale", "vpn", "wireguard", "mesh vpn"],
    website: "https://tailscale.com/",
    platforms: ["macos", "windows", "ios", "ipados", "android"],
    popularity: 56,
    notes:
      "Enrolment needs an auth key or SSO from your tailnet. Installing the client does not join the device by itself.",
    deployments: [
      appStore("macos", "1475387142", "io.tailscale.ipn.macos"),
      applePkg(
        "https://pkgs.tailscale.com/stable/Tailscale.pkg",
        "io.tailscale.ipn.macos",
        "The App Store build is the simplest managed macOS route. Tailscale's signed stable PKG follows the stable channel as an alternative.",
      ),
      vendorDownload(
        "windows",
        "win",
        "https://tailscale.com/download/windows",
        "Tailscale publishes versioned MSIs. Supply a verified MSI URL and ProductCode once the Win32/MSI catalogue feed exists (#568/#589).",
      ),
      ...iosPlay("1470499037", "io.tailscale.ipn.ios", "com.tailscale.ipn"),
    ],
  },
  {
    id: "microsoft-authenticator",
    name: "Microsoft Authenticator",
    vendor: "Microsoft",
    description:
      "MFA and passwordless sign-in for Microsoft Entra ID. Mobile only; it has no desktop client.",
    category: "security",
    aliases: ["authenticator", "microsoft authenticator", "mfa"],
    website: "https://www.microsoft.com/security/mobile-authenticator-app",
    platforms: ["ios", "ipados", "android"],
    popularity: 78,
    deployments: iosPlay(
      "983156458",
      "com.microsoft.azureauthenticator",
      "com.azure.authenticator",
    ),
  },
  {
    id: "google-authenticator",
    name: "Google Authenticator",
    vendor: "Google",
    description:
      "TOTP authenticator for Google and third-party accounts. Mobile only; it has no desktop client.",
    category: "security",
    aliases: ["authenticator", "google authenticator", "totp", "mfa"],
    website: "https://support.google.com/accounts/answer/1066447",
    platforms: ["ios", "ipados", "android"],
    popularity: 62,
    deployments: iosPlay(
      "388497605",
      "com.google.Authenticator",
      "com.google.android.apps.authenticator2",
    ),
  },
  {
    id: "spotify",
    name: "Spotify",
    vendor: "Spotify",
    description:
      "Music and podcast streaming. macOS ships a DMG; Windows has a Microsoft Store listing.",
    category: "media",
    aliases: ["spotify", "music", "podcasts"],
    website: "https://www.spotify.com/",
    platforms: ["macos", "windows", "ios", "ipados", "android", "web"],
    popularity: 76,
    deployments: [
      appleUpload(
        "com.spotify.client",
        "https://download.scdn.co/Spotify.dmg",
        "Spotify's DMG is unsigned for MDM purposes. Repackage it as a signed PKG before upload.",
      ),
      windowsStore("9NCBCSZSJRSB"),
      ...iosPlay("324684580", "com.spotify.client", "com.spotify.music"),
    ],
  },
  {
    id: "vlc",
    name: "VLC media player",
    vendor: "VideoLAN",
    description:
      "Open-source media player. macOS uses a DMG; Windows has a Microsoft Store listing and versioned MSI builds.",
    category: "media",
    aliases: ["vlc", "media player", "videolan"],
    website: "https://www.videolan.org/vlc/",
    platforms: ["macos", "windows", "ios", "ipados", "android"],
    popularity: 64,
    deployments: [
      appleUpload(
        "org.videolan.vlc",
        "https://www.videolan.org/vlc/download-macosx.html",
        "Download the macOS DMG, repackage it as a signed PKG and upload it.",
      ),
      windowsStore("XPDM1ZW6815MQM"),
      windowsExe(
        "https://www.videolan.org/vlc/download-windows.html",
        "VideoLAN publishes versioned MSI and EXE builds. Supply the MSI you have verified (#568/#589).",
      ),
      ...iosPlay("650377962", "org.videolan.vlc-ios", "org.videolan.vlc"),
    ],
  },
  {
    id: "obs-studio",
    name: "OBS Studio",
    vendor: "OBS Project",
    description:
      "Open-source screen recording and live streaming. macOS ships a DMG; Windows ships an EXE.",
    category: "media",
    aliases: ["obs", "obs studio", "streaming", "screen recording"],
    website: "https://obsproject.com/",
    platforms: ["macos", "windows"],
    popularity: 48,
    deployments: [
      appleUpload(
        "com.obsproject.obs-studio",
        "https://obsproject.com/download",
        "Download the macOS DMG, repackage it as a signed PKG and upload it.",
      ),
      windowsExe("https://obsproject.com/download"),
    ],
  },
  {
    id: "figma",
    name: "Figma",
    vendor: "Figma",
    description:
      "Collaborative interface design. Desktop apps are DMG/EXE; files can also be opened in the browser.",
    category: "media",
    aliases: ["figma", "design", "ui design"],
    website: "https://www.figma.com/downloads/",
    platforms: ["macos", "windows", "ios", "ipados", "android", "web"],
    popularity: 60,
    deployments: [
      appleUpload(
        "com.figma.Desktop",
        "https://www.figma.com/downloads/",
        "Download the macOS DMG, repackage it as a signed PKG and upload it.",
      ),
      windowsExe("https://www.figma.com/downloads/"),
      ...iosPlay("1152747299", "com.figma.FigmaMirror", "com.figma.mirror"),
    ],
  },
  {
    id: "adobe-acrobat-reader",
    name: "Adobe Acrobat Reader",
    vendor: "Adobe",
    description:
      "PDF reader and annotation tool. Adobe publishes versioned enterprise MSIs and a macOS DMG; the download page is the stable entry point.",
    category: "media",
    aliases: ["acrobat", "acrobat reader", "pdf", "adobe reader"],
    website: "https://get.adobe.com/reader/",
    platforms: ["macos", "windows", "ios", "ipados", "android", "web"],
    popularity: 84,
    notes:
      "Adobe's direct MSI URLs embed a version. Mattrax records the enterprise download page rather than a URL that breaks on the next release; a version feed is #589 work.",
    deployments: [
      appleUpload(
        "com.adobe.Reader",
        "https://get.adobe.com/reader/",
        "Download the macOS DMG, repackage it as a signed PKG and upload it.",
      ),
      vendorDownload(
        "windows",
        "win",
        "https://get.adobe.com/reader/enterprise/",
        "Adobe publishes a versioned MSI. Supply the MSI URL and ProductCode you have verified; auto-updating Adobe feeds are #589.",
      ),
      ...iosPlay("469337564", "com.adobe.Adobe-Reader", "com.adobe.reader"),
    ],
  },
  {
    id: "adobe-creative-cloud",
    name: "Adobe Creative Cloud",
    vendor: "Adobe",
    description:
      "Adobe's app launcher and Creative Cloud suite. Fleet deployment requires packages built in the Adobe Admin Console; there is no single public installer Mattrax can drive.",
    category: "media",
    aliases: ["creative cloud", "adobe", "photoshop", "illustrator", "indesign"],
    website: "https://www.adobe.com/creativecloud/desktop-app.html",
    platforms: ["macos", "windows", "web"],
    popularity: 65,
    notes:
      "Adobe's supported enterprise route is the Admin Console: build a package per app, then deploy the generated PKG/MSI. This title is catalogued so administrators can find the requirement and the vendor link, not because a one-click install exists.",
    deployments: [
      vendorDownload(
        "macos",
        "apple",
        "https://www.adobe.com/creativecloud/desktop-app.html",
        "Build the installer in Adobe Admin Console, then upload the generated PKG as a normal application. Adobe does not publish a generic signed suite package.",
      ),
      vendorDownload(
        "windows",
        "win",
        "https://www.adobe.com/creativecloud/desktop-app.html",
        "Build the installer in Adobe Admin Console and deploy the generated MSI through the existing catalogue. A generic public MSI does not exist.",
      ),
    ],
  },
  {
    id: "dropbox",
    name: "Dropbox",
    vendor: "Dropbox",
    description: "File sync and sharing. macOS ships a DMG; Windows ships an EXE.",
    category: "utilities",
    aliases: ["dropbox", "file sync"],
    website: "https://www.dropbox.com/",
    platforms: ["macos", "windows", "ios", "ipados", "android", "web"],
    popularity: 58,
    deployments: [
      appleUpload(
        "com.getdropbox.dropbox",
        "https://www.dropbox.com/download?plat=mac",
        "Download the macOS DMG, repackage it as a signed PKG and upload it.",
      ),
      windowsExe("https://www.dropbox.com/download?plat=win"),
      ...iosPlay("327630330", "com.getdropbox.Dropbox", "com.dropbox.android"),
    ],
  },
  {
    id: "teamviewer",
    name: "TeamViewer",
    vendor: "TeamViewer",
    description:
      "Remote support and remote access. TeamViewer publishes stable DMG and EXE links; an MSI can be built for managed Windows deployment.",
    category: "remote-support",
    aliases: ["teamviewer", "remote support", "remote access"],
    website: "https://www.teamviewer.com/",
    platforms: ["macos", "windows"],
    popularity: 62,
    notes:
      "Unattended access and corporate licensing are configured in the TeamViewer Management Console. The installer alone does not assign a device to your company profile.",
    deployments: [
      appleUpload(
        "com.teamviewer.TeamViewer",
        "https://download.teamviewer.com/download/TeamViewer.dmg",
        "Download the DMG, repackage it as a signed PKG and upload it.",
      ),
      windowsExe(
        "https://download.teamviewer.com/download/TeamViewer_Setup_x64.exe",
        "TeamViewer's public download is an EXE. Build an MSI in the Management Console for managed deployment once Win32 packaging is available (#568).",
      ),
    ],
  },
  {
    id: "apple-pages",
    name: "Pages",
    vendor: "Apple",
    description:
      "Apple's word processor and page-layout app. Distributed through the App Store, including the Mac App Store.",
    category: "productivity",
    aliases: ["pages", "apple pages", "word processor"],
    website: "https://www.apple.com/pages/",
    platforms: ["macos", "ios", "ipados", "web"],
    popularity: 50,
    deployments: [
      appStore("macos", "361309726", "com.apple.Pages"),
      appStore("ios", "361309726", "com.apple.Pages"),
    ],
  },
  {
    id: "apple-numbers",
    name: "Numbers",
    vendor: "Apple",
    description:
      "Apple's spreadsheet app. Distributed through the App Store, including the Mac App Store.",
    category: "productivity",
    aliases: ["numbers", "apple numbers", "spreadsheet"],
    website: "https://www.apple.com/numbers/",
    platforms: ["macos", "ios", "ipados", "web"],
    popularity: 46,
    deployments: [
      appStore("macos", "361304891", "com.apple.Numbers"),
      appStore("ios", "361304891", "com.apple.Numbers"),
    ],
  },
  {
    id: "opencode",
    name: "OpenCode",
    vendor: "SST",
    description:
      "Terminal-based AI coding agent. Distributed as a CLI through an install script and package managers, not as a GUI application or managed package.",
    category: "developer",
    aliases: ["opencode", "sst opencode", "ai coding agent", "terminal ai"],
    website: "https://opencode.ai/",
    platforms: ["macos", "windows"],
    popularity: 44,
    notes:
      "There is no vendor-signed PKG, MSI or store listing to install. The official route is the CLI install script or a package manager; packaging it for a fleet is an administrator decision tracked under #568/#589.",
    deployments: [
      vendorDownload(
        "macos",
        "apple",
        "https://opencode.ai/docs/",
        "OpenCode is a CLI. Install it with the vendor script or a package manager, then distribute a packaged wrapper if your fleet needs a managed installer.",
      ),
      vendorDownload(
        "windows",
        "win",
        "https://opencode.ai/docs/",
        "OpenCode is a CLI. Install it with the vendor script or a package manager; there is no MSI or Store package to deliver over OMA-DM.",
      ),
    ],
  },
  {
    id: "google-classroom",
    name: "Google Classroom",
    vendor: "Google",
    description:
      "Assignment, grading and class communication for Google Workspace for Education. Mobile apps are on the public stores; teachers and students can also use the web app.",
    category: "education",
    aliases: ["classroom", "google classroom", "school"],
    website: "https://classroom.google.com/",
    platforms: ["ios", "ipados", "android", "web"],
    popularity: 70,
    deployments: iosPlay("924620788", "com.google.Classroom", "com.google.android.apps.classroom"),
  },
  {
    id: "canvas",
    name: "Canvas",
    vendor: "Instructure",
    description:
      "Learning management system for schools and higher education. The student app is available for iPhone, iPad and Android; courses also open in the browser.",
    category: "education",
    aliases: ["canvas", "canvas student", "instructure", "lms"],
    website: "https://www.instructure.com/canvas",
    platforms: ["ios", "ipados", "android", "web"],
    popularity: 58,
    deployments: iosPlay("480883488", "com.instructure.icanvas", "com.instructure.candroid"),
  },
  {
    id: "kahoot",
    name: "Kahoot!",
    vendor: "Kahoot!",
    description:
      "Quiz and game-based learning. Students join on iPhone, iPad or Android; teachers create and host from the web or mobile apps.",
    category: "education",
    aliases: ["kahoot", "quiz", "classroom game"],
    website: "https://kahoot.com/",
    platforms: ["ios", "ipados", "android", "web"],
    popularity: 56,
    deployments: iosPlay(
      "1131203560",
      "no.mobitroll.kahoot.controller",
      "no.mobitroll.kahoot.android",
    ),
  },
  {
    id: "seesaw",
    name: "Seesaw",
    vendor: "Seesaw Learning",
    description:
      "Portfolio and family-communication app for primary schools. Available for iPhone, iPad and Android, with a web companion.",
    category: "education",
    aliases: ["seesaw", "seesaw class", "primary school"],
    website: "https://web.seesaw.me/",
    platforms: ["ios", "ipados", "android", "web"],
    popularity: 52,
    deployments: iosPlay("930565184", "me.see-saw.classroom", "seesaw.shadowpuppet.co.classroom"),
  },
  {
    id: "minecraft-education",
    name: "Minecraft Education",
    vendor: "Microsoft",
    description:
      "Game-based learning edition of Minecraft for classrooms. The iPad and Android apps are catalogued; Windows and Mac use the vendor's education installer, and a school licence is required.",
    category: "education",
    aliases: ["minecraft", "minecraft education", "mojang", "classroom"],
    website: "https://education.minecraft.net/",
    platforms: ["ios", "ipados", "android", "windows", "macos"],
    popularity: 54,
    notes:
      "A Minecraft Education licence must be assigned through the school's Microsoft account. The installer alone does not grant access to lessons or worlds.",
    deployments: [
      ...iosPlay("1196524622", "com.mojang.minecraft-edu", "com.mojang.minecraftedu"),
      vendorDownload(
        "windows",
        "win",
        "https://education.minecraft.net/en-us/get-started/download",
        "Microsoft publishes a Windows education installer. It is not an MSI, so it needs the Win32 path (#568) or an administratively packaged MSI.",
      ),
      vendorDownload(
        "macos",
        "apple",
        "https://education.minecraft.net/en-us/get-started/download",
        "Microsoft publishes a macOS education installer. It needs repackaging into a signed PKG before the Apple MDM path can install it.",
      ),
    ],
  },
  {
    id: "google-earth",
    name: "Google Earth",
    vendor: "Google",
    description:
      "Interactive globe for geography and earth science. The mobile apps are on the public stores; the web version runs in the browser.",
    category: "education",
    aliases: ["earth", "google earth", "geography", "maps"],
    website: "https://www.google.com/earth/",
    platforms: ["ios", "ipados", "android", "web"],
    popularity: 50,
    deployments: iosPlay("293622097", "com.google.b612", "com.google.earth"),
  },
  {
    id: "scratchjr",
    name: "ScratchJr",
    vendor: "Scratch Foundation",
    description:
      "Introductory block-based coding for young children. Available for iPad and Android tablets; the Scratch Foundation publishes it as a free app.",
    category: "education",
    aliases: ["scratch", "scratchjr", "coding", "primary school"],
    website: "https://www.scratchjr.org/",
    platforms: ["ios", "ipados", "android"],
    popularity: 48,
    deployments: iosPlay("895485086", "edu.mitmedialab.scratchjr", "org.scratchjr.android"),
  },
  {
    id: "scratch",
    name: "Scratch",
    vendor: "Scratch Foundation",
    description:
      "Browser-based block programming environment from MIT. It runs at scratch.mit.edu and has no managed desktop or mobile installer.",
    category: "education",
    aliases: ["scratch", "mit scratch", "coding", "programming"],
    website: "https://scratch.mit.edu/",
    platforms: ["web"],
    popularity: 46,
    notes:
      "Scratch is a web application, not an installed app. Bookmark or allow the site through browser policy; ScratchJr covers iPad and Android tablets.",
    deployments: [],
  },
  {
    id: "apple-keynote",
    name: "Keynote",
    vendor: "Apple",
    description:
      "Apple's presentation app. Distributed through the App Store, including the Mac App Store.",
    category: "productivity",
    aliases: ["keynote", "apple keynote", "presentation"],
    website: "https://www.apple.com/keynote/",
    platforms: ["macos", "ios", "ipados", "web"],
    popularity: 48,
    deployments: [
      appStore("macos", "361285480", "com.apple.Keynote"),
      appStore("ios", "361285480", "com.apple.Keynote"),
    ],
  },
];
