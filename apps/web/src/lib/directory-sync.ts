/**
 * Copy and state for the Microsoft Entra directory sync action.
 *
 * The sync endpoint is synchronous: the request stays open while Graph is
 * paginated, so the dashboard shows an indeterminate progress state until it
 * settles and then reports the counts the API returned. A scheduled run can
 * also be in flight without a local mutation, which the stored status on the
 * tenant reflects.
 */

/**
 * Mirrors `ENTRA_SYNC_STALE_MS` in `packages/entra-id/src/entraSync.ts`. The
 * web app cannot import that server package, but the lock takeover window and
 * the dashboard's "is this run abandoned?" answer must agree.
 */
export const DIRECTORY_SYNC_STALE_MS = 15 * 60_000;

export type DirectorySyncCounts = {
  readonly users: number;
  readonly groups: number;
  readonly domains: number;
};

export type DirectorySyncProgress =
  | { readonly state: "running"; readonly message: string }
  | { readonly state: "stale"; readonly message: string }
  | { readonly state: "succeeded"; readonly message: string; readonly counts: DirectorySyncCounts }
  | { readonly state: "failed"; readonly message: string };

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export const formatDirectorySyncCounts = (counts: DirectorySyncCounts): string =>
  `${plural(counts.users, "user")}, ${plural(counts.groups, "group")} and ${plural(
    counts.domains,
    "domain",
  )}`;

const runningMessage = "Syncing users, groups and domains from Entra ID…";

const parseTime = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : null;
};

/** A `running` run older than the lock's stale window has been abandoned. */
export const directorySyncRunIsStale = (options: {
  remoteStatus?: string | null;
  lastAttemptedAt?: string | null;
  lastHeartbeatAt?: string | null;
  now?: number;
  staleAfterMs?: number;
}): boolean => {
  if (options.remoteStatus !== "running") return false;

  const heartbeatAt = parseTime(options.lastHeartbeatAt);
  const attemptedAt = parseTime(options.lastAttemptedAt);
  const activityAt = heartbeatAt ?? attemptedAt;
  const staleAfterMs = options.staleAfterMs ?? DIRECTORY_SYNC_STALE_MS;
  const now = options.now ?? Date.now();

  // A running row without a heartbeat or attempt timestamp is corrupt, not
  // progress; stop polling rather than spinning on it forever.
  if (activityAt === null) return true;

  return now - activityAt > staleAfterMs;
};

/** Whether the status query should keep polling a live run. */
export const shouldPollDirectorySync = (options: {
  remoteStatus?: string | null;
  lastAttemptedAt?: string | null;
  lastHeartbeatAt?: string | null;
  now?: number;
  staleAfterMs?: number;
}): boolean => options.remoteStatus === "running" && !directorySyncRunIsStale(options);

/**
 * Decide what the sync row should show.
 *
 * Remote state is authoritative once the mutation settles: a later successful
 * scheduled run supersedes a stale local 409, and a failed stored run shows its
 * error even if this tab never attempted one. A local failure survives only
 * while no newer remote run has succeeded, so a network error is not lost.
 */
export const directorySyncProgress = (options: {
  isPending: boolean;
  localError: boolean;
  /** When the local mutation was submitted, used to order it against remote runs. */
  localErrorAt?: number | null;
  data?: DirectorySyncCounts | null;
  remoteStatus?: string | null;
  remoteError?: string | null;
  remoteCounts?: DirectorySyncCounts | null;
  lastSyncedAt?: string | null;
  lastAttemptedAt?: string | null;
  lastHeartbeatAt?: string | null;
  now?: number;
  staleAfterMs?: number;
}): DirectorySyncProgress | null => {
  if (options.isPending) return { state: "running", message: runningMessage };

  if (options.remoteStatus === "running") {
    if (
      directorySyncRunIsStale({
        remoteStatus: options.remoteStatus,
        lastAttemptedAt: options.lastAttemptedAt,
        lastHeartbeatAt: options.lastHeartbeatAt,
        now: options.now,
        staleAfterMs: options.staleAfterMs,
      })
    )
      return {
        state: "stale",
        message:
          "The last directory sync did not report back. It may have been interrupted; try again.",
      };

    return { state: "running", message: runningMessage };
  }

  if (options.remoteStatus === "error" && options.remoteError)
    return { state: "failed", message: "Directory sync failed. See the error below." };

  let localFailureSuperseded = false;

  if (options.localError) {
    const lastSyncedAt = parseTime(options.lastSyncedAt);
    const localAt = options.localErrorAt ?? null;

    // A remote success started (or finished) after this tab's failed attempt
    // is newer information than the local error.
    localFailureSuperseded = lastSyncedAt !== null && (localAt === null || lastSyncedAt >= localAt);

    if (!localFailureSuperseded)
      return { state: "failed", message: "Directory sync failed. See the error below." };
  }

  const counts = options.data ?? (localFailureSuperseded ? options.remoteCounts : null);

  if (counts)
    return {
      state: "succeeded",
      message: `Synced ${formatDirectorySyncCounts(counts)}.`,
      counts,
    };

  return null;
};
