# CIS benchmark templates

Mattrax ships reviewed mappings from CIS benchmarks to policy settings. An administrator can
start a new policy from a benchmark or apply one to an existing policy, choose which controls
to include, and then tune the result in the designer.

The templates are **not** a copy of a CIS benchmark. They contain the benchmark reference,
our own short description of each control, and the catalogue setting(s) that implement it.
The CIS document remains the authoritative text and must be obtained from CIS under its own
licence.

## Where the files live

| Path                                         | Committed | Purpose                                    |
| -------------------------------------------- | --------- | ------------------------------------------ |
| `data/cis/<template-id>.json`                | Yes       | Hand-reviewed source templates             |
| `apps/web/public/catalog/cis/<template-id>.json` | Yes   | Compiled, validated assets the UI loads    |
| `apps/web/public/catalog/cis/index.json`      | Yes       | Benchmark summaries and coverage counts    |
| `apps/web/scripts/generate-cis-templates.ts`  | Yes       | Validator and generator                    |

The source templates are the only files to edit. Run the generator after changing one.

## Template format

A source template is JSON with a versioned envelope:

```json
{
  "format": 1,
  "id": "windows-11-enterprise-3.0.0",
  "platform": "windows",
  "benchmark": {
    "name": "CIS Microsoft Windows 11 Enterprise Benchmark",
    "version": "3.0.0",
    "source": "https://www.cisecurity.org/benchmark/microsoft_windows_desktop",
    "os": "Windows 11"
  },
  "description": "Our own overview of what this template covers.",
  "controls": [
    {
      "id": "1.1.1",
      "level": "L1",
      "title": "Password history",
      "description": "Require users to cycle through previously used passwords.",
      "mappings": [
        {
          "collection": "windows/settings/device-lock",
          "setting": "PasswordHistorySize",
          "value": 24
        }
      ]
    }
  ]
}
```

| Field                 | Required | Notes                                                            |
| --------------------- | -------- | ---------------------------------------------------------------- |
| `format`              | Yes      | Currently `1`.                                                   |
| `id`                  | Yes      | Stable slug; also the generated file name. Must be unique.       |
| `platform`            | Yes      | `apple`, `windows` or `android`.                                |
| `benchmark.name`      | Yes      | Benchmark family.                                                |
| `benchmark.version`   | Yes      | Benchmark revision.                                              |
| `benchmark.source`    | Yes      | Public landing page for the benchmark.                           |
| `benchmark.os`        | No       | Short OS label shown in the picker.                              |
| `description`         | Yes      | Our own summary; never copied CIS prose.                         |
| `controls[].id`       | Yes      | CIS recommendation reference. Unique within a template.         |
| `controls[].level`    | No       | `L1` or `L2`.                                                    |
| `controls[].title`    | Yes      | Short name in our own words.                                     |
| `controls[].description` | Yes   | What the control does, in our own words.                         |
| `controls[].note`     | No       | Why a control is unmapped, or a caveat about the mapping.        |
| `controls[].mappings` | Yes      | May be empty. An empty list means **unmapped**, not "invented".  |

### Mappings

Each mapping names a catalogue collection and property:

- **Apple** — the profile payload collection, for example
  `apple/profiles/com.apple.applicationaccess`, and its property key.
- **Windows** — the settings collection, for example `windows/settings/device-lock`, and its
  property key. When the key repeats in a collection (the firewall exposes `EnableFirewall`
  once per profile), the mapping must also carry `address`, the exact OMA-URI.
- **Android** — `android/policy/Policy` and the Android Management API field.

`value` must match the catalogue type: boolean, whole number, number, string, enum value,
list, dictionary or base64 data. Integer ranges and enum members are checked against the
committed catalogue, so a setting that is removed or a value that is out of range fails the
build instead of producing a policy that silently does nothing.

A control can map several settings. A benchmark can map the same setting from more than one
control; applying both is idempotent. A control with no mapping is retained with
`"mapped": false` and an optional `note`.

## Generating and checking

```bash
pnpm cis:templates   # validate and write apps/web/public/catalog/cis
pnpm cis:check       # fail if the committed assets are stale
```

