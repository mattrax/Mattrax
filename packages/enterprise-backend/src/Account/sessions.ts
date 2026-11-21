import { and, eq, gt, inArray } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { authSessions } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import type { ClientDescriptor } from "./accountAudit.ts";
import { schema } from "../schema.ts";

export type AccountSession = {
  readonly id: string;
  readonly current: boolean;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly method?: string;
  /** Last authenticated request, or null while the session is unused. */
  readonly lastUsedAt?: string | null;
  /** Parsed client descriptor captured on first use; never the raw header. */
  readonly browser?: string | null;
  readonly platform?: string | null;
  readonly deviceType?: string | null;
};

const SessionRow = Schema.Struct({
  sessionId: Schema.String,
  issuedAt: Schema.Union([Schema.BigInt, Schema.Number]),
  expiresAt: Schema.Union([Schema.BigInt, Schema.Number]),
  record: Schema.optional(Schema.String),
});

const SessionRecord = Schema.Struct({
  assurance: Schema.optional(Schema.Struct({ method: Schema.optional(Schema.String) })),
  provenance: Schema.optional(
    Schema.Struct({
      evidence: Schema.optional(
        Schema.Struct({
          proofs: Schema.optional(
            Schema.Array(Schema.Struct({ method: Schema.optional(Schema.String) })),
          ),
        }),
      ),
    }),
  ),
});

/**
 * `last_used_at` is only written when it is at least this stale. A dashboard
 * load fans out several requests; without the floor each one would write.
 */
export const SESSION_CONTEXT_REFRESH_MILLIS = 5 * 60 * 1000;

const asMillis: (value: bigint | number) => number = Number;

const asDate = (value: Date | string | number | null | undefined): Date | undefined => {
  if (value == null) return undefined;
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
};

const methodFromRecord = (record: string | undefined) => {
  if (!record) return undefined;

  try {
    const parsed = Schema.decodeUnknownOption(SessionRecord)(JSON.parse(record));

    if (Option.isNone(parsed)) return undefined;

    const method =
      parsed.value.assurance?.method ?? parsed.value.provenance?.evidence?.proofs?.[0]?.method;

    return method?.replaceAll("-", " ");
  } catch {
    return undefined;
  }
};

/**
 * Capture the client descriptor for a session the first time it authenticates a
 * request, then refresh `last_used_at` at most once per refresh window.
 *
 * The auth library owns session creation and its row carries no request
 * context, so first authenticated use is the closest point to creation that
 * has the headers. `created` tells the caller this is a new session, which is
 * what the sign-in audit event keys off.
 */
export const captureSessionContext = (
  db: EnterpriseDb,
  input: {
    readonly sessionId: string;
    readonly accountId: string;
    readonly descriptor: ClientDescriptor;
    readonly now?: Date;
  },
): Effect.Effect<{ readonly created: boolean }, unknown> =>
  Effect.gen(function* () {
    const now = input.now ?? new Date();

    const existing = yield* db.query.accountSessionContext.findFirst({
      where: { sessionId: input.sessionId },
    });

    if (!existing) {
      yield* db.insert(schema.accountSessionContext).values({
        sessionId: input.sessionId,
        accountId: input.accountId,
        ipHash: input.descriptor.ipHash,
        browser: input.descriptor.browser,
        platform: input.descriptor.platform,
        deviceType: input.descriptor.deviceType,
        createdAt: now,
        lastUsedAt: now,
      });

      return { created: true };
    }

    // A session id is unique to one subject; ignore a mismatch rather than
    // rewriting another account's descriptor.
    if (existing.accountId !== input.accountId) return { created: false };

    const lastUsedAt = asDate(existing.lastUsedAt);

    if (
      lastUsedAt === undefined ||
      now.getTime() - lastUsedAt.getTime() >= SESSION_CONTEXT_REFRESH_MILLIS
    )
      yield* db
        .update(schema.accountSessionContext)
        .set({ lastUsedAt: now })
        .where(eq(schema.accountSessionContext.sessionId, input.sessionId));

    return { created: false };
  });

/**
 * List the active sessions for a user with their client descriptors. Yielded
 * Auth owns the session rows; the application table adds the device context.
 */
export const listUserSessions = (
  db: EnterpriseDb,
  accountId: string,
  currentSessionId?: string,
): Effect.Effect<Array<AccountSession>> =>
  Effect.gen(function* () {
    const rows = yield* db
      .select()
      .from(authSessions)
      .where(and(eq(authSessions.subjectId, accountId), gt(authSessions.expiresAt, Date.now())));

    const sessions = rows.map((row) => Schema.decodeUnknownSync(SessionRow)(row));

    const contexts =
      sessions.length === 0
        ? []
        : yield* db
            .select()
            .from(schema.accountSessionContext)
            .where(
              and(
                eq(schema.accountSessionContext.accountId, accountId),
                inArray(
                  schema.accountSessionContext.sessionId,
                  sessions.map((session) => session.sessionId),
                ),
              ),
            );

    const byId = new Map(contexts.map((context) => [context.sessionId, context]));

    return sessions
      .map((row) => {
        const context = byId.get(row.sessionId);
        const lastUsedAt = asDate(context?.lastUsedAt);

        return {
          id: row.sessionId,
          current: row.sessionId === currentSessionId,
          createdAt: new Date(asMillis(row.issuedAt)).toISOString(),
          expiresAt: new Date(asMillis(row.expiresAt)).toISOString(),
          method: methodFromRecord(row.record),
          lastUsedAt: lastUsedAt?.toISOString() ?? null,
          browser: context?.browser ?? null,
          platform: context?.platform ?? null,
          deviceType: context?.deviceType ?? null,
        };
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }).pipe(Effect.orDie);

/** Revoke one session, scoped to the owner. Returns whether a row was removed. */
export const revokeUserSession = (
  db: EnterpriseDb,
  accountId: string,
  sessionId: string,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const [existing]: ReadonlyArray<{ readonly id: string }> = yield* db
      .select({ id: authSessions.sessionId })
      .from(authSessions)
      .where(and(eq(authSessions.sessionId, sessionId), eq(authSessions.subjectId, accountId)))
      .limit(1);

    if (!existing) return false;
    yield* db
      .delete(authSessions)
      .where(and(eq(authSessions.sessionId, sessionId), eq(authSessions.subjectId, accountId)));
    yield* db
      .delete(schema.accountSessionContext)
      .where(eq(schema.accountSessionContext.sessionId, sessionId));

    return true;
  }).pipe(Effect.orDie);

/**
 * Sign out everywhere. Every session row for the account is deleted, including
 * the caller's, so the next request is unauthenticated. The descriptor rows go
 * with them; `authRevision` is bumped by the handler so signed tokens and
 * cached claims are stale too.
 */
export const revokeAllUserSessions = (
  db: EnterpriseDb,
  accountId: string,
): Effect.Effect<{ readonly revoked: number }> =>
  Effect.gen(function* () {
    const sessions = yield* db
      .select({ sessionId: authSessions.sessionId })
      .from(authSessions)
      .where(eq(authSessions.subjectId, accountId));

    if (sessions.length === 0) return { revoked: 0 };

    yield* db.delete(authSessions).where(eq(authSessions.subjectId, accountId));
    yield* db
      .delete(schema.accountSessionContext)
      .where(eq(schema.accountSessionContext.accountId, accountId));

    return { revoked: sessions.length };
  }).pipe(Effect.orDie);
