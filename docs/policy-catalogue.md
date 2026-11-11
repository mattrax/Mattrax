# Policy catalogue

The policy designer on `/designer` and in the dashboard reads its settings from
static files under `apps/web/public/catalog`. Apple and Android ship as one file
each; the Windows catalogue is split so browsing it does not download the whole
dataset.

## What ships

| File                            | Size    | Loaded when                                                                   |
| ------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `manifest.json`                 | ~240 KB | On every designer mount (platforms and counts).                               |
| `apple.json`                    | ~2.2 MB | The Apple tab is opened.                                                      |
| `android.json`                  | ~270 KB | The Android tab is opened.                                                    |
| `windows/index.json`            | ~150 KB | The Windows tab is opened.                                                    |
| `windows/<collection-key>.json` | ~20 KB  | A Windows collection is selected, or a template or saved draft references it. |
| `windows/search.json`           | ~6.9 MB | The first non-empty search query on the Windows tab.                          |

`windows/index.json` holds one summary per collection (`id`, `key`, `name`,
`identifier`, `group`, `kind`, `surface`, `deprecated`, `minOs`,
`propertyCount`) and is all the browse list needs. Selecting a collection fetches
`windows/<key>.json`, which contains the full property list. Searching fetches
`windows/search.json`, which maps each collection to the lowercased text of its
settings; results link back to collection files, so only collections the user
opens are downloaded in full.

The uncompressed Windows payload is still about 20 MB in total, but a visit that
browses and configures a handful of settings now transfers roughly 150 KB plus a
few tens of kilobytes per collection, instead of the previous 17 MB file. The
search index is fetched once per session and is never requested for browsing.

Apple and Android behaviour is unchanged: `loadPlatformIndex` and
`loadSearchIndex` derive their data from the single platform file.

## Regenerating the split

The source catalogue lives outside the served assets at
`data/catalog/windows.json`. After replacing it, rebuild the split and commit the
result:

```bash
pnpm catalog:split
```

The script (`scripts/split-policy-catalog.mjs`) writes
`apps/web/public/catalog/windows/`, removes stale collection files, and is
deterministic: collections are sorted by id, properties keep the source order and
no timestamps are written. Verify a checkout without writing anything with:

```bash
pnpm catalog:check
```

Both commands accept `--source <file>` and `--out <dir>` for one-off runs.

## Loader API

`apps/web/src/lib/policy-designer/catalog.ts` exposes:

- `loadManifest()` — platform metadata and statistics.
- `loadPlatformIndex(platform)` — summaries for browse and collection-name search.
- `loadCollection(platform, collectionId)` — one full collection, cached.
- `loadSearchIndex(platform)` — per-property search text, cached.
- `searchCollections(summaries, query)` and `searchIndexProperties(index, query)` —
  pure helpers the designer combines into browse results.
- `resetPlatformCache(platform)` — drops every cached response so the Retry
  button can re-fetch.

Collection files are named with the collection id where `/` becomes `--`
(`windows/settings/above-lock` → `windows--settings--above-lock.json`), which the
generated index records in each summary's `key`.
