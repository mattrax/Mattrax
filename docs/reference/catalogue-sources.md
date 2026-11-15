# Catalogue sources

The designer's settings catalogue is compiled from vendor-published schemas by
`scripts/catalog-sync/`. This page records which source each platform uses, why, and the
licensing caveats that come with the generated data.

The original research was done for the standalone `configure` project on 2026-10-14. URLs
and formats below were verified against the live sources at that time; re-check them if a
sync starts failing.

## Apple

**Source:** [`apple/device-management`](https://github.com/apple/device-management), branch
`release`.

- The repository is MIT-licensed (`LICENSE.txt`).
- `mdm/profiles/*.yaml` contains classic configuration-profile payloads. Payload keys are
  listed under `payloadkeys`, with the payload type in `payload.payloadtype`.
- `declarative/declarations/**/*.yaml` contains DDM declarations. These use
  `payload.declarationtype`; shared envelope keys live in `declarationbase.yaml`.
- `mdm/profiles/CommonPayloadKeys.yaml` supplies the classic profile envelope.
- Each key carries its type, presence, default, range, `rangelist`, supported OS versions
  and documentation. The adapter turns these into the normalised `Property` shape.

The sync downloads the branch tarball:

```
https://codeload.github.com/apple/device-management/tar.gz/refs/heads/release
```

Apple also points at `ProfileManifests/ProfileManifests` for classic profiles. That project
has **no licence file**, so the catalogue deliberately uses Apple's MIT-licensed repository
instead. Do not add ProfileManifests output without a licence review.

## Android

**Source:** the public Android Management API discovery document:

```
https://androidmanagement.googleapis.com/$discovery/rest?version=v1
```

- The document is JSON and needs no authentication. Its `revision` is a `YYYYMMDD` date,
  which the sync records in the manifest.
- `schemas.Policy` is the resource applied through `enterprises.policies.patch`.
- Each property may reference another schema with `$ref`; arrays reference their item type
  through `items.$ref`. The adapter recurses through objects and array items, follows
  references and stops on cycles or excessive depth.
- `enum` and `enumDescriptions` are parallel arrays; `format: "date-time"` and
  `format: "byte"` become date and data properties.
- Use of the document is covered by the Google APIs Terms of Service.

## Windows

**Source:** the Microsoft Graph Intune Settings Catalog, via the nightly public dump at
[`royklo/IntuneSettingsCatalogData`](https://github.com/royklo/IntuneSettingsCatalogData).

- `settings.json` is an array of `deviceManagementConfigurationSettingDefinition` objects.
- `categories.json` supplies the display names and parent categories used to group
  settings into collections.
- Each setting carries `baseUri` and `offsetUri`; concatenated, they are the OMA-URI /
  SyncML `LocURI` the designer emits.
- The adapter keeps `windows10` settings whose `baseUri` starts with `./`, maps Graph value
  types to catalogue types, and derives scope from `/User/` in the address.
- `last-updated.json` supplies the revision shown in the manifest.

The old `MicrosoftDocs/windows-itpro-docs` repository is gone (HTTP 404). The authoritative
CSP prose now lives as rendered HTML on `learn.microsoft.com`, which is why the catalogue
links each setting out to the relevant CSP or policy page rather than ingesting that prose.

The upstream dump declares **no licence**. The data originates from Microsoft Graph, but
redistribution terms are not stated by the mirror. Treat the generated Windows catalogue as
a stored copy of Microsoft Graph data and review the terms before redistributing it outside
Mattrax.

## Third-party applications

**Source:** `data/catalog/third-party-apps.json`, copied verbatim to
`apps/web/public/catalog/third-party-apps.json` for the designer.

This is a curated catalogue, not a wholesale import:

- Apple managed-preference keys and descriptions follow
  [`ProfileManifests`](https://github.com/ProfileManifests/ProfileManifests) (the manifests
  behind iMazing Profile Editor and ProfileCreator) and the
  [`ProfileManifestsMirror`](https://github.com/Jamf-Custom-Profile-Schemas/ProfileManifestsMirror)
  Jamf JSON renders. ProfileManifests itself has no licence file, so only the small set of
  keys Mattrax ships is transcribed — no upstream data file is redistributed.
- Windows keys use Google Chrome and Microsoft Edge ADMX through Microsoft's Policy CSP;
  each entry carries the full OMA-URI.
- Android keys are each app's AppConfig/Managed Google Play managed configuration.
- `sources` in the JSON records the vendor documentation and the ProfileManifests projects.
- Tests validate the schema and every compiled platform artefact; adding an application is
  a data edit.

## Licensing summary

| Platform | Upstream licence             | Notes                                            |
| -------- | ---------------------------- | ------------------------------------------------ |
| Apple    | MIT                          | Safe to redistribute with attribution.           |
| Android  | Google APIs Terms of Service | Public discovery document; follow the API terms. |
| Windows  | Not declared by the mirror   | Microsoft Graph output; licensing needs review.  |

The sync code itself is part of this repository. The generated JSON keeps the upstream
source URL and revision in `manifest.json` so provenance travels with the data.

## Reproducing a sync

```bash
pnpm catalog:sync
pnpm catalog:check
```

`catalog:sync` writes the raw Windows catalogue to `data/catalog/windows.json`, then reuses
`scripts/split-policy-catalog.mjs` to produce the per-collection browser assets. The split
is deterministic; only changed upstream settings and the manifest timestamp should differ.

If a source changes shape, the adapter will fail loudly rather than write a partial
catalogue. Fix the adapter and re-run the sync; do not patch generated files by hand.
