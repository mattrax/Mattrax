/**
 * Copy and state for the Microsoft Entra directory sync action.
 *
 * The sync endpoint is synchronous: the request stays open while Graph is
 * paginated, so the dashboard shows an indeterminate progress state until it
 * settles and then reports the counts the API returned. A scheduled run can
 * also be in flight without a local mutation, which the stored status on the
 * tenant reflects.
 */

export type DirectorySyncCounts = {
  readonly users: number;
  readonly groups: number;
  readonly domains: number;
};

export type DirectorySyncProgress =
  | { readonly state: "running"; readonly message: string }
  | { readonly state: "succeeded"; readonly message: string; readonly counts: DirectorySyncCounts }
  | { readonly state: "failed"; readonly message: string };

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export const formatDirectorySyncCounts = (counts: DirectorySyncCounts): string =>
  `${plural(counts.users, "user")}, ${plural(counts.groups, "group")} and ${plural(
    counts.domains,
    "domain",
  )}`;

/**
 * Decide what the sync row should show. The local mutation wins while it is in
 * flight, then a recorded failure, then a run that is still marked as running
 * on the server, and finally the counts from the run that just finished.
 */
export const directorySyncProgress = (options: {
  isPending: boolean;
  isError: boolean;
  data?: DirectorySyncCounts | null;
  remoteStatus?: string | null;
}): DirectorySyncProgress | null => {
  if (options.isPending)
    return { state: "running", message: "Syncing users, groups and domains from Entra ID…" };

  if (options.isError)
    return { state: "failed", message: "Directory sync failed. See the error below." };

  if (options.remoteStatus === "running")
    return { state: "running", message: "Syncing users, groups and domains from Entra ID…" };

  if (options.data)
    return {
      state: "succeeded",
      message: `Synced ${formatDirectorySyncCounts(options.data)}.`,
      counts: options.data,
    };

  return null;
};
