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

`windows/index.json` holds one summary per collection: `id`, `key`, `name`, `identifier`,
`group`, `kind`, `surface`, `deprecated`, `minOs`, `propertyCount`.

The uncompressed Windows payload is about 20 MB in total, but a browse-and-configure visit
transfers roughly 150 KB plus a few tens of kilobytes per collection. The search index is
fetched once per session and is never requested for browsing.

## Regenerating

The source catalogue is `data/catalog/windows.json`. After replacing it:

```bash
pnpm catalog:split
```

The script writes `apps/web/public/catalog/windows/`, removes stale collection files and is
deterministic: collections are sorted by id, properties keep source order and no timestamps
are written.

Verify a checkout without writing:

```bash
pnpm catalog:check
```

Both commands accept `--source <file>` and `--out <dir>`.

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

1. Replace `data/catalog/windows.json`.
2. Run `pnpm catalog:split`.
3. Run `pnpm catalog:check`.
4. Review the generated diff and commit it with the source change.
5. Deploy the web Worker; the catalogue is part of its assets.

The catalogue is static. Changing it does not change existing policies until a policy is
saved with a new selection.

## Next

- [Policies](/manage/policies)
- [Apple DDM](/platforms/apple/ddm)
- [Windows policies](/platforms/windows/policies)
