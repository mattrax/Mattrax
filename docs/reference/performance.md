# Performance and accessibility budgets

Mattrax ships static guards for the two regressions that hurt page experience most:
layout-shifting media and layout-animating motion. Lighthouse CI records the lab
budgets for the public pages.

## Lighthouse CI

```sh
pnpm lighthouse
```

`pnpm lighthouse` runs `lhci autorun` with `startServerCommand: "pnpm web dev"`,
so the dev server must be able to bind `http://localhost:9050`. The command starts
it automatically and stops it afterwards. Reports are written to
`.lighthouseci/` (ignored by Git). Locally each page is sampled once; CI samples
each page three times and uses the median.

The public pages covered are:

- `/`
- `/login`
- `/register`
- `/designer`

Authenticated dashboard pages (`/t/:tenantId/...`) are **not** covered by the
public Lighthouse CI run yet: they need a seeded tenant and a signed-in session,
which the current anonymous run does not provision.

### Budgets

All assertions are errors in `packages/config/lighthouserc.cjs`. The categories are Lighthouse's
mobile, simulated-throttling preset.

| Assertion                | Budget   |
| ------------------------ | -------- |
| `performance`            | score 1  |
| `accessibility`          | score 1  |
| `best-practices`         | score 1  |
| `seo`                    | score 1  |
| `agentic-browsing`       | score 1  |
| Largest Contentful Paint | ≤ 1.5 s  |
| Cumulative Layout Shift  | ≤ 0.01   |
| Total Blocking Time      | ≤ 150 ms |
| First Contentful Paint   | ≤ 1.2 s  |
| Console errors           | 0        |

### Production baseline (2026-11-14)

Recorded against `https://e.mattrax.app` with Lighthouse 13.6.0:

| Page        | Performance | LCP       | CLS |
| ----------- | ----------- | --------- | --- |
| `/`         | 100         | 0.9–1.1 s | 0   |
| `/login`    | 100         | 0.9–1.1 s | 0   |
| `/register` | 100         | 0.9–1.1 s | 0   |
| `/designer` | 100         | 0.9–1.1 s | 0   |

Category, accessibility, SEO and agentic-browsing scores were repaired after that
recording. A local Lighthouse 13.6.0 run on 2026-11-14 reports **1 for
performance-independent categories on every public page**:

| Page        | Perf | A11y | Best practices | SEO | Agentic | CLS   |
| ----------- | ---- | ---- | -------------- | --- | ------- | ----- |
| `/`         | 69*  | 100  | 100            | 100 | 100     | 0.002 |
| `/login`    | 73*  | 100  | 100            | 100 | 100     | 0     |
| `/register` | 73*  | 100  | 100            | 100 | 100     | 0     |
| `/designer` | 70*  | 100  | 100            | 100 | 100     | 0.001 |

*Dev-server performance numbers; production remains 100.

### Local limitation

The budgets are production budgets. A local run against `pnpm web dev` cannot
meet the timing budgets even when the production build scores 100: dev mode
serves unbundled modules with HMR, and the bundled preview serves uncompressed
CSS and JavaScript. On a development machine the same pages measure roughly
2.2–2.6 s FCP/LCP and 0.9–1.1 s TBT, while CLS and every non-performance category
still pass. Treat local performance failures as an asset-serving and dev-mode
artefact, not a regression; use the production baseline above for the real
numbers. The CI job is therefore advisory until the preview server compresses
assets (or the job targets a deployed preview environment).

## Static guards

`tools/oxlint/anti-slop` runs through `pnpm lint` (and `vp lint`). Two rules
target the layout-shift and jank sources directly:

- `anti-slop/no-layout-animating-transition` rejects `transition-all`,
  `transition-[...]` property lists that include width, height, inset, margin,
  padding or gap, and `animate-[...]` values that begin with one of those
  properties. Animate `transform` and `opacity` instead
  (`transition-transform`, `transition-[transform,opacity]`, `animate-spin`).
  `transition-colors` and `transition-shadow` are valid and are not flagged.
