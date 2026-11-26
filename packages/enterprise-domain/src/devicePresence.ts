const MS_PER_MINUTE = 60_000;

/**
 * How recently a device must have contacted the MDM service to count as online.
 *
 * Mattrax's check-in coalescing window is fifteen minutes ("the normal Apple
 * and Windows poll cadence with room for retries", see `mdm-core/audit.ts`), so
 * the same window defines presence. It is deliberately not the seven-day
 * "stale" threshold: a device that checks in every fifteen minutes is online,
 * one that missed a poll or two is merely offline, and a device that has not
 * reported in a week is stale.
 *
 * Presence is therefore a recency statement, not a live socket: Apple and
 * Windows MDM are request/response protocols, and Android receives push
 * notifications. There is no connection to observe, so the newest check-in is
 * the only honest signal. A device that has never checked in is never online.
 */
export const DEVICE_ONLINE_WINDOW_MINUTES = 15;

export const DEVICE_ONLINE_WINDOW_MS = DEVICE_ONLINE_WINDOW_MINUTES * MS_PER_MINUTE;

export type DevicePresenceInput = {
  /** Enrollment status; only an `enrolled` device can be online. */
  readonly status?: string | null;
  /** Newest check-in/report clock, normally `device.last_seen_at`. */
  readonly lastSeenAt?: Date | string | null;
  /** Injectable clock so the derivation stays pure and testable. */
  readonly now?: Date;
};

export type DevicePresence = {
  readonly online: boolean;
  /** Normalised ISO clock, or null when the device has never checked in. */
  readonly lastSeenAt: string | null;
  /** Age of the last check-in in milliseconds; null when there is none. */
  readonly ageMs: number | null;
};

const parseDate = (value: Date | string | null | undefined): Date | null => {
  if (value == null) return null;

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Derive online/offline from check-in recency.
 *
 * Rules:
 *
 * - No usable `lastSeenAt` means "never checked in" and is never online.
 * - Only `enrolled` devices are online. An enrolling, unenrolling or
 *   unenrolled row is not serving management traffic.
 * - A timestamp inside the window (including a small future skew) is online.
 *   A far-future timestamp is capped at the window rather than trusted: a
 *   device clock cannot keep a retired row online forever.
 *
 * The result is intentionally a pure function of one row and a clock, so the
 * API, the dashboard and the maintenance/health derivation can share it.
 */
export const deriveDevicePresence = (input: DevicePresenceInput): DevicePresence => {
  const lastSeen = parseDate(input.lastSeenAt);

  if (!lastSeen) return { online: false, lastSeenAt: null, ageMs: null };

  const now = input.now ?? new Date();
  const ageMs = now.getTime() - lastSeen.getTime();
  const enrolled = input.status?.trim() === "enrolled";

  // A tiny negative age is clock skew between the device and the server and is
  // treated as "just now". A large one is clamped so a bad device clock cannot
  // hold a row online indefinitely.
  const withinWindow = ageMs <= DEVICE_ONLINE_WINDOW_MS && ageMs >= -DEVICE_ONLINE_WINDOW_MS;

  return {
    online: enrolled && withinWindow,
    lastSeenAt: lastSeen.toISOString(),
    ageMs,
  };
};

/** Convenience predicate for call sites that only need the boolean. */
export const isDeviceOnline = (input: DevicePresenceInput): boolean =>
  deriveDevicePresence(input).online;
