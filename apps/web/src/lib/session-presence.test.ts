import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_PRESENCE_COOKIE,
  clearSessionPresence,
  readSessionPresence,
  sessionPresenceSetCookie,
} from "./session-presence";

afterEach(() => vi.unstubAllGlobals());

describe("session presence", () => {
  it("builds an active and cleared cookie", () => {
    const expiresAt = Date.now() + 60_000;
    expect(sessionPresenceSetCookie(expiresAt, false)).toContain(
      `${SESSION_PRESENCE_COOKIE}=v1.${expiresAt}`,
    );
    expect(sessionPresenceSetCookie(null, true)).toContain("Max-Age=0");
    expect(sessionPresenceSetCookie(null, true)).toContain("Secure");
  });

  it("reads active, expired and missing states", () => {
    const active = Date.now() + 60_000;
    vi.stubGlobal("document", {
      cookie: `${SESSION_PRESENCE_COOKIE}=v1.${active}`,
    });
    expect(readSessionPresence()).toEqual({ state: "active", expiresAt: active });

    vi.stubGlobal("document", {
      cookie: `${SESSION_PRESENCE_COOKIE}=v1.${Date.now() - 60_000}`,
    });
    expect(readSessionPresence().state).toBe("expired");

    vi.stubGlobal("document", { cookie: "" });
    expect(readSessionPresence().state).toBe("missing");
  });

  it("clears the readable cookie", () => {
    const write = vi.fn();
    vi.stubGlobal("location", { protocol: "https:" });
    vi.stubGlobal("document", {
      get cookie() {
        return "";
      },
      set cookie(value: string) {
        write(value);
      },
    });
    clearSessionPresence();
    expect(write).toHaveBeenCalledWith(expect.stringContaining("Max-Age=0"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("Secure"));
  });
});