- `anti-slop/require-media-dimensions` requires `<img>`, `<video>` and
  `<iframe>` to reserve their box with explicit `width`/`height` attributes, an
  `aspect-ratio` style or `aspect-*` class, or fixed `h-`/`w-`/`size-` classes.
  Empty or spread-only media is ignored because the values cannot be proven
  statically.

Both rules have table-driven tests under
`tools/oxlint/anti-slop/rules/*.test.ts`; `pnpm test` includes them.

### Accessibility rules

The same oxlint config enables eslint-plugin-jsx-a11y's recommended rules
(`jsx-a11y/*`) for SolidJS JSX. Four rules are intentionally off:

- `label-has-associated-control` — Solid uses `for`, not React's `htmlFor`, and
  the shared `<Label>` primitive forwards its association through spread props,
  so the rule reports every label. Re-enable if upstream learns `for`.
- `control-has-associated-label` — off in the upstream recommendation and noisy
  for components whose children are dynamic.
- `prefer-tag-over-role` — suggests replacing deliberate `role="status"` live
  regions and Kobalte `role="group"` containers with elements that change the
  layout.
- `anchor-ambiguous-text` — off upstream and advisory only.

The remaining violations are real violations to fix, not suppressed with
comments.

## Dashboard cache and cross-tab sync

Each dashboard tab keeps its own TanStack Query cache, so the client is the only
thing that can make two tabs agree without a refetch of everything. A single
`BroadcastChannel` (`mattrax:query-cache`, with a `storage`-event fallback where the
channel is unavailable) shares mutations across tabs:

- A successful mutation broadcasts one invalidation for the active tenant. The
  sender coalesces everything queued within a 40 ms window, so a 50-row bulk action
  sends one message rather than fifty.
- Messages carry the sending tab id and are ignored by that tab. Up to 24 distinct
  query keys travel as a key list; beyond that the sender asks for one tenant-scope
  invalidation, which the receiver applies with a query-key predicate.
- Receivers run `invalidateQueries` on the affected keys and never mount queries of
  their own, so a background tab with no visible list does not fetch anything.
- Sign-out broadcasts a reset so a shared browser cannot leave a signed-out tab
  showing device data.

The channel does not replace server push: it covers this browser's tabs, while push
covers other users and machines. The dashboard does not poll; an idle tab picks up
changes when a sibling tab mutates something or when the page is revisited.

## Device health in the list

Health is derived per device from declarations and inventory, and it is not stored.
The list computes it once per response. `/devices/search` reads declarations for the
returned page only unless a `health` filter is active: that filter has to load every
SQL-matched device and its declarations before it can slice the page, which is the cost
that will be removed by storing the rollup. A `health` sort loads the filtered set, sorts
by severity in memory and slices the page; filtering by health uses the same rollup, so
the column, the filter and the fleet counts cannot disagree. The unpaginated `/devices` listing omits health, which keeps a
whole-fleet read free of declaration joins.

## Theme resolution

The theme preference (`system`, `light` or `dark`) is read from `localStorage` by a
blocking inline script in `<head>`, before the stylesheet paints and before the
hydration bundle runs. The script sets the `dark` class, `color-scheme` and the
`theme-color` meta; the first paint therefore matches the resolved theme and no
layout-affecting style swap happens after paint. The script is a few hundred bytes and
is inlined, so it costs no extra request. `prefers-color-scheme` is consulted only
while the preference is `system`, and the client listens for OS changes.

The preference is keyed by user id (`mattrax:theme:<userId>`) with a device-wide
`mattrax:theme` fallback, which is what pre-auth pages and the first paint read before
the session resolves. A second device starts from `system` until the preference is
persisted server-side; that needs a schema change and is not part of this pass.

The palette itself is static CSS custom properties from a vendored Radix Colors scale
layer (`apps/web/src/styles/radix-colors.css`), mapped to semantic tokens in
`apps/web/src/app.css`. Switching themes therefore changes no markup and re-renders
nothing in JavaScript: one class on `<html>` swaps every token.

