import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installGlobals } from "../../../../packages/config/testing/globals.ts";
import {
  SESSION_PRESENCE_COOKIE,
  clearSessionPresence,
  readSessionPresence,
  sessionPresenceSetCookie,
} from "./session-presence";

/** The production reader compares against the ambient clock, so pin it too. */
const NOW = Date.parse("2026-06-01T12:00:00.000Z");

beforeEach(() => vi.setSystemTime(new Date(NOW)));

let restoreGlobals = () => {};

const setGlobals = <V>(values: Record<string, V>) => {
  restoreGlobals();
  restoreGlobals = installGlobals(values);
};

afterEach(() => {
  restoreGlobals();
  restoreGlobals = () => {};
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
    setGlobals({
      document: {
        cookie: `${SESSION_PRESENCE_COOKIE}=v1.${active}`,
      },
    });
    expect(readSessionPresence()).toEqual({ state: "active", expiresAt: active });

    setGlobals({
      document: {
        cookie: `${SESSION_PRESENCE_COOKIE}=v1.${NOW - 60_000}`,
      },
    });
    expect(readSessionPresence().state).toBe("expired");

    setGlobals({ document: { cookie: "" } });
    expect(readSessionPresence().state).toBe("missing");
  });

  it("clears the readable cookie", () => {
    const writes: string[] = [];
    setGlobals({
      location: { protocol: "https:" },
      document: {
        get cookie() {
          return "";
        },
        set cookie(value: string) {
          writes.push(value);
        },
      },
    });
    clearSessionPresence();
    expect(writes.some((value) => value.includes("Max-Age=0"))).toBe(true);
    expect(writes.some((value) => value.includes("Secure"))).toBe(true);
  });
});