Both commands read only committed files: `data/cis/*.json`, `data/catalog/windows.json`,
`apps/web/public/catalog/apple.json` and `apps/web/public/catalog/android.json`. They make no
network requests, and the output is deterministic (sources sorted by file name, controls in
source order, no timestamps). Re-run `pnpm catalog:sync` first if the underlying catalogue
changed.

## Applying a template

- **New policy** — *Policies → Create policy → Start from a template*. Choose a benchmark,
  choose controls, then create the policy. The app writes the designer draft and generated
  configurations in the create request, so the template is durable across browsers.
- **Existing policy** — in the policy designer, use **Apply template** in the header or the
  **Start from a CIS benchmark** card. The dialog shows the benchmark, coverage, every
  control and its mapped settings.

Applying merges into the active platform only:

- settings named by the template are written to their collection;
- every other value on the policy, including settings on other collections, is preserved;
- if the same setting already has a different value, the template value wins because the
  administrator explicitly applied it;
- a new collection is added with the catalogue defaults, then the mapped values are set;
- on Apple, a profile template cannot be applied to a policy that already contains DDM
  declarations (and the reverse), because the designer cannot mix the two.

Unmapped controls are visible and selectable as information, but they contribute no settings.

## Current coverage

These totals are for the **reviewed controls listed in each source template**, not the total
number of recommendations in the full CIS document. The source deliberately lists controls
that cannot be mapped so the gap is visible.

| Platform | Template                               | Mapped / listed | Settings |
| -------- | -------------------------------------- | --------------- | -------- |
| Windows  | CIS Windows 11 Enterprise 3.0.0        | 162 / 186       | 162      |
| macOS    | CIS Apple macOS 15.0 Sequoia 1.0.0     | 30 / 88         | 35       |
| Android  | CIS Google Android 1.6.0               | 15 / 38         | 15       |

Windows maps the largest share because the Intune settings catalogue exposes most security
options directly. macOS has many recommendations that are filesystem state, audit daemon
configuration, or per-user preferences with no profile key. Android has many
recommendations that are Google account settings or on-device UI an EMM cannot control.

## Updating a benchmark

1. Obtain the new CIS benchmark and review the changed recommendations.
2. Edit the matching file in `data/cis/`. Keep the reference, but write titles and
   descriptions in our own words; do not copy CIS text.
3. Remove or update mappings the catalogue no longer supports. Add `note` text when a
   control stays unmapped.
4. Run `pnpm cis:templates` and review the generated diff.
5. Run `pnpm cis:check`, the co-located tests and `pnpm typecheck`.
6. Commit the source and generated files together.

When a new catalogue release changes a property key, type or range,
`pnpm cis:templates` fails with the exact control, collection and setting. That is the
intended maintenance loop.

## Limitations

- The templates are a reviewed subset, not a full benchmark import. A control omitted from
  `data/cis` is not shown at all; a control included with no mapping is shown as unmapped.
- Tenant-specific text (login banners, lock-screen messages, administrator account names) is
  never generated. Those controls stay unmapped.
- macOS profile templates do not mix with DDM declarations. Safari privacy settings and some
  newer controls are only available as declarations, so they are listed as unmapped here.
- Windows settings that the catalogue exposes twice under one address (for example the
  numeric inactivity timeout behind an enable toggle) cannot be addressed by the designer and
  stay unmapped.
- User-scoped Windows settings (lock-screen spotlight, attachment zone information, Copilot)
  are listed but unmapped: the designer saves one device-scoped configuration, and the server
  rejects mixing `./User/` OMA-URIs into it. Add those controls through the policy editor,
  which can set a user scope.
- Android account-level Google settings (activity controls, ads personalisation, YouTube
  history) are outside the Android Management API and stay unmapped.
- Applying a template never deletes settings. Removing a template from a policy is a manual
  edit in the designer.

## Related

- [Policy catalogue](/reference/policy-catalogue)
- [Catalogue sources](/reference/catalogue-sources)
- [Policies](/manage/policies)
