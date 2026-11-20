import { Cause, Effect, Exit, Option, Schema, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { asc, and, desc, eq, gt } from "drizzle-orm";
import { Db, hasMfaFactor, schema as s, type EnterpriseDb } from "@mattrax/enterprise-core";
import {
  EnterpriseAuth,
  EnterpriseForbidden,
  REALTIME_SSE_CONTENT_TYPE,
  REALTIME_SSE_HEARTBEAT,
  credentialPermissions,
  encodeRealtimeSseEvent,
  hasPermission,
  hasUnrestrictedCredential,
  realtimeCursorFrom,
  realtimeEventFromRow,
  type RealtimeEvent,
} from "@mattrax/enterprise-domain";
import { loadTenantAccess } from "@mattrax/enterprise-identity";
import { parseStoredCredentialScopes } from "@mattrax/enterprise-backend";

/**
 * Authenticated, tenant-scoped realtime invalidation over Server-Sent Events.
 *
 * ## Why a bounded stream
 *
 * Cloudflare Workers cannot hold a WebSocket without Durable Objects, and the
 * deployment has no Durable Object binding. A long-lived HTTP response is
 * possible but ties an isolate (and a MySQL connection) to one idle browser for
 * an unbounded time, which is a poor neighbour on a shared isolate and hides
 * failures behind a silently dead socket. Each stream therefore lives for at
 * most {@link REALTIME_MAX_CONNECTION_MS} (25 seconds) and the browser
 * reconnects with its cursor. The trade-off is one extra request every 25s per
 * open dashboard tab (about 2.4 requests/minute); in exchange disconnect
 * detection is immediate, no connection state is pinned to an isolate, and a
 * deploy or crash cannot leave a zombie subscription.
 *
 * ## Bounds
 *
 * - One stream per request; no fan-out to other users or tabs.
 * - At most {@link REALTIME_MAX_EVENTS_PER_POLL} rows per poll, so one query
 *   cannot materialise a backlog.
 * - At most {@link REALTIME_MAX_EVENTS_PER_CONNECTION} events per connection;
 *   the stream then ends and the client resumes from its cursor.
 * - Polls every {@link REALTIME_POLL_INTERVAL_MS} and emits a comment frame so
 *   proxies flush and the browser sees liveness.
 * - No payload beyond kind/deviceId/protocol/at (see enterprise-domain).
 *
 * ## Authorisation
 *
 * The caller must be a verified account, a member of the tenant, not blocked by
 * a tenant MFA requirement, and hold `devices.read` (both in the role and in a
 * narrowed API token's scopes). A tenant-bound token cannot read another
 * tenant, and a missing membership is reported as 404 so tenant existence is
 * not probeable. Every query is also scoped by `organization_id`; a cursor
 * cannot cross tenants because it is only ever compared inside that scope.
 */

export const REALTIME_POLL_INTERVAL_MS = 2_500;

/** A little under Cloudflare's practical patience for an idle response. */
export const REALTIME_MAX_CONNECTION_MS = 25_000;

export const REALTIME_MAX_EVENTS_PER_CONNECTION = 200;

/** One poll never reads more than this many rows. */
export const REALTIME_MAX_EVENTS_PER_POLL = 100;

const encoder = new TextEncoder();

type HeaderRecord = Record<string, string | string[] | undefined>;

const headerValue = (headers: HeaderRecord, name: string): string | undefined => {
  const value = headers[name.toLowerCase()] ?? headers[name];

  return Array.isArray(value) ? value[0] : value;
};

const json = (body: Schema.Json, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

export type RealtimeAuthorization =
  | { readonly allowed: true; readonly accountId: string }
  | { readonly allowed: false; readonly status: 401 | 403 | 404; readonly message: string };

/**
 * Authorise a tenant stream.
 *
 * Exported so boundary tests can drive it with a fake auth service and database
 * instead of standing up the HTTP router.
 */
export const authorizeRealtimeTenant = (input: {
  readonly db: EnterpriseDb;
  readonly auth: EnterpriseAuth["Service"];
  readonly tenantId: string;
  readonly headers: HeaderRecord;
}): Effect.Effect<RealtimeAuthorization> =>
  Effect.gen(function* () {
    const resolved = yield* Effect.exit(
      // SAFETY: the auth service's resolved shape is dynamic by design; the
      // fields below are read from the same account row the API uses.
      input.auth.requireUser({ headers: input.headers }) as Effect.Effect<
        {
          readonly user: {
            readonly id: string;
            readonly emailVerified: boolean;
            readonly totpEnabled?: boolean | null;
            readonly passkeyEnabled?: boolean | null;
          };
          readonly apiToken?: {
            readonly tenantId?: string | null;
            readonly scopes?: Schema.Json;
          };
          readonly oauth?: { readonly scopes?: ReadonlyArray<string> };
        },
        unknown
      >,
    );

    if (Exit.isFailure(resolved)) {
      const failure = Cause.findErrorOption(resolved.cause);

      return {
        allowed: false,
        status: Option.isSome(failure) && failure.value instanceof EnterpriseForbidden ? 403 : 401,
        message: "Sign in to receive live updates.",
      } as const;
    }

    const { user, apiToken, oauth } = resolved.value;

    if (!user.emailVerified)
      return {
        allowed: false,
        status: 403,
        message: "Verify your email address before receiving live updates.",
      } as const;

    // A tenant-bound credential cannot read another tenant. Report it as
    // missing, matching the API's no-probing behaviour.
    if (apiToken?.tenantId && apiToken.tenantId !== input.tenantId)
      return { allowed: false, status: 404, message: "Tenant not found" } as const;

    const tenantAccess = yield* loadTenantAccess(input.db, user.id, input.tenantId);

    if (!tenantAccess) return { allowed: false, status: 404, message: "Tenant not found" } as const;

    // The tenant-wide MFA gate applies to reads, and a stream is a read of
    // device state that never expires on its own.
    if (tenantAccess.organization.requireMfa && !hasMfaFactor(user))
      return {
        allowed: false,
        status: 403,
        message:
          "This tenant requires multi-factor authentication. Add a passkey or authenticator app to your account first.",
      } as const;

    const credentialScopes = apiToken
      ? parseStoredCredentialScopes(apiToken.scopes)
      : oauth
        ? Array.from(oauth.scopes ?? [])
        : null;

    if (
      credentialScopes !== null &&
      !hasUnrestrictedCredential(credentialScopes) &&
      !credentialPermissions(credentialScopes).has("devices.read")
    )
      return {
        allowed: false,
        status: 403,
        message: "This credential does not include the devices.read permission.",
      } as const;

    if (!hasPermission(tenantAccess.role.permissions, "devices.read"))
      return {
        allowed: false,
        status: 403,
        message: "Your role does not include the devices.read permission.",
      } as const;

    return { allowed: true, accountId: user.id } as const;
  }).pipe(
    // An auth service failure (expired session, revoked token, disabled
    // account) must not produce a stream. Anything not explicitly swallowed
    // above is an authentication failure.
    Effect.catchCause(() =>
      Effect.succeed({
        allowed: false,
        status: 401,
        message: "Sign in to receive live updates.",
      } as const),
    ),
  );

export type RealtimeBatch = {
  readonly events: ReadonlyArray<RealtimeEvent>;
  /** Newest sequence observed, even when the row was not decodable. */
  readonly lastSeq: number;
};

/**
 * Read the tenant's events after `after`, oldest first.
 *
 * The organisation predicate is not an optimisation: it is the isolation
 * boundary. A caller that guesses another tenant's sequence still reads nothing
 * outside its own scope.
 */
export const readRealtimeBatch = (
  db: EnterpriseDb,
  tenantId: string,
  after: number,
  limit: number = REALTIME_MAX_EVENTS_PER_POLL,
): Effect.Effect<RealtimeBatch, unknown> =>
  Effect.gen(function* () {
    const rows = yield* db
      .select({
        seq: s.realtimeEvent.seq,
        kind: s.realtimeEvent.kind,
        deviceId: s.realtimeEvent.deviceId,
        protocol: s.realtimeEvent.protocol,
        createdAt: s.realtimeEvent.createdAt,
      })
      .from(s.realtimeEvent)
      .where(and(eq(s.realtimeEvent.organizationId, tenantId), gt(s.realtimeEvent.seq, after)))
      .orderBy(asc(s.realtimeEvent.seq))
      .limit(Math.max(1, Math.min(limit, REALTIME_MAX_EVENTS_PER_POLL)));

    const events = rows.flatMap((row) => {
      const event = realtimeEventFromRow(row);

      return event ? [event] : [];
    });

    const last = rows.at(-1);

    return {
      events,
      lastSeq: last?.seq ?? after,
    };
  });

/** Newest cursor for a tenant, or 0 when it has never published an event. */
export const latestRealtimeSeq = (
  db: EnterpriseDb,
  tenantId: string,
): Effect.Effect<number, unknown> =>
  Effect.gen(function* () {
    const [row] = yield* db
      .select({ seq: s.realtimeEvent.seq })
      .from(s.realtimeEvent)
      .where(eq(s.realtimeEvent.organizationId, tenantId))
      .orderBy(desc(s.realtimeEvent.seq))
      .limit(1);

    return row?.seq ?? 0;
  });

export type RealtimeStreamOptions = {
  readonly db: EnterpriseDb;
  readonly tenantId: string;
  /** Exclusive cursor: stream rows with `seq > after`. */
  readonly after: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Effect.Effect<void>;
  readonly pollIntervalMs?: number;
  readonly maxConnectionMs?: number;
  readonly maxEvents?: number;
  readonly batchSize?: number;
};

/**
 * A bounded SSE byte stream.
 *
 * Ends after `maxConnectionMs` or `maxEvents`, whichever comes first. Ending is
 * normal (not an error): the client reconnects with the newest cursor it saw.
 */
export const realtimeEventStream = (
  options: RealtimeStreamOptions,
): Stream.Stream<Uint8Array, unknown, never> => {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => Effect.sleep(ms));
  const pollIntervalMs = options.pollIntervalMs ?? REALTIME_POLL_INTERVAL_MS;
  const maxConnectionMs = options.maxConnectionMs ?? REALTIME_MAX_CONNECTION_MS;
  const maxEvents = options.maxEvents ?? REALTIME_MAX_EVENTS_PER_CONNECTION;
  const batchSize = options.batchSize ?? REALTIME_MAX_EVENTS_PER_POLL;
  const startedAt = now();

  return Stream.unfold<
    { readonly cursor: number; readonly sent: number },
    Uint8Array,
    unknown,
    never
  >({ cursor: options.after, sent: 0 }, (state) =>
    Effect.gen(function* () {
      if (now() - startedAt >= maxConnectionMs || state.sent >= maxEvents) return undefined;

      const batch = yield* readRealtimeBatch(options.db, options.tenantId, state.cursor, batchSize);

      if (batch.events.length === 0) {
        // An idle poll still writes a comment frame: a proxy must not buffer
        // an empty stream, and the browser uses it to prove liveness.
        yield* sleep(pollIntervalMs);

        return [
          encoder.encode(REALTIME_SSE_HEARTBEAT),
          { cursor: batch.lastSeq, sent: state.sent },
        ] as const;
      }

      return [
        encoder.encode(batch.events.map(encodeRealtimeSseEvent).join("")),
        { cursor: batch.lastSeq, sent: state.sent + batch.events.length },
      ] as const;
    }),
  );
};

export type RealtimeRoutesOptions = Omit<RealtimeStreamOptions, "db" | "tenantId" | "after">;

/**
 * `GET /api/v1/tenants/:tenantId/realtime`
 *
 * Resume cursor precedence: `Last-Event-ID` (sent by the browser after a drop),
 * then `?after=` (used by our own subscriber, which owns backoff). With no
 * cursor the stream starts at the tenant's current head so a first connection
 * does not replay the whole day.
 */
export const realtimeHandler =
  (options: RealtimeRoutesOptions = {}) =>
  (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const tenantId = params.tenantId?.trim();

      if (!tenantId) return json({ error: "Missing tenant" }, 400);

      const url = new URL(request.url, "http://localhost");

      const cursor = realtimeCursorFrom({
        header: headerValue(request.headers, "last-event-id"),
        query: url.searchParams.get("after"),
      });

      if (cursor.kind === "invalid") return json({ error: "Invalid realtime cursor" }, 400);

      const db = yield* Db;
      const auth = yield* EnterpriseAuth;

      const authorization = yield* authorizeRealtimeTenant({
        db,
        auth,
        tenantId,
        headers: request.headers,
      });

      if (!authorization.allowed)
        return json({ error: authorization.message }, authorization.status);

      const after =
        cursor.kind === "valid" ? cursor.cursor : yield* latestRealtimeSeq(db, tenantId);

      const stream = realtimeEventStream({ ...options, db, tenantId, after });

      return HttpServerResponse.stream(stream, {
        headers: {
          "content-type": REALTIME_SSE_CONTENT_TYPE,
          // A shared cache must never store another tenant's events, and a
          // transforming proxy must not buffer the stream.
          "cache-control": "no-store, no-transform",
          "x-accel-buffering": "no",
        },
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          yield* Effect.logError("Realtime stream failed", cause);

          return json({ error: "Realtime stream failed" }, 500);
        }),
      ),
    );

export const realtimeRoutes = (options: RealtimeRoutesOptions = {}) =>
  HttpRouter.add("GET", "/api/v1/tenants/:tenantId/realtime", realtimeHandler(options));
