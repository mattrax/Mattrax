# Four-eyes approvals on `@alchemy.run/domain` (POC)

A vertical slice of Mattrax's approvals feature, rebuilt as an event-sourced
domain model to answer [#633](https://github.com/mattrax/Mattrax/issues/633):
what would the API/management layer look like on Alchemy Domain, and is it
better for maintainability and reliability?

It is a **draft**, isolated in its own package: nothing in `apps/` or the
existing packages imports it. Run it with:

```sh
pnpm install
pnpm poc:domain        # http://localhost:8787, OpenAPI at /openapi.json
pnpm --filter @mattrax/domain-poc test
```

The demo UI lets you switch between administrators, request an approval, approve
it, watch the detail view update over Server-Sent Events, spend the approval
once, and let it expire. Data is in memory and resets on restart.

## What was ported

The hardest part of the existing approvals feature was chosen deliberately: its
invariants are spread across a request row, a decisions table, a status machine,
a read-time expiry calculation, a sweep, a conditional `UPDATE` for single use,
a payload hash, and a pile of permission checks. If the domain model can carry
those cleanly, it can carry most CRUD.

| Existing endpoint                                     | POC                                                       |
| ----------------------------------------------------- | --------------------------------------------------------- |
| `POST /v1/tenants/:id/approvals/:id/approve`          | command `ApproveApproval`                                 |
| `.../reject`                                          | command `RejectApproval`                                  |
| `.../cancel`                                          | command `CancelApproval`                                  |
| the implicit request created by `requireApproval`     | command `RequestApproval`                                 |
| consuming an approved request on a destructive action | command `ConsumeApproval`                                 |
| the expiry sweep + `effectiveApprovalStatus`          | `ExpireApproval` scheduled by the `ApprovalExpiry` policy |
| `GET .../approvals/:id`                               | view `ApprovalDetail` (also `watch` / SSE)                |
| `GET .../approvals`                                   | query `ApprovalQueue` over the `ApprovalIndex` projection |
| OpenAPI / typed client                                | `ApprovalApi` — both are derived from it                  |

`ConsumeApproval` has no public endpoint today. It is the domain version of the
CHECK that `requireApproval` performs before a wipe/export/delete runs; a real
port would call it from the gated action, or model each gated action as a saga.

## The shape

```text
RequestApproval ─┐
ApproveApproval ─┤
RejectApproval  ─┼─▶ Approval aggregate ─▶ Approval*
CancelApproval  ─┤        (decide/evolve)      events
ExpireApproval  ─┤                              │
ConsumeApproval ─┘                              ├─▶ ApprovalDetail view ──▶ SSE watch
                                                │           │
                                                │           └─▶ ApprovalIndex projection ─▶ ApprovalQueue query
                                                └─▶ ApprovalExpiry policy ─▶ scheduled ExpireApproval
```

- **Aggregate** (`Approval.aggregate.ts`): one request, one ordered stream,
  one transaction. The status machine is a tagged union, so `Unrequested`,
  `Pending`, `Approved`, `Rejected`, `Expired` and `Cancelled` cannot be
  mixed up. `decide` holds the rules: no self-approval, no duplicate approver,
  no token approvals, no cross-tenant access, no decision after the deadline,
  single use, payload binding.
- **Commands** declare their own events and every rejection they can return.
  The client's error type is derived, so forgetting to handle `AlreadyConsumed`
  is a type error rather than a 500.
- **View** (`ApprovalDetail`): the read model, authorized on every `get`,
  `list` and every pushed change. The rule "requester or `approvals.read`"
  lives in one function instead of being repeated in three handlers.
- **Policy** (`ApprovalExpiry`): arms a durable `ExpireApproval` at the
  deadline. There is no sweep to schedule and no "expiry is an observation"
  branch in every read.
- **Projection + query**: the queue is a question across keys, so a projection
  writes a store (a port; memory here, MySQL in a real port) and a paged query
  serves it. Authorization is checked in the query handler, not in the route.
- **Middleware** (`Session`): the declaration says every command and read needs
  an authenticated actor and provides `CurrentActor`; the server half is a
  single Layer. Commands that read the actor cannot compile without it.
- **Stories** (`Approval.story.test.ts`): given/when/then over the real model
  in memory, with a controllable clock. All 13 tests are behavior, not SQL:
  they assert events, replies, rejections, view state and query pages, and the
  story fails if any event goes unaccounted for.

## Benefits, as observed

1. **The invariants have one home.** Concurrency, status transitions and
   single-use stop being properties of a set of queries that must agree. Two
   concurrent approvals cannot both read "N-1"; the aggregate serializes them.
   The existing handler needs a row lock, a re-read, a count and a conditional
   update inside a transaction to approximate this.
2. **Time is modelled.** The deadline is an event, not a sweep plus an
   `effectiveStatus` helper. Expiry fires without a reader; `decide` still
   refuses past the deadline for safety. That kills a whole class of "the cron
   did not run" bugs.
3. **Reads and writes are separate, on purpose.** Adding a screen does not add
   conditions to a write handler. Adding a rule does not risk a list endpoint.
4. **Authorization is declared, not remembered.** Every command lists its
   middleware; every view and query authorizes itself. A new read cannot
   accidentally skip the tenant check the way a new route can.
5. **Tests are specifications.** No MySQL, no fixtures, no HTTP. The same model
   runs in memory, and stories fail on any unasserted event or rejection. The
   POC's 13 tests cover every rejection path; the existing approval tests mostly
   cover the pure helpers and e2e routes.
6. **The API surface is derived.** A typed in-process client, a JSON HTTP API,
   OpenAPI, SSE and MCP tools all come from one declaration. The client and the
   server cannot drift, and there is no 32k-line handler file to register a route
   in.
7. **Idempotency and tracing are defaults.** Commands carry a `commandId`;
   retries are deduplicated, projections receive inputs at least once and are
   made idempotent by key, and every command/event/reaction is traced with a
   correlation id.
8. **The framework verifies the model.** `Domain.verify(Model)` catches
   definition errors (missing `keyOf`, an event no source emits, duplicate
   names) before deployment.

## Disadvantages and risks, as observed

1. **Read models are eventually consistent.** The detail view is a moment behind
   the commit; our first queue read after a command was empty until the
   projection's batch window elapsed. The aggregate is not queryable, so every
   list/search/report must be a projection or a query over a store. For Mattrax,
   device lists, global search, dashboards and exports are the _majority_ of the
   API surface, not the exception.
2. **Read-your-write has a sharp edge.** A projection built from a view
   (`from: [ApprovalDetail]`) is invisible to the query's `atLeast` wait: the
   implementation only traces aggregate sources, so `waitsFor` returns
   immediately. Our API test has to poll the queue. Projecting from the
   aggregate fixes it but pushes every field a list needs into events. Either
   way, "return the updated list immediately" is no longer free.
3. **Event versioning is a permanent tax.** Events are kept forever, so field
   changes must be additive or be new events; corrections are compensating
   events. The current schema can migrate a nullable column in a minute.
4. **The hosting model is different.** On Cloudflare every aggregate instance,
   view key, policy and projection key is a Durable Object. Device check-ins are
   high-volume, per-device writes; DO-per-device is a real cost/latency question
   and a different operational shape from one MySQL row. On Rivet/Effect Cluster
   it is Postgres, but that is still not the existing MySQL deployment.
5. **Self-hosting is unresolved.** Mattrax ships a Docker/MySQL self-host build.
   Domain's hosts are Durable Objects on Cloudflare, Rivet, or Effect Cluster —
   no MySQL backend is documented. A port would either split the product's
   hosting story or need a MySQL platform adapter (and therefore a dependency on
   the framework's internals).
6. **It is a beta framework.** `2.0.0-beta.87`, with unstable Effect 4 RPC/HTTP
   APIs underneath. The framework's own read-your-write gap above is an example
   of behaviour still settling. Pinning and reading source is required.
7. **Migration is the cost, not the model.** The aggregate is a rewrite of
   storage and behavior, not a wrapper. A twin-write or projection-into-the-old-
   tables phase is possible (projections can write MySQL), but the commands,
   events, backfill and rollback plan are a project per bounded context.
8. **Operational visibility moves.** Auditing becomes "read the event log" plus
   whatever you project. The current code writes audit rows explicitly; here you
   project them, and you need retention/backup tooling for event streams.
9. **A typed framework in a TypeScript monorepo is viral.** Every caller of the
   aggressive domain types pays the compile cost; the existing codebase already
   splits HttpApi groups to stay under the declaration emitter's limit.
10. **Plain HTTP is a compromise.** The generated REST surface uses the RPC
    payloads (`target`/`input`), a non-standard `QUERY` method for paged
    queries, and publishes exactly what `expose` lists. Fine for internal tools,
    not a drop-in for the existing `/v1` contract.

## The follow-up questions in the issue

- **Optimistic UI:** yes, and it is designed for it. A command carries a
  `commandId`; the eventual view/stream entry carries the same id; the client
  shows a pending row and confirms or rejects it when the event arrives. Alchemy
  ships a foldkit adapter (`@alchemy.run/domain/Foldkit`) for exactly this.
  Our demo shows the read side (SSE `watch`), not the optimistic client.
- **Offline:** "offline intents" work: queue commands with their ids and replay
  them in order; a conflict is a typed rejection. A _local-first_ app where the
  device decides is explicitly not supported — the docs say a domain model
  assumes one decider per aggregate, and no sync engine is included.
- **Sync with the client:** views and streams are keyed, ordered and resumable;
  `watch` pushes changes and `events(after)` resumes from a cursor. That covers
  per-detail screens well. A tenant-wide device list is a projection: you would
  either page it or build a stream that publishes compact per-tenant changes.
- **"Insanely fast page changes" (#632):** the domain layer does not replace the
  client cache. It gives you a change feed and a command id to reconcile with;
  TanStack Query/infinite cache still owns the UI. The honest win is fewer
  refetch races and a reliable "your write is in this view" receipt, not an
  instant list for free.

## Recommended adoption path (if we do this)

1. Keep MySQL and the existing read endpoints. Add a domain package for a
   bounded context with genuinely hard invariants — approvals is a good first
   candidate because the write side is small, the rules are subtle, and the read
   side can be projected back into the existing tables.
2. Host it in-process in the existing Worker/Node server (the POC does), not on
   Durable Objects, while the read models still live in MySQL. That avoids
   committing to DO cost and keeps self-host plausible.
3. Do not port device check-in, MDM webhooks or high-volume ingestion first;
   those are the worst fit for per-aggregate hosting and the least in need of
   these invariants.
4. Port read models only when a screen needs a new shape. A query can read the
   existing tables through a port without rewriting them.
5. Re-evaluate after one bounded context: measure p95 write latency, projection
   lag, bundle/type-check impact and the migration effort actually spent.

## Verdict

The model is a clear maintainability and reliability win **for the write side of
small, invariant-heavy aggregates**. The cost is the read side and hosting: every
list, search and report becomes a projection, reads become eventually
consistent, and the framework's deployment targets do not include the current
MySQL self-host. A full refactor of "the API and management layer" would be a
multi-quarter rewrite with a permanent event-versioning tax; a strangler port of
one bounded context is realistic and would tell us quickly whether the trade is
worth it.
