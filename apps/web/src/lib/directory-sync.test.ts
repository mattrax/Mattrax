import { describe, expect, it } from "vitest";
import {
  directorySyncProgress,
  formatDirectorySyncCounts,
  type DirectorySyncCounts,
} from "./directory-sync";

const counts: DirectorySyncCounts = { users: 12, groups: 3, domains: 2 };

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
});

describe("directorySyncProgress", () => {
  const base = { isPending: false, isError: false };

  it("shows an indeterminate run while the request is in flight", () => {
    expect(
      directorySyncProgress({ ...base, isPending: true, data: counts, remoteStatus: "idle" }),
    ).toEqual({ state: "running", message: "Syncing users, groups and domains from Entra ID…" });
  });

  it("reports a run that is still marked running on the server", () => {
    expect(directorySyncProgress({ ...base, remoteStatus: "running" })).toEqual({
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
  });

  it("prefers a local failure over stale running status", () => {
    expect(
      directorySyncProgress({
        ...base,
        isError: true,
        data: counts,
        remoteStatus: "running",
      }),
    ).toEqual({ state: "failed", message: "Directory sync failed. See the error below." });
  });

  it("stays quiet on an idle tenant with no recent run", () => {
    expect(directorySyncProgress({ ...base, remoteStatus: "idle" })).toBeNull();
  });
});
