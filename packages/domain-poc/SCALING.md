# Running notes: performance, storage, scale and the client

These are observations from this POC, the framework source
(@alchemy.run/domain@2.0.0-beta.87) and a small in-memory benchmark. They are not
production numbers.

## Does it replay the log?

**No, not on the write or read path.** An aggregate object stores:

- **meta** — the current state as one JSON document **plus its version**;
- **event:<seq>** — every committed event, append-only;
- **receipt:<commandId>** — the accepted command's receipt;
- **routed** — how far each consumer has been told about this instance.

commit() reads meta, calls decide against that state, then writes the new
events, the new meta, the receipt and the routing watermark in **one storage
transaction** (DurableObjects.ts, aggregateObject). There is no fold of the
event stream on a normal command. A cold object starts by reading meta; it does
not scan event:*.

Views are the same shape: a view key stores **snapshot** (state, checkpoints,
seq), **entry:<seq>** (what it emitted) and **in:<n>** (the input log it
applied). A get reads the snapshot. events/list read entry rows by sequence.

The log is replayed when:

- a **view or projection is added** to a model that already has history (or its
  version is bumped) — its keys are rebuilt from the sources' events through the
  backfill protocol;
- a key is read before its view has caught up, for a view keyed by the one
  aggregate it reads (catchUp);
- you explicitly build new read models. Nothing in normal traffic folds history.

So: writes are "read state, decide, append + snapshot"; reads are "read
snapshot"; replay is a **rebuild/backfill** operation.

### Measured framework overhead

In-memory host, 1,000 RequestApproval commands on distinct approval ids, this
machine (Node 26, M-series):

| scenario | total | per op |
| --- | ---: | ---: |
| sequential, distinct keys | 142 ms | ~142 us/op |
| 32-way concurrent, distinct keys | 48 ms | ~48 us/op |
| same command id twice (dedupe path) | 462 ms | ~231 us/send |

This is the **framework CPU only** — no network, no DO RPC, no durable storage.
On Cloudflare a command additionally pays: Worker -> Durable Object RPC, one
storage transaction (events + state + receipt), then a kick to the outbox and
deliveries to each consumer. Expect the DO round-trip and transaction to
dominate; the decide/evolve cost is noise. There is no DO benchmark in this
repo, and I would not quote a p50 until one is measured in the target colo.

Two costs showed up even in memory:

- 1,000 new keys caused backfill discovery over 1,000 subtrees for the view
  (hundreds of ms here). Creating many new instances is not free; it also
  causes deployment-time catch-up work.
- Delivery is asynchronous and batched. A read immediately after a write can
  miss it. That is why the POC polls the queue in its API test; see below.

## What grows without bound

There is no retention or compaction in the store in this version:

- aggregate **event:<seq>** — every event, forever;
- aggregate **receipt:<commandId>** — one receipt per accepted command;
- view **in:<n>** — every delivery the view applied, forever (dedupe/backfill);
- view **entry:<seq>** — one entry per applied event when the view emits (views
  that declare no events emit every applied event);
- stream **entry:<seq>** — every published entry, read from any cursor.

That is fine for an approval that gets a handful of commands. It is a bad fit
for a device aggregate that takes a check-in every 15 minutes for five years, or
for a tenant-wide firehose stream. Treat per-entity event streams as bounded by
"how many meaningful changes", not "how many heartbeats", and coalesce in the
projection before appending to a stream.

## Storage layout

### Durable Object / in-memory object keys

    Enterprise.ApprovalAggregate/ap-1
      meta                    {"state":{"_tag":"Approved", ...},"version":2}
      event:0000000000000001  {"event":{"_tag":"ApprovalRequested", ...},"envelope":{...}}
      event:0000000000000002  {"event":{"_tag":"ApprovalApproved", ...},"envelope":{...}}
      receipt:9f2c...         {"_tag":"Accepted","receipt":{"stream":"Approval/ap-1","version":2,"reply":{...}}}
      routed                  {"ApprovalDetail":1,"ApprovalIndex":1}

    Enterprise.ApprovalDetailView/ap-1
      snapshot                {"state":{...},"version":2,"checkpoints":{"Approval":2},"seq":2}
      entry:...               {"seq":1,"event":...,"envelope":...,"state":...}
      in:0000000000000001     {delivery...}
      in-seq                  2

    Enterprise.ApprovalIndexProjection/ten-1
      ...                     // whatever the projection's port stores

### Effect Cluster (the SQL host)

