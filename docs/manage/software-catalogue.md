# Software catalogue

The software catalogue is a curated list (the data contract has a schema version) of common
business, school and consumer applications. It records who publishes each title, the identifiers an MDM needs, which
platforms the vendor supports, and how — if at all — Mattrax can deploy it today.

It is **not** an app store, a packaging service or a patch feed. Adding a title creates ordinary
tenant applications; delivery, assignment, reporting and uninstall then use the same pipeline
as a hand-built entry. This page states exactly what the data contains and where the limits are.

## Where it lives

| Piece     | Location                                                             |
| --------- | -------------------------------------------------------------------- |
| Data      | `packages/software/src/titles.ts`                                    |
| Contract  | `packages/software/src/schema.ts`                                    |
| Search    | `packages/software/src/search.ts`                                    |
| Add plan  | `packages/software/src/plan.ts`                                      |
| API       | `/api/v1/tenants/:tenantId/software/catalogue`                       |
| Dashboard | Applications → **Catalogue** (`/t/:tenantId/applications/catalogue`) |

The old `/t/:tenantId/software` URL redirects to the catalogue for bookmarks.

## What a title contains

- **Vendor, name, description, category, aliases, vendor website.**
- **Supported platforms:** macOS, Windows, iOS, iPadOS, Android, tvOS, visionOS and web. A
  platform is listed only when the vendor publishes the app for it.
- **Identifiers:** Apple bundle id, Apple App Store `trackId`, Microsoft Store product id,
  Managed Google Play package name, or a vendor MSI ProductCode when one is stable.
- **Deployment methods:** one row per platform and packaging style. Each row carries a stable
  id, the MDM platform, the OS target, the kind, a URL or store id, and a note about packaging.
- **Notes and limits** where the vendor or the delivery path imposes one.

The catalogue deliberately contains **no vendor release versions and no hashes**. A vendor
"latest" URL has neither, and writing a version or SHA-256 that the catalogue cannot refresh
would be a lie. A title that needs a pinned build says so and asks an administrator for the
package. A Windows MSI addition accepts an installer version for the MDM payload; it defaults to
`1.0.0` when the administrator does not know it, and can be corrected on the application.

## Platform and delivery matrix

