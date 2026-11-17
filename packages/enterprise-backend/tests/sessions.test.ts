import { describe, expect, it } from "vitest";
import {
  captureSessionContext,
  listUserSessions,
  revokeAllUserSessions,
  revokeUserSession,
} from "../src/Account/sessions.ts";
import { makeDb, runEffect } from "./helpers.js";

// Session expiry is compared with the real clock, so fixtures must be too.
const now = Date.now();

type SessionSeed = {
  sessionId: string;
  subjectId: string;
  digest: string;
  securityRevision: string;
  issuedAt: number;
  expiresAt: number;
  absoluteExpiresAt: number;
  record: string;
};

const sessionRow = (overrides: Partial<SessionSeed> = {}): SessionSeed => ({
  sessionId: "session-1",
  subjectId: "user-1",
  digest: "digest-1",
  securityRevision: "revision-1",
  issuedAt: now - 60_000,
  expiresAt: now + 60_000,
  absoluteExpiresAt: now + 120_000,
  record: JSON.stringify({ assurance: { method: "passkey" } }),
  ...overrides,
});

const descriptor = {
  browser: "Chrome",
  platform: "macOS",
  deviceType: "desktop" as const,
  ipHash: "a".repeat(32),
};

describe("session client descriptors", () => {
  it("captures the descriptor once and refreshes last use inside the floor", async () => {
    const db = makeDb();
    const at = new Date(now);

    const first = await runEffect(
      captureSessionContext(db, {
        sessionId: "session-1",
        userId: "user-1",
        descriptor,
        now: at,
      }),
    );

    expect(first).toEqual({ created: true });
    expect(db.store.account_session_context).toMatchObject([
      { sessionId: "session-1", userId: "user-1", ipHash: descriptor.ipHash },
    ]);

    // Within the five-minute floor nothing is written.
    await runEffect(
      captureSessionContext(db, {
        sessionId: "session-1",
        userId: "user-1",
        descriptor,
        now: new Date(now + 60_000),
      }),
    );
    expect(db.store.account_session_context[0]!.lastUsedAt).toEqual(at);

    // After it, the timestamp advances but the descriptor is not duplicated.
    await runEffect(
      captureSessionContext(db, {
        sessionId: "session-1",
        userId: "user-1",
        descriptor,
        now: new Date(now + 6 * 60_000),
      }),
    );
    expect(db.store.account_session_context).toHaveLength(1);
    expect(db.store.account_session_context[0]!.lastUsedAt).toEqual(new Date(now + 6 * 60_000));
  });

  it("ignores a descriptor for a session owned by another account", async () => {
    const db = makeDb({
      account_session_context: [
        {
          sessionId: "session-1",
          userId: "user-1",
          ...descriptor,
          createdAt: new Date(now),
          lastUsedAt: new Date(now),
        },
      ],
    });

    const result = await runEffect(
      captureSessionContext(db, {
        sessionId: "session-1",
        userId: "user-2",
        descriptor,
        now: new Date(now),
      }),
    );

    expect(result).toEqual({ created: false });
    expect(db.store.account_session_context[0]!.userId).toBe("user-1");
  });
});

describe("session listing", () => {
  it("renders device, platform and last use and marks the current session", async () => {
    const db = makeDb({
      auth_sessions: [
        sessionRow(),
        sessionRow({
          sessionId: "session-2",
          digest: "digest-2",
          issuedAt: now - 3_600_000,
          record: JSON.stringify({ assurance: { method: "sso-oidc" } }),
        }),
        sessionRow({ sessionId: "expired", expiresAt: now - 1 }),
      ],
      account_session_context: [
        {
          sessionId: "session-1",
          userId: "user-1",
          ...descriptor,
          createdAt: new Date(now),
          lastUsedAt: new Date(now + 30_000),
        },
      ],
    });

    const sessions = await runEffect(listUserSessions(db, "user-1", "session-1"));

    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      id: "session-1",
      current: true,
      method: "passkey",
      browser: "Chrome",
      platform: "macOS",
      deviceType: "desktop",
      lastUsedAt: new Date(now + 30_000).toISOString(),
    });
    // No descriptor has been captured for the older session yet.
    expect(sessions[1]).toMatchObject({
      id: "session-2",
      current: false,
      method: "sso oidc",
      browser: null,
      lastUsedAt: null,
    });
  });

  it("removes the descriptor with the session it revokes", async () => {
    const db = makeDb({
      auth_sessions: [sessionRow()],
      account_session_context: [
        {
          sessionId: "session-1",
          userId: "user-1",
          ...descriptor,
          createdAt: new Date(now),
          lastUsedAt: new Date(now),
        },
      ],
    });

    await expect(runEffect(revokeUserSession(db, "user-1", "session-1"))).resolves.toBe(true);
    expect(db.store.auth_sessions).toHaveLength(0);
    expect(db.store.account_session_context).toHaveLength(0);

    await expect(runEffect(revokeUserSession(db, "user-1", "session-1"))).resolves.toBe(false);
  });

  it("signs out everywhere and reports how many sessions went", async () => {
    const db = makeDb({
      auth_sessions: [
        sessionRow(),
        sessionRow({ sessionId: "session-2", digest: "digest-2" }),
        sessionRow({ sessionId: "other", subjectId: "user-2", digest: "digest-3" }),
      ],
      account_session_context: [
        {
          sessionId: "session-1",
          userId: "user-1",
          ...descriptor,
          createdAt: new Date(now),
          lastUsedAt: new Date(now),
        },
      ],
    });

    await expect(runEffect(revokeAllUserSessions(db, "user-1"))).resolves.toEqual({
      revoked: 2,
    });
    expect(db.store.auth_sessions.map((row: any) => row.sessionId)).toEqual(["other"]);
    expect(db.store.account_session_context).toHaveLength(0);
  });
});
