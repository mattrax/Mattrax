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

`packages/config/oxlint` runs through `pnpm lint` (and `vp lint`). Two rules
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
`packages/config/oxlint/rules/*.test.ts`; `pnpm test` includes them.

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

Device-facing bodies are served by the API Worker (`apps/cloud`), not the dashboard Worker, so
they set their own `Cache-Control`:

- Certificate assets (`/mdm/apple/assets/*`) are bound to a signed, expiring URL and the
  declaration carries the bytes' SHA-256, so they use
  `private, max-age=600, stale-while-revalidate=600`.
- Legacy profiles (`/mdm/apple/profiles/*`) keep a stable URL across policy edits, so they
  use `private, no-cache`: a device may store the response but must revalidate before
  applying old restrictions.
- Authenticated `/api/*` responses default to `no-store` (`withDefaultNoStore` in
  `apps/cloud/src/observability.ts`). A route that sets its own policy keeps it.
- Uploaded applications and policy files are stored under keys that contain their SHA-256,
  so their R2 metadata is `private, max-age=31536000, immutable`. Backups are the exception:
  they are tenant snapshots and use `private, no-store`.

Keeping assets `private` preserves tenant and device binding even if a bucket is ever
exposed directly; the signed URL remains the capability that authorises a fetch.

## Dashboard API latency

Dashboard pages issue several independent API calls, and each one resolves the
session, tenant, membership and role before its handler runs. At a local socket
that cost is invisible; against a production MySQL instance (20–60 ms per round
trip) every sequential query is tens of milliseconds of page load.

`apps/cloud/scripts/api-bench.ts` measures the real preview/HTTP path against a
seeded tenant and reports **SQL commands per endpoint** alongside wall time. Pair
it with `apps/cloud/scripts/db-latency-proxy.ts` to model production latency:

```sh
# terminal 1 — 40 ms round trip, one query = one round trip
pnpm exec tsx apps/cloud/scripts/db-latency-proxy.ts --latency 40 --port 3307

# terminal 2 — point local dev at the proxy
MATTRAX_DEV_DATABASE_URL=mysql://mattrax:mattrax@127.0.0.1:3307/mattraxe pnpm cloud dev

# terminal 3 — seed once, then measure (median of 5 runs after 2 warm-ups)
pnpm exec tsx apps/cloud/scripts/api-bench.ts --reseed --runs 5 --out bench/final-40ms.json
```

The proxy counts `COM_QUERY`/`COM_STMT_PREPARE` packets, so the numbers include
authentication, tenant resolution, handler queries and background writes. It
delays the first packet of each response by half the RTT in each direction; a
large result set streams at bandwidth, as it does in production. Without the
proxy the script falls back to `SHOW GLOBAL STATUS LIKE 'Questions'`.

### Results (2026-11-18, 500 devices)

`before` is `oscar/o/api-performance` at the commit this work started from;
`after` includes the changes below. Local ms is a 0 ms proxy (medians are noisy
under workerd); the 40 ms column is the production model.

| Endpoint                                       | Queries before → after | Local ms before → after | +40 ms before → after |
| ---------------------------------------------- | ---------------------: | ----------------------: | --------------------: |
| `GET /v1/tenants`                              |                11 → 10 |             18.8 → 18.5 |         518.1 → 465.3 |
| `GET /v1/tenants/:id`                          |                12 → 10 |               22 → 16.1 |         538.9 → 464.5 |
| `GET /v1/tenants/:id/security`                 |                12 → 10 |             16.8 → 18.8 |         550.9 → 471.8 |
| `GET /v1/tenants/:id/devices`                  |                17 → 15 |             37.6 → 35.4 |         819.3 → 694.1 |
| `GET devices/search (page)`                    |                21 → 18 |             21.1 → 21.2 |         945.1 → 666.4 |
| `GET devices/search (text q)`                  |                21 → 18 |                 20 → 20 |         972.5 → 676.6 |
| `GET devices/search (health sort)`             |                21 → 18 |             33.8 → 35.8 |         985.7 → 750.1 |
| `GET devices/search (structured query)`        |                21 → 18 |             21.9 → 29.3 |         974.8 → 650.2 |
| `GET /devices/:id`                             |                19 → 16 |             16.8 → 30.3 |         872.6 → 694.5 |
| `GET /devices/:id/health`                      |                16 → 14 |             15.7 → 22.4 |           738 → 621.2 |
| `GET /devices/:id/activity`                    |                17 → 15 |             16.2 → 19.7 |         781.2 → 618.2 |
| `GET /devices/:id/applications`                |                14 → 12 |             15.5 → 15.8 |         648.7 → 541.2 |
| `GET /devices/:id/users`                       |                14 → 12 |             14.7 → 16.3 |         631.7 → 556.8 |
| `GET /device-health`                           |                15 → 13 |             26.7 → 23.9 |         699.6 → 553.9 |
| `GET /v1/tenants/:id/policies`                 |                24 → 21 |               26.6 → 25 |            1104 → 743 |
| `GET /policies/:id`                            |                14 → 12 |             17.6 → 13.5 |         623.3 → 537.8 |
| `GET /policies/:id/assignments`                |                20 → 18 |             17.1 → 18.2 |         915.3 → 660.2 |
| `GET /policies/:id/deployments`                |                14 → 12 |               14.9 → 17 |         645.6 → 542.5 |
| `GET /v1/tenants/:id/groups`                   |                15 → 13 |             16.2 → 20.8 |           689 → 587.6 |
| `GET /groups/:id`                              |                17 → 15 |             16.4 → 20.5 |           769.4 → 593 |
| `GET /v1/tenants/:id/applications`             |                16 → 14 |               16 → 16.8 |           729.8 → 619 |
| `GET /applications/inventory`                  |                13 → 11 |             21.4 → 26.7 |         607.3 → 509.8 |
| `GET /applications/:id`                        |                18 → 16 |             17.2 → 17.7 |         829.9 → 660.2 |
| `GET /v1/tenants/:id/accounts`                 |                14 → 12 |             16.2 → 19.3 |         638.3 → 504.6 |
| `GET /v1/tenants/:id/directory`                |                15 → 13 |               15 → 20.2 |         686.7 → 542.9 |
| `GET /v1/tenants/:id/dashboards`               |                14 → 12 |             14.7 → 16.6 |           641 → 550.8 |
| `GET /v1/tenants/:id/audit-log`                |                13 → 11 |             15.4 → 17.9 |         600.4 → 489.4 |
| `POST dashboard-query (count all)`             |                15 → 11 |             26.1 → 18.1 |         695.2 → 497.7 |
| `POST dashboard-query (count attention)`       |                15 → 13 |             21.3 → 21.8 |         701.2 → 564.5 |
| `POST dashboard-query (pie platform)`          |                16 → 13 |                 35 → 20 |           758.2 → 569 |
| `POST dashboard-query (table attention)`       |                16 → 13 |             37.5 → 20.6 |         756.2 → 564.5 |
| `POST dashboard-query/batch (default widgets)` |                 — → 13 |                — → 23.4 |             — → 565.3 |

