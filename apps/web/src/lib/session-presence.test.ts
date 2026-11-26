import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_PRESENCE_COOKIE,
  clearSessionPresence,
  readSessionPresence,
  sessionPresenceSetCookie,
} from "./session-presence";

/** The production reader compares against the ambient clock, so pin it too. */
const NOW = Date.parse("2026-06-01T12:00:00.000Z");

beforeEach(() => vi.setSystemTime(new Date(NOW)));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("session presence", () => {
  it("builds an active and cleared cookie", () => {
    const expiresAt = NOW + 60_000;
    expect(sessionPresenceSetCookie(expiresAt, false)).toContain(
      `${SESSION_PRESENCE_COOKIE}=v1.${expiresAt}`,
    );
    expect(sessionPresenceSetCookie(null, true)).toContain("Max-Age=0");
    expect(sessionPresenceSetCookie(null, true)).toContain("Secure");
  });

  it("reads active, expired and missing states", () => {
    const active = NOW + 60_000;
    vi.stubGlobal("document", {
      cookie: `${SESSION_PRESENCE_COOKIE}=v1.${active}`,
    });
    expect(readSessionPresence()).toEqual({ state: "active", expiresAt: active });

    vi.stubGlobal("document", {
      cookie: `${SESSION_PRESENCE_COOKIE}=v1.${NOW - 60_000}`,
    });
    expect(readSessionPresence().state).toBe("expired");

    vi.stubGlobal("document", { cookie: "" });
    expect(readSessionPresence().state).toBe("missing");
  });

  it("clears the readable cookie", () => {
    const writes: string[] = [];
    vi.stubGlobal("location", { protocol: "https:" });
    vi.stubGlobal("document", {
      get cookie() {
        return "";
      },
      set cookie(value: string) {
        writes.push(value);
      },
    });
    clearSessionPresence();
    expect(writes.some((value) => value.includes("Max-Age=0"))).toBe(true);
    expect(writes.some((value) => value.includes("Secure"))).toBe(true);
  });
});