| Delivery method           | Target             | State today                                                   |
| ------------------------- | ------------------ | ------------------------------------------------------------- |
| Apple App Store           | macOS, iOS, iPadOS | Ready. `InstallApplication`; VPP if configured                |
| Vendor PKG                | macOS              | Ready. `InstallEnterpriseApplication` with an inline manifest |
| Signed package upload     | macOS, iOS         | Ready after the administrator uploads a signed PKG/IPA        |
| Windows MSI               | Windows            | Ready. `EnterpriseDesktopAppManagement` over OMA-DM           |
| Managed Google Play       | Android            | Ready. Compiled Android application policy                    |
| Microsoft Store / MSIX    | Windows            | **Not wired** (#568)                                          |
| Vendor EXE / Win32        | Windows            | **Not wired** (#568)                                          |
| Vendor DMG / ZIP          | macOS              | **Needs packaging** into a signed PKG, then upload            |
| Adobe Admin Console / ODT | macOS, Windows     | **Needs vendor packaging**; no generic installer              |

The dashboard shows these states on each method. Unsupported methods are visible but cannot be
selected, so an administrator sees why rather than wondering where a button went.

### Apple platform targets

Apple App Store ids are per app record, not per OS family, and macOS and iOS share the same MDM
platform. The catalogue therefore persists the selected OS target on the application
(`catalogue_target`) and the install path filters store apps with `appleOsFamily`. A macOS App
Store title only queues on Macs, and an iOS/iPadOS title only queues on iPhones and iPads. Manual
entries without a target keep their previous behaviour. There are live macOS App Store ids for
Slack (`803453959`), Trello (`1278508951`), Bitwarden (`1352778147`) and Tailscale
(`1475387142`).

### Direct vendor PKG

For a catalogue `apple-pkg` method, the existing Apple delivery path accepts a vendor PKG URL and
sends `InstallEnterpriseApplication` with an inline manifest. The device downloads the package
from the vendor. Mattrax does **not** hash-verify that URL because the vendor controls the bytes
and a "latest" URL changes without notice. Use a vendor that publishes signed packages, and pin
the URL where the vendor allows it.

This is why an uploaded package remains the stricter path: uploading records a SHA-256 and serves
the exact bytes Mattrax stored. An enterprise that requires hash pinning should package and upload
rather than point at a vendor URL.

## Adding a title to a tenant

1. Open **Applications → Catalogue**, search or filter, and open a title.
2. Select the methods you want. A method that needs a ProductCode asks for it; a method that needs
   an upload creates the application first and asks for the signed package on the application page.
3. Press **Add selected methods**.

Each selected method becomes one tenant application because an application row targets one MDM
platform. A multi-platform title therefore appears as, for example, "Google Chrome (macOS)" and
"Google Chrome (Windows)". The application's notes record the catalogue title/method provenance,
and `application.catalogue_title_id` / `application.catalogue_method_id` make re-adding
idempotent: the same method returns the existing application instead of creating a duplicate.
A unique index on `(organisation_id, catalogue_title_id, catalogue_method_id)` arbitrates a
concurrent add, and the API re-reads the winner rather than surfacing a duplicate-key error.

Adding is an `applications.write` action and records `application.catalogue_added` in the audit
log. It does not require step-up or approval because it only creates catalogue rows; installing or
uninstalling on devices is the action that can change a fleet, and it keeps its existing policy.

## Search

Search runs in the API Worker over a normalised index built once from the bundled catalogue. It
ranks exact names, title prefixes, aliases, vendors, categories and identifiers, and allows a
small bounded edit distance for typos. Multi-word queries are ANDed. Results are paginated and
include facet counts for categories and platforms.

Why not client-side or a bloom filter:

- The dashboard must not bundle the catalogue data. Server-side search keeps one ranking
  implementation for the UI, HTTP API and MCP, and the browser only receives the page it shows.
- At a few dozen titles, the Worker's in-memory scan is already sub-millisecond. Moving it to the
  client would trade a network round trip for a larger JavaScript bundle and a second ranking
  implementation to keep in sync.
- A bloom filter answers "definitely not an exact token". It cannot rank prefixes, substrings or
  typos, and every "maybe" still needs the index behind it. It would add state without removing
  work. If the catalogue ever grows to thousands of titles with an external feed, the same API
  contract can move behind a real index without changing the dashboard.

## Refreshing the catalogue

Vendor pages and store listings change. The data carries `CATALOGUE_VERIFIED_AT` and
`CATALOGUE_PROVENANCE` so an operator can see when it was last checked; the catalogue list and a
title's detail page show the verified date.

To refresh:

1. Re-check the Apple id with `https://itunes.apple.com/lookup?id=<id>&country=us` (the response
   includes `trackName` and `bundleId`).
2. Re-check a Microsoft Store id at `https://apps.microsoft.com/detail/<id>`.
3. Re-check an Android package on `https://play.google.com/store/apps/details?id=<package>`.
4. Check a direct URL with `curl -sIL` and confirm the final content type. Remove a URL if it
   now requires authentication or redirects to an HTML page.
5. Update the entry and `CATALOGUE_VERIFIED_AT`, then run `pnpm test`. The data tests fail on a
   duplicate id, a method whose target is not in `platforms`, a malformed store id, a missing
   bundle identifier or an unsupported method claimed as ready.

Do not add a vendor release version or hash while refreshing. Those belong to a release feed, not
this file. `CATALOGUE_VERIFIED_AT` is surfaced in the dashboard so an administrator can see when
the stored ids and URLs were last checked.

## Updates, patches and feeds

| Issue     | Relationship                                                                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #431      | This delivery: title data, search, dashboard and add flow.                                                                                                                                                              |
| #561      | Patch management. Needs a target version per title, eligibility from device inventory, deadlines and retries. The catalogue has no version to patch to yet.                                                             |
| #568      | Windows Win32/MSIX/Store delivery. Unlocks the catalogue's `windows-exe`, `windows-msix` and `windows-store` methods and makes many Windows vendors one-click.                                                          |
| OpenCode  | A terminal AI coding agent is catalogued but has no GUI or managed installer. It is a vendor-download reference until an administrator packages the CLI.                                                                |
| Education | Google Classroom, Canvas, Kahoot!, Seesaw, Minecraft Education, Google Earth, ScratchJr and Scratch are catalogued with live App Store and Play ids where they exist. Scratch is web-only; ScratchJr is the tablet app. |
| #589      | Versioned vendor feed. Adds releases, download URLs, SHA-256, signing identity and automatic refresh. The existing application row gains installer versions instead of a new title for every release.                   |

The schema is prepared for that next step: `catalogue_title_id`, `catalogue_method_id`,
`catalogue_target` and `catalogue_kind` on `application` give a feed one stable row to attach a
new installer to. Those fields also travel through tenant export, backup/restore and cutover, so a
restored tenant keeps its "already added" state. Until #589 lands, adding a
title is a one-time action and a new vendor release is a new uploaded package or an updated URL.

## Limits to publish, not hide

- **No uninstall through the catalogue.** Removing an assignment stops future installs; uninstall
  is #562. The application page shows the same limitation as a hand-built entry.
- **No automatic update.** A vendor "latest" URL picks up a new release when the device installs,
  but Mattrax does not know the version, cannot report "behind", and does not retry a failed
  update. That is #561/#589.
- **Store availability varies by region.** A numeric App Store id is global for one record, but a
  vendor can publish separate records per market. The existing storefront mapping still applies.
- **Windows needs a ProductCode for MSI.** Several vendors rotate it with the package. The add flow
  asks for it rather than embedding a stale GUID.
- **Packaging is real work.** A DMG, ZIP or EXE is not a managed installer. The catalogue links the
  vendor download and marks the title as needing a signed PKG/MSI; it does not pretend to package
  it.
- **Licensing is the tenant's.** 1Password, Docker, Adobe, Tailscale, TeamViewer, VPNs and similar
  titles need vendor account provisioning in addition to the binary. The notes say so.
- **Linux is out of scope.** Mattrax manages Apple, Windows and Android devices.
