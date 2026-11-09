import { and, eq, gt } from "drizzle-orm";
import { Effect } from "effect";
import { type EnterpriseDb, authSessions } from "@mattrax/enterprise-core";

export type AccountSession = {
  readonly id: string;
  readonly current: boolean;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly method?: string;
};

type SessionRow = {
  sessionId: string;
  issuedAt: bigint | number;
  expiresAt: bigint | number;
  record?: string;
};

const asMillis = (value: bigint | number) => Number(value);

const methodFromRecord = (record: string | undefined) => {
  if (!record) return undefined;
  try {
    const parsed = JSON.parse(record) as {
      assurance?: { method?: unknown };
      provenance?: { evidence?: { proofs?: Array<{ method?: unknown }> } };
    };
    const method = parsed.assurance?.method ?? parsed.provenance?.evidence?.proofs?.[0]?.method;
    return typeof method === "string" ? method.replaceAll("-", " ") : undefined;
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
    const rows = (yield* db
      .select()
      .from(authSessions)
      .where(
        and(eq(authSessions.subjectId, userId), gt(authSessions.expiresAt, Date.now())),
      )) as SessionRow[];
    return rows
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
    const [existing] = (yield* db
      .select({ id: authSessions.sessionId })
      .from(authSessions)
      .where(and(eq(authSessions.sessionId, sessionId), eq(authSessions.subjectId, userId)))
      .limit(1)) as Array<{ id: string }>;
    if (!existing) return false;
    yield* db
      .delete(authSessions)
      .where(and(eq(authSessions.sessionId, sessionId), eq(authSessions.subjectId, userId)));
    return true;
  }).pipe(Effect.orDie);
