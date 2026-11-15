import { and, eq, gt } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { type EnterpriseDb, authSessions } from "@mattrax/enterprise-core";

export type AccountSession = {
  readonly id: string;
  readonly current: boolean;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly method?: string;
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

const asMillis = (value: bigint | number) => Number(value);

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
 * List the active sessions for a user. Yielded Auth owns the session rows; the
 * record column carries the assurance method used to sign in.
 */
export const listUserSessions = (
  db: EnterpriseDb,
  userId: string,
  currentSessionId?: string,
): Effect.Effect<Array<AccountSession>> =>
  Effect.gen(function* () {
    const rows = yield* db
      .select()
      .from(authSessions)
      .where(
        and(eq(authSessions.subjectId, userId), gt(authSessions.expiresAt, Date.now())),
      );

    return rows
      .map((row) => Schema.decodeUnknownSync(SessionRow)(row))
      .map((row) => ({
        id: row.sessionId,
        current: row.sessionId === currentSessionId,
        createdAt: new Date(asMillis(row.issuedAt)).toISOString(),
        expiresAt: new Date(asMillis(row.expiresAt)).toISOString(),
        method: methodFromRecord(row.record),
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }).pipe(Effect.orDie);

/** Revoke one session, scoped to the owner. Returns whether a row was removed. */
export const revokeUserSession = (
  db: EnterpriseDb,
  userId: string,
  sessionId: string,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const [existing]: ReadonlyArray<{ readonly id: string }> = yield* db
      .select({ id: authSessions.sessionId })
      .from(authSessions)
      .where(and(eq(authSessions.sessionId, sessionId), eq(authSessions.subjectId, userId)))
      .limit(1);

    if (!existing) return false;
    yield* db
      .delete(authSessions)
      .where(and(eq(authSessions.sessionId, sessionId), eq(authSessions.subjectId, userId)));

    return true;
  }).pipe(Effect.orDie);
