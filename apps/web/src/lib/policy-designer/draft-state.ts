import { PLATFORM_ORDER } from "./build";
import type { PolicyDraft, Selection } from "./build";
import type { PlatformId } from "./catalog";

/**
 * A stable serialization of the parts of a draft an administrator edits.
 *
 * The designer compares snapshots to decide whether leaving the page would
 * discard work. `savedAt` is deliberately excluded: it is metadata written by
 * autosave and by the server, not an edit. Empty platforms are excluded too so
 * a draft loaded from a different shape does not look dirty.
 */
export const policyDraftSnapshot = (policy: PolicyDraft): string => {
  const platforms: Array<[PlatformId, Selection[]]> = PLATFORM_ORDER.map((platform) => [
    platform,
    policy.platforms[platform] ?? [],
  ]);

  return JSON.stringify({
    name: policy.name,
    platforms: platforms.filter(([, selections]) => selections.length > 0),
  });
};

/** Whether the current draft differs from the last state we consider saved. */
export const isPolicyDraftDirty = (policy: PolicyDraft, savedSnapshot: string): boolean =>
  policyDraftSnapshot(policy) !== savedSnapshot;