The landing page, auth pages, dashboard and enrollment flow all read these tokens, and
`apps/web/src/styles/theme-literals.test.ts` fails on a new raw colour literal so they
cannot regress one at a time. Surfaces that deliberately do not follow them:

- **Documentation** is a separate Rspress build with its own palette and light/dark
  toggle; it does not import `app.css`.
- **Email templates** are rendered by the API Worker as inline-styled HTML.
- **Third-party pages** (Stripe billing portal, PostHog surveys) own their appearance.

## Without JavaScript

The public surface is server-rendered and does not depend on hydration:

- The landing page, `/privacy`, `/terms` and the 404 page are rendered by the
  Worker and remain readable with scripting disabled.
- Documentation is pre-rendered by Rspress; the reading pane, sidebar and every
  internal link work without JavaScript. The search dialog and the light/dark
  toggle are the only docs features that need it.
- The dashboard renders a styled fixed notice instead of an empty shell. It explains
  why the page needs JavaScript, links to the docs and support, covers the whole
  viewport so no half-rendered dashboard is visible, and uses inline `light-dark()`
  colours so it follows the OS theme even when the stylesheet failed to load.

`tests/e2e/metadata.spec.ts` drives the public pages in a browser context with
`javaScriptEnabled: false` to keep this working. The deliberate limitation is
the dashboard itself: devices, policies and enrollment data are fetched in the
browser, so there is no server-rendered fallback for the authenticated app.

## Fleet query benchmarks

`pnpm bench:fleet -- --devices 100000` seeds a disposable tenant with synthetic
devices and times the SQL shapes the dashboard uses. It prints each query and an
`EXPLAIN` for the first page, and removes the tenant afterwards unless `--keep`
is passed. Run it against a development database only.

The 20,000-device run on 2026-11-16 (local MySQL 8, warm buffer pool) shows the
value of the composite fleet indexes added in the same change:

| Query                                       | Before  | After   |
| ------------------------------------------- | ------- | ------- |
| Count fleet                                 | 2.0 ms  | 2.0 ms  |
| First page by name                          | 25.3 ms | 1.5 ms  |
| First page by last seen                     | 20.9 ms | 1.0 ms  |
| Status filter + name page                   | 23.6 ms | 0.9 ms  |
| Stale-device filter                         | 19.9 ms | 0.8 ms  |
| Substring search                            | 5.9 ms  | 5.5 ms  |
| Full tenant scan (health/dashboard rollups) | 40.5 ms | 39.3 ms |

The last row is the remaining scaling gap: health, dashboard rollups and dynamic
groups still evaluate the tenant's devices in application code. At 20k devices a
scan is ~40 ms; the fix is a stored, indexed health rollup updated on check-in
and inventory changes, tracked separately.

## MDM and API cache policy

Device-facing bodies are served by the API Worker (`apps/api`), not the dashboard Worker, so
they set their own `Cache-Control`:

- Certificate assets (`/mdm/apple/assets/*`) are bound to a signed, expiring URL and the
  declaration carries the bytes' SHA-256, so they use
  `private, max-age=600, stale-while-revalidate=600`.
- Legacy profiles (`/mdm/apple/profiles/*`) keep a stable URL across policy edits, so they
  use `private, no-cache`: a device may store the response but must revalidate before
  applying old restrictions.
- Authenticated `/api/*` responses default to `no-store` (`withDefaultNoStore` in
  `apps/api/src/observability.ts`). A route that sets its own policy keeps it.
- Uploaded applications and policy files are stored under keys that contain their SHA-256,
  so their R2 metadata is `private, max-age=31536000, immutable`. Backups are the exception:
  they are tenant snapshots and use `private, no-store`.

Keeping assets `private` preserves tenant and device binding even if a bucket is ever
exposed directly; the signed URL remains the capability that authorises a fetch.