The default overview renders four stat widgets, one pie and one table. Before,
that was five `dashboard-query` calls, each loading the tenant's devices,
declarations and ADE state: **85 queries across the 7 requests the page makes**
and ~3.8 s serial at 40 ms. The batch endpoint answers all six widgets in **one
request and 13 queries**, so the page (shell + health summary + dashboards +
widgets) is 4 requests and ~2.1 s serial, and the slowest request on the
critical path is ~565 ms.

### What changed

- Tenant resolution reads membership, organisation and (for custom roles) the
  role row in **one join** instead of three sequential queries, and the tenant
  switcher no longer runs one role query per tenant.
- `GET /v1/me` derives `mfaRequired` from the memberships it already loads.
- Independent reads on the device list/search, device detail, policy list,
  policy assignments, groups, applications, accounts and directory paths run in
  **one wave** (`Effect.all` with unbounded concurrency). `GET /policies`
  dropped from ~15 sequential waves to five; device search from seven to two.
- Device health is derived from the ADE setup-state rows the page already
  fetches, removing a duplicate `device_apple` read.
- Device detail loads the device, Apple and Android rows with one join.
- `POST /v1/tenants/:tenantId/dashboard-query/batch` evaluates up to 24 widget
  queries against one device snapshot. Unfiltered stat cards use `COUNT(*)`
  instead of loading rows.
- An API token's `last_used_at` is refreshed at most every five minutes instead
  of on every bearer-authenticated request.
- New indexes: `audit_log (organization_id, target_type, target_id, created_at)`
  for the device activity feed and `device_command (device_id, updated_at)` for
  its command page. `EXPLAIN` moves the audit read from the tenant-wide stream
  to the target's rows, and the command read from a filesort to a backward index
  scan.

### Remaining bottlenecks

- **Per-request service graph.** A Workers request cannot reuse I/O objects, so
  `createApiRuntime` rebuilds the graph: ~7 statements before the handler runs
  (six `information_schema` checks from `@yielded/auth-persistence`'s storage
  validation plus a connection probe). That is the majority of each ~500 ms
  request at 40 ms RTT. The fix belongs upstream: cache the validated schema
  metadata per isolate, keyed by dialect and database, instead of per
  acquisition.
- **Derived device health.** Health (stale/MIA/declaration/FileVault rules) is
  computed in TypeScript, so filtered dashboard queries and the attention queue
  still load the fleet's device + declaration rows. Moving the rules into SQL
  (or a materialised health column maintained on check-in) is the next step.
- **Free-text device search** uses `LIKE '%term%'`, which cannot use an index;
  it is the slowest search variant even after the round-trip reduction.
- **Dashboard overview shell.** `me`, `tenants`, `tenant`, `device-health` and
  the dashboard document are still separate requests. The batch endpoint covers
  the widgets; combining the shell would cut three more request bootstraps.

### Frontend follow-up

`apps/web` still calls `queryDashboard` once per widget. Switching the widget
grid to `enterprise.queryDashboardBatch(tenantId, { queries })` (one call for
the whole grid, results in request order) is the change that realises the batch
numbers. Stat widgets should keep sending `countOnly: true`.
