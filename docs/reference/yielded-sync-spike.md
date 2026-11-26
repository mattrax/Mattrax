# Yielded Sync evaluation

This is a decision document for the saved-device-view migration on branch
`oscar/o/yielded-sync-spike`. It is not a production rollout plan.

## Scope

Mattrax previously exposed five JSON endpoints for saved device views:

- `GET /api/v1/tenants/:tenantId/device-views`
- `POST /api/v1/tenants/:tenantId/device-views`
- `PATCH /api/v1/tenants/:tenantId/device-views/:viewId`
- `DELETE /api/v1/tenants/:tenantId/device-views/:viewId`
- `PUT /api/v1/tenants/:tenantId/device-views/default`

The spike removes those routes and makes two Yielded Sync sources authoritative:

| Source                  | Identity            | State                                 | Actions                             |
| ----------------------- | ------------------- | ------------------------------------- | ----------------------------------- |
| `device-views-tenant`   | tenant id           | Tenant-published views                | create, update, delete              |
| `device-views-personal` | tenant + account id | Private views and the account default | create, update, delete, set default |

The browser merges both replicas into the existing TanStack Query cache. The UI keeps
its current shape, but reads and writes now use a persistent WebSocket instead of HTTP.
There is no feature flag and no HTTP fallback.

Saved views were chosen because their entire authority boundary is small and isolated:
no MDM protocol, cron, integration or agent reads or writes the backing tables. Groups,
attributes, fleet migrations, approvals and deployment status all have broader writer
sets and would be materially harder cutovers.

## Current setup versus Sync

Mattrax already has realtime infrastructure. The comparison is not simply HTTP versus
WebSockets.

| Dimension            | Current Mattrax setup                                                                | Yielded Sync spike                                                     |
| -------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Read transport       | Same-origin JSON through Effect `HttpApi` / `HttpApiClient`                          | WebSocket snapshot plus ordered events                                 |
| Browser cache        | TanStack Query, 30-second stale time                                                 | Yielded replica bridged into the same TanStack cache                   |
| Existing realtime    | Tenant SSE polls MySQL every 2.5 seconds, lives 25 seconds, then invalidates queries | Source cursor, retained event replay and fresh-snapshot fallback       |
| SSE coverage         | Mapped MDM/system audit events only; saved-view edits are not published              | Every accepted source action publishes an event                        |
| Cross-user freshness | Manual refetch or broad cross-tab invalidation                                       | Connected accounts receive committed changes directly                  |
| Cross-tab freshness  | `BroadcastChannel` / `localStorage` invalidation                                     | Each tab has its own replica; both receive server events               |
| Optimism             | Hand-written TanStack snapshot/rollback helpers                                      | Typed optimistic reducers with server confirmation or rollback         |
| Retry identity       | Application-specific                                                                 | Durable actor + command receipt returns the original result            |
| Conflict handling    | Endpoint-specific; group writes already use `expectedUpdatedAt`                      | Serialized actions per source; application-defined domain errors       |
| Offline edits        | No durable browser mutation queue                                                    | Optional IndexedDB journal; this spike deliberately uses volatile mode |
| Authority            | MySQL through Drizzle / Hyperdrive                                                   | Durable Object SQLite                                                  |
| Query model          | Arbitrary SQL, filters, joins and pagination                                         | One bounded snapshot per source id; no query engine                    |
| Private data         | Filtered per request in SQL                                                          | Separate source boundary per account                                   |
| Audit                | MySQL audit row in the request path                                                  | No audit projection in this spike                                      |
| Self-hosting         | Same Node API runtime                                                                | No Node Durable Object host; feature is Cloudflare-only                |
| API clients          | Session cookies and scoped bearer tokens                                             | Browser session cookies; browser WebSockets cannot set `Authorization` |

## What the spike proves

1. **Live shared state works without polling.** A tenant view created by one account is
   committed once and delivered to every connected account.
2. **Lost responses do not duplicate writes.** Replaying the same command id returns the
   original receipt. The test creates one view, executes the same command twice and
   asserts a single row.
3. **Private state needs a separate authority boundary.** A tenant-wide snapshot cannot
   safely contain per-account private views because every authorized viewer receives the
   same public snapshot.
4. **The existing UI does not need Effect Atom.** A headless client can feed the current
   TanStack Query cache, which lowers the frontend migration cost.
5. **The Cloudflare adapter does not require `effect-cf`.** A small native Durable Object
   wrapper keeps the Yielded scope alive and avoids adding another Worker framework.

## Advantages for Mattrax

- **Better semantics for collaborative aggregates.** Snapshots, events and receipts are
  one protocol rather than several application-specific caches and invalidations.
- **No refetch after a remote edit.** The current SSE design deliberately emits hints;
  Sync emits the state transition itself.
- **Safer retries.** Exactly-once receipt lookup is valuable for commands whose response
  can be lost after commit.
- **Strong fit with Effect 4.** Mattrax already uses Effect 4.1.5 and Effect Schema.
  Contracts, reducers and server handlers remain typed end to end.
- **Self-hostable library.** Yielded charges no per-request fee. The runtime is MIT and
  the storage and transport ports can be replaced.
- **Bounded bundle impact.** The measured increase is small relative to the existing
  Workers and remains inside the repository budget.

## Disadvantages and risks

### Maturity

As of 2026-11-24, `@yielded/sync` is `0.1.0-beta.5`, first published on 2026-09-24.
There is no stable release. The public repository has 49 stars, one fork and one main
contributor; npm reports 265 downloads in the last week and 1,382 in the last month.
The companion Cloudflare packages also have stale `latest` dist-tags, so exact version
pinning is required.