Effect Cluster stores every object in **one table of JSON documents**:

    CREATE TABLE IF NOT EXISTS alchemy_domain_objects (
      object TEXT COLLATE "C" NOT NULL,   -- "Enterprise.ApprovalAggregate/ap-1"
      key    TEXT COLLATE "C" NOT NULL,   -- "meta", "event:...", "receipt:..."
      value  TEXT NOT NULL,               -- JSON
      PRIMARY KEY (object, key)
    );

That is the entire domain storage. It is deliberately not relational: you cannot
index or join an approval's status from here. That is what the projection's own
store is for.

### The same shape in MySQL

The SQL host could be ported to MySQL because the object store is trivial — but
the surrounding platform is not (see below). The object table is approximately:

    CREATE TABLE domain_object (
      object VARBINARY(255) NOT NULL,     -- binary collation/order, no utf8mb4 index blow-up
      k      VARBINARY(255) NOT NULL,     -- MySQL reserves KEY
      value  JSON NOT NULL,
      PRIMARY KEY (object, k)
    ) ENGINE=InnoDB;

and the **read model you actually query** is separate, normal SQL:

    CREATE TABLE approval_index (
      id                 CHAR(36) PRIMARY KEY,
      tenant_id          CHAR(36)  NOT NULL,
      action             VARCHAR(32) NOT NULL,
      status             ENUM('pending','approved','rejected','expired','cancelled') NOT NULL,
      requested_by       CHAR(36)  NOT NULL,
      approvals_required SMALLINT  NOT NULL,
      approvals_received SMALLINT  NOT NULL,
      expires_at         BIGINT    NOT NULL,
      updated_at         BIGINT    NOT NULL,
      INDEX approval_queue (tenant_id, status, updated_at, id)
    ) ENGINE=InnoDB;

The projection's port writes that table; the query reads it. This is the part
that keeps SQL reporting, joins and existing tooling.

## Can it run on MySQL instead of Durable Objects?

Conceptually, yes. Domain.Platform is an interface; Cloudflare DOs, Rivet and
Effect Cluster are three implementations. Nothing in the model requires DOs.

In practice, **no MySQL host ships**. Effect Cluster is the SQL host and it:

- hardcodes @effect/sql-pg (PgClient.layer({ url }));
- uses Postgres SQL in the storage layer (starts_with, ON CONFLICT, COLLATE "C");
- uses Effect Cluster's own entity/message engine and a Postgres-backed workflow
  engine for sagas.

A MySQL port means replacing the client and those SQL fragments, and either
porting or reusing the cluster engine. More importantly, the Platform port also
has to provide:

- single-writer ordering per key (transactions or leases);
- dedupe by command id and a receipt;
- at-least-once, in-order delivery per (source, target);
- durable scheduled commands and cancellation;
- the backfill protocol (directory, per-key catch-up, handoff);
- live subscriptions (WebSocket or polling) and validate on each push;
- the workflow engine for sagas.

That is a serious adapter, not a driver swap. The realistic alternatives are:

1. **Add Postgres for the domain host** (Effect Cluster) beside the existing
   MySQL. Two databases in self-host, but no platform work.
2. **Run Rivet as a sidecar** next to the app; Rivet is the other non-CF host.
3. **Keep the existing SQL and endpoints**, and only put a domain model in front
   of the write path where the invariants matter; projections can write MySQL
   through a port, so the read side never moves.

DOs are **not required**. They are simply the most turnkey host, and the one
whose operational model (per-key single writer, hibernation, storage) is already
solved.

## Durable Object scope

One object per **aggregate id**, per **view key**, per **policy key**, per
**projection key** and per **stream key**. Classes are per model + kind
(Enterprise.DeviceAggregate, Enterprise.DeviceDetailView, ...).

So the scope is whatever you choose as the aggregate key:

| Model | Key | Objects |
| --- | --- | --- |
| Approval (this POC) | ApprovalId | one per approval, plus one view key and one policy key per approval |
| Device | DeviceId | one per device (plus per-device views/policies) |
| User | UserId | one per user |
| Tenant | TenantId | one per tenant |
| fleet list / dashboard projection | TenantId | **one per tenant** — a single writer for the whole fleet |
| tenant feed stream | TenantId | **one per tenant** — same hot spot |

A rough count for a device fleet: device aggregate + device detail view + health
view + presence stream = about 4-5 objects per device. 10,000 devices = about
40-50k DOs. Idle objects hibernate, so the cost is storage plus a request per
read/write, not continuous CPU. The **per-tenant** objects are the ones to
watch: every device event for a tenant routes into the same object for a
tenant-keyed projection or stream. Shard those keys (tenantId:0..15, a hash
bucket, or per-page/per-list keys) before a tenant gets large, or read lists
from SQL/D1 instead of a DO.

