import { describe, expect, it } from "vitest";
import { isDevMailboxEnabled, isLoopbackHost } from "./devMailbox.js";

describe("debug mailbox gating", () => {
  it("requires DEV_MAILBOX", () => {
    expect(isDevMailboxEnabled({}, "http://localhost:9050", "http://localhost:9050/api")).toBe(
      false,
    );
    expect(
      isDevMailboxEnabled(
        { DEV_MAILBOX: "false" },
        "http://localhost:9050",
        "http://localhost:9050",
      ),
    ).toBe(false);
  });

  it("allows loopback origins on loopback requests", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "app.localhost"]) {
      expect(isLoopbackHost(host)).toBe(true);
      expect(
        isDevMailboxEnabled(
          { DEV_MAILBOX: "true" },
          `http://${host}:9050`,
          `http://${host}:9050/api/debug/emails`,
        ),
      ).toBe(true);
    }
  });

  it("stays disabled on production origins even when DEV_MAILBOX leaked", () => {
    expect(
      isDevMailboxEnabled(
        { DEV_MAILBOX: "true" },
        "https://e.mattrax.app",
        "https://e.mattrax.app/api/debug/emails",
      ),
    ).toBe(false);
  });

  it("does not expose a loopback origin over a public request host", () => {
    expect(
      isDevMailboxEnabled(
        { DEV_MAILBOX: "true" },
        "http://localhost:9050",
        "https://e.mattrax.app/api/debug/emails",
      ),
    ).toBe(false);
  });

  it("requires a secret for the explicit remote opt-in", () => {
    expect(
      isDevMailboxEnabled(
        { DEV_MAILBOX: "true", DEV_MAILBOX_ALLOW_REMOTE: "true" },
        "https://staging.example.com",
        "https://staging.example.com/api/debug/emails",
      ),
    ).toBe(false);
    expect(
      isDevMailboxEnabled(
        { DEV_MAILBOX: "true", DEV_MAILBOX_ALLOW_REMOTE: "true", DEV_MAILBOX_SECRET: "   " },
        "https://staging.example.com",
        "https://staging.example.com/api/debug/emails",
      ),
    ).toBe(false);
    expect(
      isDevMailboxEnabled(
        {
          DEV_MAILBOX: "true",
          DEV_MAILBOX_ALLOW_REMOTE: "true",
          DEV_MAILBOX_SECRET: "shared-secret",
        },
        "https://staging.example.com",
        "https://staging.example.com/api/debug/emails",
      ),
    ).toBe(true);
  });
});
