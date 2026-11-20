import { Option, Schema } from "effect";

/**
 * Schedule state shared by every directory provider. `nextSyncAt` is
 * authoritative when present (it is written after every run and whenever the
 * cadence changes). Rows created before the schedule existed fall back to
 * `lastAttemptedAt + interval`, and a tenant that has never run is due
 * immediately.
 */
export type DirectorySyncScheduleState = {
  readonly enabled: boolean;
  readonly syncIntervalMinutes: number;
  readonly nextSyncAt?: Date | string | null;
  readonly lastAttemptedAt?: Date | string | null;
};

const toTime = (value: Schema.Json | Date | null | undefined): number | null => {
  const date = Schema.is(Schema.Date)(value)
    ? value
    : Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Date)(value));

  return date === undefined || !Number.isFinite(date.getTime()) ? null : date.getTime();
};

export const isDirectorySyncDue = (
  state: DirectorySyncScheduleState,
  at: Date = new Date(),
): boolean => {
  if (!state.enabled) return false;
  const interval = state.syncIntervalMinutes;

  if (!Number.isFinite(interval) || interval <= 0) return false;
  const nowMs = at.getTime();
  const next = toTime(state.nextSyncAt);

  if (next !== null) return next <= nowMs;
  const last = toTime(state.lastAttemptedAt);

  if (last === null) return true;

  return last + interval * 60_000 <= nowMs;
};

/** The `nextSyncAt` to persist after a run at `at`, or null when off. */
export const nextDirectorySyncAt = (intervalMinutes: number, at: Date): Date | null =>
  Number.isFinite(intervalMinutes) && intervalMinutes > 0
    ? new Date(at.getTime() + intervalMinutes * 60_000)
    : null;
