# Policy catalogue

The policy designer on `/designer` and in the dashboard reads static catalogue files. Apple
and Android ship as one file each; Windows is split so browsing does not download the whole
dataset.

## What ships

| File                            | Size    | Loaded when                            |
| ------------------------------- | ------- | -------------------------------------- |
| `manifest.json`                 | ~240 KB | On every designer mount                |
| `apple.json`                    | ~2.2 MB | Apple tab opened                       |
| `android.json`                  | ~270 KB | Android tab opened                     |
| `windows/index.json`            | ~150 KB | Windows tab opened                     |
| `windows/<collection-key>.json` | ~20 KB  | A collection is selected or referenced |
| `windows/search.json`           | ~6.9 MB | First non-empty Windows search         |
| `third-party-apps.json`         | ~17 KB  | Third-party apps section               |

`windows/index.json` holds one summary per collection: `id`, `key`, `name`, `identifier`,
`group`, `kind`, `surface`, `deprecated`, `minOs`, `propertyCount`.

The uncompressed Windows payload is about 20 MB in total, but a browse-and-configure visit
transfers roughly 150 KB plus a few tens of kilobytes per collection. The search index is
fetched once per session and is never requested for browsing.

## Regenerating

The catalogue is generated from the vendors' published schemas; never hand-edit anything
under `apps/web/public/catalog/` or `data/catalog/`.

```bash
pnpm catalog:sync
```

The command downloads and normalises all three sources, writes `manifest.json`,
`apple.json` and `android.json` into `apps/web/public/catalog/`, writes the raw Windows
catalogue to `data/catalog/windows.json`, then splits Windows into the files the designer
loads. The whole run needs network access; the committed output means the app itself does
not.

| Platform | Source                                                                                                           | Format |
| -------- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| Apple    | [`apple/device-management`](https://github.com/apple/device-management) (`release`, MIT)                         | YAML   |
| Android  | [Android Management API discovery](https://androidmanagement.googleapis.com/$discovery/rest?version=v1)          | JSON   |
| Windows  | [`royklo/IntuneSettingsCatalogData`](https://github.com/royklo/IntuneSettingsCatalogData) (Microsoft Graph data) | JSON   |

The adapters live in `scripts/catalog-sync/`. See
[Catalogue sources](/reference/catalogue-sources) for why these sources were chosen and
the licensing caveats around the generated data.

## Third-party applications

`third-party-apps.json` is a curated, hand-reviewed catalogue (not produced by
`catalog:sync`) of common applications and their managed settings. The designer's
**Third-party apps** section offers the entries that document the active platform:

| Platform | Compiles to                                                                    |
| -------- | ------------------------------------------------------------------------------ |
| Apple    | `com.apple.ManagedClient.preferences` with the app's preference domain (macOS) |
| Windows  | Policy CSP `Replace` nodes for the Chrome/Edge ADMX settings                   |
| Android  | `applications[].managedConfiguration` in the Managed Google Play policy        |

Each entry names its vendor sources in `sources`. Adding an application means editing that
JSON file and extending `thirdPartyApps.test.ts`; no designer code is duplicated per app.

iOS managed app configuration is not part of this catalogue: the templates target macOS
managed preferences, Windows CSP and Android managed configuration.

To rebuild only the split Windows files after replacing `data/catalog/windows.json`:

```bash
pnpm catalog:split
```

The split writes `apps/web/public/catalog/windows/`, removes stale collection files and is
deterministic: collections are sorted by id, properties keep source order and no timestamps
are written.

Verify a checkout without writing:

```bash
pnpm catalog:check
```

Both split commands accept `--source <file>` and `--out <dir>`.

## Loader API

`apps/web/src/lib/policy-designer/catalog.ts`:

- `loadManifest()` — platform metadata and statistics.
- `loadPlatformIndex(platform)` — summaries for browse and name search.
- `loadCollection(platform, collectionId)` — one full collection, cached.
- `loadSearchIndex(platform)` — per-property search text, cached.
- `searchCollections(summaries, query)` and `searchIndexProperties(index, query)`.
- `resetPlatformCache(platform)` — drop caches for retry.

Collection files replace `/` with `--` in the id
(`windows/settings/above-lock` → `windows--settings--above-lock.json`), recorded as `key`
in the index.

## Documentation links

The designer and the policy editor link each entry to the vendor's documentation.

- **Windows** uses the `source` URL the catalogue already carries per property,
  falling back to the collection's Policy CSP reference when a property has no
  source of its own.
- **Apple** has no stable URL scheme for payload and declaration types, so
  `apps/web/src/lib/policy-designer/documentation.ts` holds a curated map from
  catalogue identifiers to `developer.apple.com` pages. Types Apple documents
  more than once (for example `com.apple.MCX`) are keyed by identifier and
  collection name.

Types missing from the curated map (legacy payloads Apple no longer documents,
custom payloads and future catalogue additions) link to
`profile-specific-payload-keys` or `devicemanagement-declarations` instead of a
guessed slug, so an unknown type never produces a dead link. Links open in a new
tab and are covered by `documentation.test.ts`.

## How selections become policies

| Selection         | Stored as                                 |
| ----------------- | ----------------------------------------- |
| Apple designer    | `mttx.apple.custom.designer`              |
| Apple declaration | `mttx.apple.declaration.d<hash>`          |
| Windows settings  | `mttx.windows.custom.<id>` OMA-URI nodes  |
| Android settings  | `mttx.android.policy.<id>` AMAPI fragment |

The designer is optional. You can upload a `.mobileconfig`, write a declaration or send a
Windows/Android configuration through the API.

## Updating the catalogue

1. Run `pnpm catalog:sync`.
2. Run `pnpm catalog:check`.
3. Review the generated diff and commit it with any adapter changes.
4. Deploy the web Worker; the catalogue is part of its assets.

The catalogue is static. Changing it does not change existing policies until a policy is
saved with a new selection.

## Next

- [Catalogue sources](/reference/catalogue-sources)
- [Policies](/manage/policies)
- [Apple DDM](/platforms/apple/ddm)
- [Windows policies](/platforms/windows/policies)