This is a serious adoption risk for a control-plane product, regardless of code quality.

### Authority migration is the real cost

The five endpoint signatures are the easy part. A production cutover must also move:

- existing MySQL rows into the new sources;
- every background or administrative writer;
- account deletion and member removal cleanup;
- tenant deletion and export/restore behavior;
- audit logging and its retry guarantees;
- permission revocation behavior for long-lived connections.

Those concerns are more expensive than the client/server protocol.

### Whole-snapshot replication

Sync is not a replacement for SQL. Every subscriber receives the complete public
snapshot, then events. It has no server-side filtering, joins or pagination. Large or
unbounded collections are a poor fit unless the product adds strict limits and a
separate query path.

This spike adds caps of 100 tenant views, 100 private views, 50 columns, 2,000 characters
per filter string and 8 KiB per encoded query. Those caps are product changes, not just
technical safeguards.

### Durable Object operations and cost

Each active tenant-shared source and each active account source is a Durable Object.
Cloudflare bills Durable Object requests, duration and SQLite storage. Incoming WebSocket
messages receive a 20:1 billing ratio, outgoing messages are free, and the adapter uses
the Hibernation API, but a cost model still requires real connection and write volumes.

Cloudflare's current SQLite Durable Object limits include 10 GB per object and a 32 MiB
received WebSocket message limit. Yielded's own defaults are smaller: 512 retained events,
100 connections, a 5-second source turn, 32 client sources and 100 pending commands per
source.

### Persistent browser mode restricts tabs

Yielded's IndexedDB adapter allows one active coordinator per namespace, actor and
source. A second tab with the same identity fails until the first closes the source.
That is a poor default for an admin dashboard, so this spike uses volatile persistence.
It gains reconnect and lost-response recovery while a page is open, but not offline edits
or pending-command recovery across reloads.

### Public snapshots constrain authorization

All authorized viewers of a source receive the same snapshot. Viewer-private data must
use another source id. This works for private device views, but it complicates domains
with per-user projections of shared records.

### Protocol evolution is a commitment

Retained events, pending commands and receipts constrain future codecs. Yielded supports
private-state migrations, but breaking public event or command schemas require explicit
compatibility work. Source addresses, Durable Object identities and storage namespaces
must remain stable.

### Self-hosting and non-browser clients

The supplied Cloudflare adapter is Durable Object based. Mattrax's Node host has no
corresponding Sync transport in this spike, so saved views return unavailable there.
Browser WebSockets also cannot attach the bearer tokens supported by the old HTTP API.
A full migration needs both a portable Node host and a deliberate machine-client story.

### Audit and lifecycle gaps in this branch

This branch is intentionally a hard-cutover spike, not a complete production migration:

- existing MySQL views/defaults are not imported; the new sources start empty;
- the now-unused MySQL tables remain in the schema;
- `device_view.*` audit rows are no longer written;
- account/member/tenant cleanup does not purge Durable Object state;
- tenant export/restore does not include saved views;
- visibility cannot change after creation, because moving between sources is not atomic;
- a default may retain a stale shared-view id until the user changes it.

These gaps are useful decision evidence: they show why moving a small endpoint group is
not the same as moving its product lifecycle.

## Measured evidence

All measurements are from this branch versus `main` (`91f54690`).

| Check                   | Result                                        |
| ----------------------- | --------------------------------------------- |
| Domain saved-view tests | 8 passed                                      |
| Sync server tests       | 5 passed                                      |
| Sync route auth tests   | 2 passed                                      |
| Cloud package tests     | 95 passed                                     |
| Device-view query tests | 7 passed                                      |
| Changed-file lint       | Passed                                        |
| Full typecheck          | Passed                                        |
| API Worker build        | Passed                                        |
| Web Worker build        | Passed                                        |
| API Worker bundle       | 2.03 MiB baseline → 2.11 MiB gzip (+0.08 MiB) |
| Web Worker bundle       | 2.07 MiB baseline → 2.11 MiB gzip (+0.04 MiB) |
| Bundle budget           | Both below 2.50 MiB                           |

Both `main` and this branch build cleanly. No workaround is required.

No production latency, concurrency or Cloudflare billing benchmark was run. The tests
prove protocol semantics, not operating cost at fleet scale.

## Recommendation

**Do not migrate Mattrax wholesale to Yielded Sync now.** Most Mattrax endpoints are
queries over relational data or protocol state with many writers. Sync's whole-snapshot
model would add a second authority without removing MySQL, and the beta maturity is not
justified by the measured bundle cost.

**Continue a narrow evaluation for bounded, collaborative aggregates.** Saved views are
a reasonable example. Before investing further, require:

1. a stable Yielded release or an accepted beta-risk policy;
2. a production-shaped data import and rollback plan;
3. audit projection with idempotent delivery;
4. account/member/tenant lifecycle cleanup and export/restore;
5. a portable Node host and machine-client authentication;
6. a load test with real tab counts, write rates and permission revocation;
7. a Cloudflare cost estimate from that workload;
8. an explicit decision on persistent browser mode and its one-tab restriction.

If those gates pass, Sync is most compelling for small shared registries, live job state
and other bounded aggregates. It is less compelling for inventory search, policy authoring,
approvals, MDM command state and other relational or high-volume surfaces.

## References

- [Yielded Sync overview](https://yielded.dev/sync/)
- [How Sync works](https://yielded.dev/sync/guide/concepts/)
- [Clients and React](https://yielded.dev/sync/client/)
- [Packages and hosts](https://yielded.dev/sync/reference/packages/)
- [Releases and upgrades](https://yielded.dev/sync/release/)
- [Cloudflare Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Cloudflare Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