## Real-time for the whole dashboard

The primitives are per key:

- View.watch(key) / View.events(key, { after }) — one subscription per key;
- Stream.watch(key) / Stream.events(key, { after }) — one ordered log per key.

A page with 50 rows is 50 keys. That is 50 subscriptions (SSE or WebSocket),
which is not the right shape for a dashboard. The right shape is **one stream
per page/list scope**:

    Device/DeviceDetail view -> FleetFeed projection -> FleetFeed stream -> client cache
    Device/DeviceHealth view ->      (coalesce)          (key = tenant or page id)

- The projection consumes the views, **coalesces** (one entry per device per N
  seconds, or only when a field the page renders changes), and appends a compact
  entry: { entity, id, version, changed }. The client patches its
  TanStack/solid-query cache by id; it does not refetch the page.
- Resume with events(after: cursor); start with watch for the current value and
  live updates. A reconnect resumes from the last cursor.
- Authorization runs on every pushed change (validate), so a revoked permission
  closes the feed rather than leaking.
- **Single writer per key.** One tenant feed means every device change for the
  tenant serialises through one object. Shard the key and watch the shards, or
  key the feed by tenant + page if the page is a fixed slice.
- **No retention.** Stream entries are kept for good. Do not publish every
  check-in; publish changes the page renders, coalesced. Rotate a stream (new
  key/version) if its history must be bounded.
- **Lag.** It is a projection, so it is eventually consistent. For "my write",
  use the command receipt; for everyone else's writes the feed is the source.
- On hosts without WebSockets (Rivet / Effect Cluster) live reads fall back to
  polling the object every **300 ms** in this version. Cloudflare and the
  in-memory host push on commit. Choose the host/protocol with that in mind.

This is enough for a live dashboard. It is not a general-purpose sync engine:
there is no conflict resolution, no offline merge and no guarantee that a
coalesced feed contains every intermediate state.

## Optimistic UI, idempotency and retries

Yes to optimistic UI, and yes to automatic retries — if you make the **command
id an intent id**.

- Every command carries commandId. Every committed event's envelope carries the
  same id. A pending row keyed by commandId is confirmed or rejected when an
  entry with that envelope.commandId arrives. Alchemy has a foldkit adapter for
  this; with Solid/TanStack you implement the same pending map.
- Do **not** confirm from a coalesced stream if the stream drops intermediate
  states. For strict confirmation subscribe to the detail view's events or the
  aggregate's stream; or wait on the command receipt with snapshot({ atLeast })
  / the query atLeast.
- A command can emit no events, one, or many, and can affect several keys. The
  framework docs explicitly warn not to infer "every effect is visible" from one
  feed entry. Use the receipt for "committed", the feed for "visible".

Generate the id once per user intent:

    const intent = { commandId: crypto.randomUUID(), target, input };
    // persist intent (localStorage/IndexedDB) if it may outlive the page
    await api.ApproveApproval(target, input, { commandId: intent.commandId });
    // retry the SAME id, never a new one

For the generated HTTP surface the body is:

    { "target": "ap-1", "commandId": "b0e5...", "input": { "note": "ok" } }

Retry policy: only transport failures, timeouts, 429 and 5xx. Never retry a
typed rejection (SelfDecision, AlreadyConsumed, ...). Use exponential backoff
with jitter and a cap. If the reply was lost after commit, the aggregate finds
receipt:<commandId> and returns the stored receipt without applying the command
twice (confirmed in the DO host source). That makes retries safe even for
commands that are not idempotent by nature.

Caveats:

- **Accepted commands are deduped; rejected commands are not stored.** A retry
  of a rejected command re-runs decide, so a rejection is not a permanent
  receipt. Treat 4xx typed rejections as final on the client.
- **Receipts are kept forever.** A hot aggregate accumulates one receipt per
  command. Keep high-frequency telemetry out of the command path, or add
  compaction in a custom platform.
- The id is per aggregate instance for storage, but a UUID is globally unique,
  so one client-side generator is fine. Use the same id across tabs only if they
  are retrying the same intent.
- Offline queue: persist intents in order, replay oldest first, stop the queue
  on an unknown result until it resolves. This is the "offline intents" pattern
  the docs support; the device-decides local-first model is explicitly not
  included.
