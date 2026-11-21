import { describe, expect, it } from "vitest";
import {
  DIRECTORY_SYNC_STALE_MS,
  directorySyncProgress,
  directorySyncRunIsStale,
  formatDirectorySyncCounts,
  shouldPollDirectorySync,
} from "./directory-sync";
import type { DirectorySyncCounts } from "./directory-sync";

const counts: DirectorySyncCounts = { users: 12, groups: 3, domains: 2 };

const now = Date.parse("2026-01-01T12:00:00.000Z");

const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

describe("formatDirectorySyncCounts", () => {
  it("spells out the three count classes", () => {
    expect(formatDirectorySyncCounts(counts)).toBe("12 users, 3 groups and 2 domains");
  });

  it("uses singular nouns for a count of one", () => {
    expect(formatDirectorySyncCounts({ users: 1, groups: 1, domains: 1 })).toBe(
      "1 user, 1 group and 1 domain",
    );
  });

  it("keeps a zero count visible", () => {
    expect(formatDirectorySyncCounts({ users: 0, groups: 0, domains: 0 })).toBe(
      "0 users, 0 groups and 0 domains",
    );
  });

  it("omits domains for a provider that does not import them", () => {
    expect(formatDirectorySyncCounts({ users: 1, groups: 2 })).toBe("1 user and 2 groups");
  });
});

describe("directorySyncRunIsStale", () => {
  it("treats a fresh running row as live", () => {
    expect(
      directorySyncRunIsStale({
        remoteStatus: "running",
        lastAttemptedAt: minutesAgo(1),
        now,
      }),
    ).toBe(false);
  });

  it("treats a run past the lock window as abandoned", () => {
    expect(
      directorySyncRunIsStale({
        remoteStatus: "running",
        lastAttemptedAt: new Date(now - DIRECTORY_SYNC_STALE_MS - 1).toISOString(),
        now,
      }),
    ).toBe(true);
  });

  it("keeps a long run live while its heartbeat is fresh", () => {
    expect(
      directorySyncRunIsStale({
        remoteStatus: "running",
        lastAttemptedAt: minutesAgo(120),
        lastHeartbeatAt: minutesAgo(1),
        now,
      }),
    ).toBe(false);
  });

  it("does not call a non-running row stale", () => {
    expect(
      directorySyncRunIsStale({
        remoteStatus: "idle",
        lastAttemptedAt: minutesAgo(60),
        now,
      }),
    ).toBe(false);
  });

  it("treats a running row without an attempt timestamp as abandoned", () => {
    expect(directorySyncRunIsStale({ remoteStatus: "running", now })).toBe(true);
  });
});

describe("shouldPollDirectorySync", () => {
  it("polls only a live running row", () => {
    expect(
      shouldPollDirectorySync({
        remoteStatus: "running",
        lastAttemptedAt: minutesAgo(1),
        now,
      }),
    ).toBe(true);
    expect(
      shouldPollDirectorySync({
        remoteStatus: "running",
        lastAttemptedAt: minutesAgo(60),
        now,
      }),
    ).toBe(false);
    expect(shouldPollDirectorySync({ remoteStatus: "idle", now })).toBe(false);
  });
});

describe("directorySyncProgress", () => {
  const base = { isPending: false, localError: false, now };

  it("shows an indeterminate run while the request is in flight", () => {
    expect(
      directorySyncProgress({
        ...base,
        isPending: true,
        data: counts,
        remoteStatus: "idle",
      }),
    ).toEqual({
      state: "running",
      message: "Syncing users, groups and domains from Entra ID…",
    });
  });

  it("uses a provider-specific running message", () => {
    expect(
      directorySyncProgress({
        ...base,
        isPending: true,
        runningMessage: "Syncing users and groups from Google Workspace…",
      }),
    ).toEqual({
      state: "running",
      message: "Syncing users and groups from Google Workspace…",
    });
  });

  it("reports a live run that is still marked running on the server", () => {
    expect(
      directorySyncProgress({
        ...base,
        remoteStatus: "running",
        lastAttemptedAt: minutesAgo(1),
      }),
    ).toEqual({
      state: "running",
      message: "Syncing users, groups and domains from Entra ID…",
    });
  });

  it("stops claiming a run is live once it passes the stale window", () => {
    expect(
      directorySyncProgress({
        ...base,
        remoteStatus: "running",
        lastAttemptedAt: minutesAgo(60),
      }),
    ).toEqual({
      state: "stale",
      message:
        "The last directory sync did not report back. It may have been interrupted; try again.",
    });
  });

  it("keeps a long run live while its heartbeat is fresh", () => {
    expect(
      directorySyncProgress({
        ...base,
        remoteStatus: "running",
        lastAttemptedAt: minutesAgo(120),
        lastHeartbeatAt: minutesAgo(1),
      }),
    ).toEqual({
      state: "running",
      message: "Syncing users, groups and domains from Entra ID…",
    });
  });

  it("reports the counts of the run that just finished", () => {
    expect(directorySyncProgress({ ...base, data: counts, remoteStatus: "idle" })).toEqual({
      state: "succeeded",
      message: "Synced 12 users, 3 groups and 2 domains.",
      counts,
    });

    expect(
      directorySyncProgress({
        ...base,
        data: { users: 2, groups: 1 },
        remoteStatus: "idle",
      }),
    ).toEqual({
      state: "succeeded",
      message: "Synced 2 users and 1 group.",
      counts: { users: 2, groups: 1 },
    });
  });

  it("reports a stored failure from the remote status", () => {
    expect(
      directorySyncProgress({
        ...base,
        remoteStatus: "error",
        remoteError: "Graph exploded",
      }),
    ).toEqual({ state: "failed", message: "Directory sync failed. See the error below." });
  });

  it("shows a conflicting run as live rather than a permanent local failure", () => {
    expect(
      directorySyncProgress({
        ...base,
        localError: true,
        localErrorAt: now - 30_000,
        remoteStatus: "running",
        lastAttemptedAt: minutesAgo(1),
      }),
    ).toEqual({
      state: "running",
      message: "Syncing users, groups and domains from Entra ID…",
    });
  });

  it("supersedes a local lock failure with a later remote success", () => {
    expect(
      directorySyncProgress({
        ...base,
        localError: true,
        localErrorAt: now - 10 * 60_000,
        remoteStatus: "idle",
        lastSyncedAt: minutesAgo(1),
        remoteCounts: counts,
      }),
    ).toEqual({
      state: "succeeded",
      message: "Synced 12 users, 3 groups and 2 domains.",
      counts,
    });
  });

  it("keeps a local failure when no newer remote run succeeded", () => {
    expect(
      directorySyncProgress({
        ...base,
        localError: true,
        localErrorAt: now - 10 * 60_000,
        remoteStatus: "idle",
        lastSyncedAt: minutesAgo(30),
        remoteCounts: counts,
      }),
    ).toEqual({ state: "failed", message: "Directory sync failed. See the error below." });
  });

  it("stays quiet on an idle tenant with no recent run", () => {
    expect(directorySyncProgress({ ...base, remoteStatus: "idle" })).toBeNull();
  });
});
