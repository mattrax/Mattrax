import { describe, expect, it } from "vitest";
import { DEVICE_ONLINE_WINDOW_MS, deriveDevicePresence, isDeviceOnline } from "./devicePresence.ts";

const now = new Date("2026-06-01T12:00:00.000Z");

const seenMinutesAgo = (minutes: number) =>
  new Date(now.getTime() - minutes * 60_000).toISOString();

describe("deriveDevicePresence", () => {
  it("never calls a device online before its first check-in", () => {
    for (const lastSeenAt of [null, undefined, "", "not-a-date"]) {
      const presence = deriveDevicePresence({ status: "enrolled", lastSeenAt, now });

      expect(presence.online).toBe(false);
      expect(presence.lastSeenAt).toBeNull();
      expect(presence.ageMs).toBeNull();
    }
  });

  it("is online just after a check-in", () => {
    const presence = deriveDevicePresence({
      status: "enrolled",
      lastSeenAt: seenMinutesAgo(1),
      now,
    });

    expect(presence.online).toBe(true);
    expect(presence.ageMs).toBe(60_000);
  });

  it("walks the online boundary in order", () => {
    const inside = deriveDevicePresence({
      status: "enrolled",
      lastSeenAt: new Date(now.getTime() - DEVICE_ONLINE_WINDOW_MS).toISOString(),
      now,
    });

    const outside = deriveDevicePresence({
      status: "enrolled",
      lastSeenAt: new Date(now.getTime() - DEVICE_ONLINE_WINDOW_MS - 1).toISOString(),
      now,
    });

    expect(inside.online).toBe(true);
    expect(outside.online).toBe(false);
  });

  it("turns offline without new data as the clock advances", () => {
    const lastSeenAt = seenMinutesAgo(0);

    expect(deriveDevicePresence({ status: "enrolled", lastSeenAt, now }).online).toBe(true);
    expect(
      deriveDevicePresence({
        status: "enrolled",
        lastSeenAt,
        now: new Date(now.getTime() + DEVICE_ONLINE_WINDOW_MS + 1),
      }).online,
    ).toBe(false);
  });

  it("does not call a device offline merely because it is stale by days", () => {
    // Presence and health answer different questions; a device seen eight days
    // ago is offline but health still owns the "stale" reason.
    const presence = deriveDevicePresence({
      status: "enrolled",
      lastSeenAt: seenMinutesAgo(8 * 24 * 60),
      now,
    });

    expect(presence.online).toBe(false);
    expect(presence.ageMs).toBe(8 * 24 * 60 * 60_000);
  });

  it("requires an enrolled status", () => {
    for (const status of ["enrolling", "unenrolling", "unenrolled", null, undefined])
      expect(deriveDevicePresence({ status, lastSeenAt: seenMinutesAgo(1), now }).online).toBe(
        false,
      );
  });

  it("treats a small future timestamp as clock skew but clamps a wild one", () => {
    const slightlyAhead = new Date(now.getTime() + 30_000).toISOString();
    const wildlyAhead = new Date(now.getTime() + DEVICE_ONLINE_WINDOW_MS * 10).toISOString();

    expect(
      deriveDevicePresence({ status: "enrolled", lastSeenAt: slightlyAhead, now }).online,
    ).toBe(true);
    expect(deriveDevicePresence({ status: "enrolled", lastSeenAt: wildlyAhead, now }).online).toBe(
      false,
    );
  });

  it("accepts Date inputs and exposes a normalised last-seen value", () => {
    const presence = deriveDevicePresence({
      status: "enrolled",
      lastSeenAt: new Date(now.getTime() - 5_000),
      now,
    });

    expect(presence.lastSeenAt).toBe(new Date(now.getTime() - 5_000).toISOString());
    expect(isDeviceOnline({ status: "enrolled", lastSeenAt: presence.lastSeenAt, now })).toBe(true);
  });
});
